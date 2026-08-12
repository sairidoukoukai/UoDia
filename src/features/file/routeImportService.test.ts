/**
 * 路線の取り込み（T-91、#235）。
 *
 * 数えるところは `domain/network/routeImport.test.ts` が見る。ここで確かめるのは
 * **どこから路線を取り出すか**と、**当てたものが取り消せるか**である。
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import { createProject, serializeProject } from '@/domain/io';
import type { NetworkDef } from '@/domain/model';
import { loadNetworkDef, type NetworkIndex } from '@/domain/network';
import { createMemoryPlatform, type MemoryPlatform } from '@/platform';
import {
  createAppStore,
  selectIsDirty,
  selectNetwork,
  selectVisibleStops,
  type AppStoreHook,
} from '@/store';
import {
  createRouteImportService,
  networkFrom,
  type RouteImportService,
} from './routeImportService';

const routeJsonPath = fileURLToPath(new URL('../../../data/route.json', import.meta.url));
const routeJson = readFileSync(routeJsonPath, 'utf8');
const loaded = loadNetworkDef(routeJson);
if (!loaded.ok) throw new Error('route.json を読み込めません');
const network: NetworkIndex = loaded.network;

let store: AppStoreHook;
let platform: MemoryPlatform;
let imports: RouteImportService;

/** 名前だけ変えた路線。**中身が違うことが分かればよい。** */
function renamed(name: string): NetworkDef {
  return { ...network.def, name };
}

/** その路線を持つ `.uodia` をファイルとして置く。 */
function putProject(fileName: string, def: NetworkDef): void {
  const project = createProject(network, { now: new Date('2026-08-13T00:00:00Z') });
  platform.files.set(fileName, serializeProject({ ...project, network: def }));
  platform.openTarget = fileName;
}

beforeEach(() => {
  store = createAppStore();
  platform = createMemoryPlatform({ networkDef: routeJson });
  store.getState().setSeedNetworkDef(network.def);
  store
    .getState()
    .setProject(createProject(network, { now: new Date('2026-08-13T00:00:00Z') }), null);
  imports = createRouteImportService({ platform, store });
});

describe('どこから取り出すか', () => {
  it('**別の `.uodia` から路線だけを取り出す**', () => {
    const other = serializeProject({
      ...createProject(network, { now: new Date('2026-08-13T00:00:00Z') }),
      network: renamed('別の路線'),
    });

    expect(networkFrom(other, network)?.name).toBe('別の路線');
  });

  it('**`route.json` そのものも読める**（手で書いた路線を入れる）', () => {
    expect(networkFrom(routeJson, network)?.name).toBe(network.def.name);
  });

  it('読めないものは `null`', () => {
    expect(networkFrom('{ こわれた', network)).toBeNull();
    expect(networkFrom('{"まったく別の物":1}', network)).toBeNull();
  });
});

describe('確かめてから当てる（受入条件）', () => {
  it('**数えるだけでは状態を変えない**', () => {
    putProject('別.uodia', renamed('別の路線'));

    return imports.inspect().then((result) => {
      expect(result.ok).toBe(true);
      // 開いている文書はまだ元のままである。
      expect(selectNetwork(store.getState())?.def.name).toBe(network.def.name);
      expect(selectIsDirty(store.getState())).toBe(false);
    });
  });

  it('**当てると路線が入れ替わる**', async () => {
    putProject('別.uodia', renamed('別の路線'));
    const result = await imports.inspect();
    if (!result.ok) throw new Error('読めるはず');

    expect(imports.apply(result.candidate)).toBe(true);
    expect(selectNetwork(store.getState())?.def.name).toBe('別の路線');
    expect(store.getState().project?.meta.routeVersion).toBe(network.def.version);
  });

  it('**取り消せる**（受入条件）', async () => {
    putProject('別.uodia', renamed('別の路線'));
    const result = await imports.inspect();
    if (!result.ok) throw new Error('読めるはず');
    imports.apply(result.candidate);

    expect(store.getState().undo()).toBe(true);
    expect(selectNetwork(store.getState())?.def.name).toBe(network.def.name);
  });

  it('**取り込んだ路線が画面の元になる**（停留所が増えれば縦軸に出る）', async () => {
    const withNewStop: NetworkDef = {
      ...network.def,
      stops: [
        ...network.def.stops,
        {
          stopId: '7_0',
          stopName: '新キャンパス前',
          shortName: '新キャン',
          area: '',
          axisPosition: 60,
          gridStyle: 'normal',
          hiddenInEditor: false,
          isDepot: false,
          lat: 34.8,
          lon: 135.5,
        },
      ],
    };
    putProject('新経路.uodia', withNewStop);

    const result = await imports.inspect();
    if (!result.ok) throw new Error('読めるはず');
    imports.apply(result.candidate);

    expect(selectVisibleStops(store.getState()).map((stop) => stop.stopId)).toContain('7_0');
  });

  it('取り消されたら失敗にしない', async () => {
    platform.openTarget = null;
    const result = await imports.inspect();

    expect(result).toEqual({ ok: false, reason: 'cancelled' });
  });

  it('路線を読み取れなければ理由を言う', async () => {
    platform.files.set('でたらめ.uodia', '{ こわれた');
    platform.openTarget = 'でたらめ.uodia';

    const result = await imports.inspect();
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason === 'unreadable' && result.message).toContain(
      'でたらめ.uodia',
    );
  });

  it('文書を開いていなければ取り込めない', async () => {
    store.getState().setProject(null);
    const result = await imports.inspect();

    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason === 'unreadable' && result.message).toContain(
      '開いていません',
    );
  });
});
