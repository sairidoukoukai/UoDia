/**
 * 設定の適用の検証（T-35、仕様書 §6.5.1、§6.5.5）。
 *
 * 受入条件の残り 1 つ（**変更が取り消しで戻る**）と、書き戻しの順序——
 * **検証を通ったときだけファイルへ書く**——を確かめる。
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import { createProject } from '@/domain/io';
import { loadNetworkDef, type NetworkIndex } from '@/domain/network';
import { createAppStore, selectNetwork, type AppStoreHook } from '@/store';
import { applySegmentEdits } from './settingsService';

const routeJsonPath = fileURLToPath(new URL('../../../data/route.json', import.meta.url));
const loaded = loadNetworkDef(readFileSync(routeJsonPath, 'utf8'));
if (!loaded.ok) throw new Error('route.json を読み込めません');
const network: NetworkIndex = loaded.network;

const TOYONAKA_TO_MINOH = '1_0→2_0';

let store: AppStoreHook;

const runMinutes = (): number | undefined =>
  selectNetwork(store.getState())?.runMinutes('1_0', '2_0');

beforeEach(() => {
  store = createAppStore();
  store.getState().setSeedNetworkDef(network.def);
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

/*
  「書き戻し」の節は落とした（T-92、#235）。**`route.json` へ書き戻す道その
  ものが無くなった**——路線は文書の中にあり、区間を直すことは文書を直すこと
  である。適用したものがファイルに入るかどうかは `io.test.ts` の往復が見る。
*/
