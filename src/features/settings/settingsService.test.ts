/**
 * 設定の適用の検証（T-35、仕様書 §6.5.1、§6.5.5）。
 *
 * 受入条件の残り 1 つ（**変更が取り消しで戻る**）と、書き戻しの順序——
 * **検証を通ったときだけファイルへ書く**——を確かめる。
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createProject } from '@/domain/io';
import type { NetworkDef } from '@/domain/model';
import { loadNetworkDef, type NetworkIndex } from '@/domain/network';
import type { PlatformAdapter } from '@/platform';
import { createAppStore, selectNetwork, type AppStoreHook } from '@/store';
import { applySegmentEdits, saveNetworkDef } from './settingsService';

const routeJsonPath = fileURLToPath(new URL('../../../data/route.json', import.meta.url));
const loaded = loadNetworkDef(readFileSync(routeJsonPath, 'utf8'));
if (!loaded.ok) throw new Error('route.json を読み込めません');
const network: NetworkIndex = loaded.network;

const TOYONAKA_TO_MINOH = '1_0→2_0';

let store: AppStoreHook;

/** 書き戻せるかどうかだけが違う、最低限のプラットフォーム。 */
function makePlatform(networkDefWritable: boolean): {
  platform: PlatformAdapter;
  saved: ReturnType<typeof vi.fn>;
  exported: ReturnType<typeof vi.fn>;
} {
  const saved = vi.fn<(content: string) => Promise<void>>().mockResolvedValue(undefined);
  const exported = vi
    .fn<(content: string, name: string) => Promise<{ kind: string; name: string } | null>>()
    .mockResolvedValue({ kind: 'test', name: 'route.json' });

  const platform = {
    kind: 'test',
    capabilities: { saveInPlace: true, recentFiles: true, networkDefWritable },
    saveNetworkDef: saved,
    saveProjectAs: exported,
  } as unknown as PlatformAdapter;

  return { platform, saved, exported };
}

const runMinutes = (): number | undefined =>
  selectNetwork(store.getState())?.runMinutes('1_0', '2_0');

beforeEach(() => {
  store = createAppStore();
  store.getState().setNetworkDef(network.def);
  store.getState().setProject(createProject(network, { now: new Date('2026-01-01T00:00:00Z') }));
});

describe('適用', () => {
  it('区間所要時間が変わる', () => {
    const result = applySegmentEdits(store, new Map([[TOYONAKA_TO_MINOH, 25]]));

    expect(result.ok).toBe(true);
    expect(runMinutes()).toBe(25);
  });

  it('**取り消しで戻る**（受入条件）', () => {
    applySegmentEdits(store, new Map([[TOYONAKA_TO_MINOH, 25]]));
    store.getState().undo();

    expect(runMinutes()).toBe(20);
  });

  it('やり直せる', () => {
    applySegmentEdits(store, new Map([[TOYONAKA_TO_MINOH, 25]]));
    store.getState().undo();
    store.getState().redo();

    expect(runMinutes()).toBe(25);
  });

  it('**検証を通らない値は当てない**（状態は 1 ビットも変わらない）', () => {
    // 5 の倍数でない値は R-01 に反する。画面は受け取らないが、ここでも守る。
    const result = applySegmentEdits(store, new Map([[TOYONAKA_TO_MINOH, 21]]));

    expect(result.ok).toBe(false);
    expect(result.message).toContain('適用できません');
    expect(runMinutes()).toBe(20);
    expect(store.getState().history.past).toHaveLength(0);
  });

  it('変わっていなければ履歴に載せない', () => {
    const result = applySegmentEdits(store, new Map([[TOYONAKA_TO_MINOH, 20]]));

    expect(result.ok).toBe(true);
    expect(store.getState().history.past).toHaveLength(0);
  });

  it('路線図を読み込んでいなければ何もしない', () => {
    expect(applySegmentEdits(createAppStore(), new Map()).ok).toBe(false);
  });
});

describe('書き戻し（§6.5.1、§6.5.5）', () => {
  it('書き戻せる環境では route.json に書く', async () => {
    const { platform, saved } = makePlatform(true);
    applySegmentEdits(store, new Map([[TOYONAKA_TO_MINOH, 25]]));

    expect(await saveNetworkDef(store, platform)).toContain('書き戻しました');

    const written = String(saved.mock.calls[0]?.[0] ?? '');
    // **今の定義がそのまま出る。** 打った値がファイルに入っていなければ、
    // 次に開いたときに元へ戻る。
    const parsed = JSON.parse(written) as NetworkDef;
    expect(parsed.segments).toContainEqual({
      fromStopId: '1_0',
      toStopId: '2_0',
      runMinutes: 25,
    });
    // 末尾に改行を 1 つ置く（仕様書 §7.1 と同じ扱い）。
    expect(written.endsWith('\n')).toBe(true);
  });

  it('**書き戻せない環境では書き出す**（Web 版。§6.5.5）', async () => {
    const { platform, saved, exported } = makePlatform(false);

    expect(await saveNetworkDef(store, platform)).toContain('書き出しました');
    expect(saved).not.toHaveBeenCalled();
    expect(exported).toHaveBeenCalledWith(expect.stringContaining('"segments"'), 'route.json');
  });

  it('書き出しを取り消したら何も言わない', async () => {
    const { platform, exported } = makePlatform(false);
    exported.mockResolvedValue(null);

    expect(await saveNetworkDef(store, platform)).toBeNull();
  });

  it('路線図を読み込んでいなければ書かない', async () => {
    const { platform, saved } = makePlatform(true);

    expect(await saveNetworkDef(createAppStore(), platform)).toContain('読み込んでいません');
    expect(saved).not.toHaveBeenCalled();
  });
});
