/**
 * 性能の検証（T-40、仕様書 §9.1）。
 *
 * **目標値そのものを書く。** 「速いこと」ではなく「300ms 以内」と書いてあるのが
 * 仕様であり、そこに届いているかは機械が答えられる。届かなくなった日に、
 * どの変更が重くしたのかが分かる。
 *
 * ## 測るのは 150 便である
 *
 * 仕様書は 1 日 100 便程度を前提に、余裕を見て 150 便で目標を置いている。
 * 実際のダイヤに近い形（3 方向・10 運用・朝夕の出入庫）で作る。
 *
 * ## 画面の速さはここで測らない
 *
 * 起動時間・パン/ズームの滑らかさ・打鍵から反映までは、**実際に描いてみないと
 * 分からない**。それらは実機（headless Chromium）で測り、`docs/performance.md`
 * に記録する。ここで測るのは計算の速さ——読込・検証・場面の組み立て——である。
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadProject, serializeProject } from '@/domain/io';
import type { Project, Trip } from '@/domain/model';
import { loadNetworkDef, type NetworkIndex } from '@/domain/network';
import { seconds } from '@/domain/time';
import { selectDiagramScene } from '@/features/diagram';
import { createAppStore, selectBlocks, selectValidation, type AppStoreHook } from '@/store';

const routeJsonPath = fileURLToPath(new URL('../../data/route.json', import.meta.url));
const loaded = loadNetworkDef(readFileSync(routeJsonPath, 'utf8'));
if (!loaded.ok) throw new Error('route.json を読み込めません');
const network: NetworkIndex = loaded.network;

/** 仕様書 §9.1 の目標値。 */
const TARGET = {
  /** プロジェクト読込（150 便）。 */
  loadMs: 300,
  /** 検証の実行時間（150 便）。 */
  validateMs: 50,
  /**
   * 1 フレームぶんの組み立て。
   *
   * 60fps を保つには 1 フレーム 16.7ms しかない。**描く前の準備**（場面の
   * 組み立て）はその一部でしかないため、余裕を見て 8ms を上限とする。
   */
  sceneMs: 8,
} as const;

const TRIP_COUNT = 150;
const PATTERNS = ['S3', 'T3', 'S1', 'T1', 'S2', 'T2', 'M2', 'M4'] as const;

/** 実際のダイヤに近い 150 便（`scripts/generate-sample.mjs` と同じ作り）。 */
function makeTrips(count = TRIP_COUNT): readonly Trip[] {
  const first = 7 * 3600;
  const last = 21 * 3600;

  return Array.from({ length: count }, (_, index) => {
    const patternId = PATTERNS[index % PATTERNS.length] ?? 'S3';
    const origin = network.patternIndex(patternId)?.originStopId ?? '1_0';
    const raw = first + Math.round(((last - first) * index) / count);

    return {
      tripId: `t${String(index + 1).padStart(3, '0')}`,
      patternId,
      anchor: { stopId: origin, time: seconds(Math.round(raw / 300) * 300) },
      blockId: String.fromCharCode(65 + (index % 10)),
      pullOut: index < 10,
      pullIn: index >= count - 10,
    };
  });
}

function makeProject(): Project {
  const now = new Date('2026-08-02T00:00:00Z').toISOString();
  return {
    network: network.def,
    meta: {
      format: 'uodia',
      formatVersion: 3,
      appVersion: '0.1.0',
      routeVersion: 1,
      createdAt: now,
      updatedAt: now,
    },
    document: { name: '性能検証', author: '', comment: '' },
    services: [
      { serviceId: 'weekday', serviceName: '授業期間平日ダイヤ', trips: [...makeTrips()] },
    ],
    view: {
      splitRatio: 0.6,
      activeServiceId: null,
      activeDirection: 0,
      diagram: { pxPerMinute: 3, pxPerAxisUnit: 8, scrollTime: 25200, scrollAxis: 0 },
      colorMode: 'pattern',
      hiddenPatternIds: [],
      hiddenBlockIds: [],
      hiddenDirections: [],
      showDeadhead: true,
      showBlockLinks: true,
      validationPanelOpen: true,
      blockColors: {},
    },
  };
}

/**
 * 何度か測って**いちばん速い回**を採る。
 *
 * 遅い回は測定の邪魔（GC・他のプロセス・JIT の暖まり）が混ざる。速い回に
 * 邪魔は混ざらない。**1 回目は捨てる**——初回は必ず暖機を含み、利用者が
 * 感じる速さではない。
 */
function fastest(run: () => void, times = 12): number {
  run();

  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < times; i += 1) {
    const start = performance.now();
    run();
    best = Math.min(best, performance.now() - start);
  }
  return best;
}

/**
 * 測った値を残す。
 *
 * **記録は文書に残す**（`docs/performance.md`）。ここでは、目標に届かなくなった
 * ときに「どれくらい遅いのか」がその場で読めるようにしておく。
 */
function record(name: string, elapsed: number, target: number): void {
  const mark = elapsed < target ? '✓' : '✖';
  console.log(`${mark} ${name}: ${elapsed.toFixed(2)}ms（目標 ${String(target)}ms）`);
}

function storeWith(project: Project): AppStoreHook {
  const store = createAppStore();
  store.getState().setSeedNetworkDef(network.def);
  store.getState().setProject(project);
  return store;
}

const theme = {
  background: '#ffffff',
  axis: '#cccccc',
  grid: '#e4e4e4',
  gridFaint: '#f0f0f0',
  label: '#666666',
};

describe('仕様書 §9.1 の目標値', () => {
  it(`**プロジェクト読込（${String(TRIP_COUNT)} 便）が ${String(TARGET.loadMs)}ms 以内**`, () => {
    const json = serializeProject(makeProject());

    const elapsed = fastest(() => {
      const result = loadProject(json, network);
      if (!result.ok) throw new Error('読み込めません');
    });

    record('プロジェクト読込', elapsed, TARGET.loadMs);
    expect(elapsed).toBeLessThan(TARGET.loadMs);
  });

  it(`**検証（${String(TRIP_COUNT)} 便）が ${String(TARGET.validateMs)}ms 以内**`, () => {
    const store = storeWith(makeProject());

    // 記憶化を効かせない。**毎回新しい状態で測る**——利用者が便を 1 つ直した
    // 直後は、まさにこの計算が走る。
    const elapsed = fastest(() => {
      store.getState().editProject('時刻をずらす', (project) => {
        const trip = project.services[0]?.trips[0];
        if (trip?.anchor != null) trip.anchor.time = seconds(trip.anchor.time + 300);
      });
      selectValidation(store.getState());
    });

    record('検証', elapsed, TARGET.validateMs);
    expect(elapsed).toBeLessThan(TARGET.validateMs);
  });

  it(`**場面の組み立てが ${String(TARGET.sceneMs)}ms 以内**（60fps の 1 フレームに収まる）`, () => {
    const store = storeWith(makeProject());

    const elapsed = fastest(() => {
      store.getState().editProject('時刻をずらす', (project) => {
        const trip = project.services[0]?.trips[0];
        if (trip?.anchor != null) trip.anchor.time = seconds(trip.anchor.time + 300);
      });
      selectDiagramScene(store.getState(), theme);
    });

    record('場面の組み立て', elapsed, TARGET.sceneMs);
    expect(elapsed).toBeLessThan(TARGET.sceneMs);
  });

  it('**送りだけなら組み立て直さない**（記憶化が効いている）', () => {
    const store = storeWith(makeProject());
    const before = selectDiagramScene(store.getState(), theme);

    store.getState().setDiagramView({
      pxPerMinute: 6,
      pxPerAxisUnit: 8,
      scrollTime: 28800,
      scrollAxis: 0,
    });
    const after = selectDiagramScene(store.getState(), theme);

    // 視野が変わっても、描くもの（スジ）は同じ参照のまま返る。
    expect(after.trips).toBe(before.trips);
    expect(after.stops).toBe(before.stops);
  });

  it('運用の導出も 1 フレームに収まる', () => {
    const store = storeWith(makeProject());

    const elapsed = fastest(() => {
      store.getState().editProject('時刻をずらす', (project) => {
        const trip = project.services[0]?.trips[0];
        if (trip?.anchor != null) trip.anchor.time = seconds(trip.anchor.time + 300);
      });
      selectBlocks(store.getState());
    });

    record('運用の導出', elapsed, TARGET.sceneMs);
    expect(elapsed).toBeLessThan(TARGET.sceneMs);
  });
});
