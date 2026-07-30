/**
 * 描くものの組み立ての検証（T-24、実装計画書 §3.5）。
 *
 * ここが**ストアの形を描画側から隠す境目**である。便がどの停留所を何時に通るかは
 * 導出値であり（仕様書 §5.6）、それを毎フレーム解き直させないための層でもある。
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Trip } from '@/domain/model';
import { createProject } from '@/domain/io';
import { loadNetworkDef, type NetworkIndex } from '@/domain/network';
import { fromHM } from '@/domain/time';
import { createAppStore, type AppState } from '@/store';
import { selectDiagramScene, type SceneTheme } from './scene';

const routeJsonPath = fileURLToPath(new URL('../../../data/route.json', import.meta.url));
const loaded = loadNetworkDef(readFileSync(routeJsonPath, 'utf8'));
if (!loaded.ok) throw new Error('route.json を読み込めません');
const network: NetworkIndex = loaded.network;

/** 色は毎回同じ参照を渡す（`selectDiagramScene` の約束）。 */
const theme: SceneTheme = { background: '#ffffff', axis: '#cccccc' };

let store: ReturnType<typeof createAppStore>;

function makeTrip(
  tripId: string,
  patternId: string,
  hm: readonly [number, number],
  extra = {},
): Trip {
  const pattern = network.patternIndex(patternId);
  if (pattern === undefined) throw new Error(`パターン ${patternId} がありません`);
  return {
    tripId,
    patternId,
    anchor: { stopId: pattern.originStopId, time: fromHM(hm[0], hm[1]) },
    blockId: 'A',
    pullOut: false,
    pullIn: false,
    ...extra,
  };
}

function setTrips(trips: readonly Trip[]): void {
  store.getState().editProject('便を置く', (project) => {
    const [service] = project.services;
    if (service !== undefined) service.trips = [...trips];
  });
}

function state(): AppState {
  return store.getState();
}

beforeEach(() => {
  store = createAppStore();
  store.getState().setNetworkDef(network.def);
  store.getState().setProject(createProject(network, { now: new Date('2026-01-01T00:00:00Z') }));
});

describe('縦軸の停留所', () => {
  it('**軸位置の順に並ぶ**（仕様書 §6.2.1）', () => {
    const { stops } = selectDiagramScene(state(), theme);
    expect(stops.map((stop) => stop.axisPosition)).toEqual(
      [...stops.map((s) => s.axisPosition)].sort((a, b) => a - b),
    );
  });

  it('**微生物研究所前は縦軸に出ない**（`hiddenInEditor`）', () => {
    const { stops } = selectDiagramScene(state(), theme);
    expect(stops.map((stop) => stop.stopId)).not.toContain('6_0');
  });

  it('**千里営業所は縦軸に出る**（外側の専用レーン。§6.2.1）', () => {
    const depot = selectDiagramScene(state(), theme).stops.find((stop) => stop.isDepot);
    expect(depot?.stopId).toBe('9_0');
    // 軸位置が営業停留所より外にある。
    expect(depot?.axisPosition).toBeGreaterThan(40);
  });
});

describe('スジ', () => {
  it('**折れ点は経路の順に並び、時刻を持つ**', () => {
    setTrips([makeTrip('t1', 'S1', [8, 0])]);
    const [trip] = selectDiagramScene(state(), theme).trips;

    expect(trip?.points.map((point) => point.stopId)).toEqual(['1_0', '3_0', '4_0']);
    expect(trip?.points[0]?.time).toBe(fromHM(8, 0));
    expect(trip?.points.at(-1)?.time).toBe(fromHM(8, 30));
  });

  it('**縦軸に出ない停留所は折れ点にしない**（直行便が貫通して描かれる）', () => {
    setTrips([makeTrip('t1', 'S1', [8, 0])]);
    const [trip] = selectDiagramScene(state(), theme).trips;

    expect(trip?.points.map((point) => point.stopId)).not.toContain('6_0');
  });

  it('パターンの色と方向を持つ', () => {
    setTrips([makeTrip('t1', 'S1', [8, 0]), makeTrip('t2', 'T1', [9, 0])]);
    const { trips } = selectDiagramScene(state(), theme);

    expect(trips[0]?.color).toBe(network.findPattern('S1')?.color);
    expect(trips[0]?.directionId).toBe(0);
    expect(trips[1]?.directionId).toBe(1);
  });

  it('**回送便は展開して現れる**（保存されていない。仕様書 §6.1.7）', () => {
    setTrips([makeTrip('t1', 'S1', [8, 0], { pullOut: true })]);
    const { trips } = selectDiagramScene(state(), theme);

    expect(trips).toHaveLength(2);
    const deadhead = trips.find((trip) => trip.isDeadhead);
    expect(deadhead?.patternId).toBe('DT-out');
    // 車庫（9_0）から豊中学舎（1_0）へ。7:40 → 8:00。
    expect(deadhead?.points[0]).toEqual({ stopId: '9_0', time: fromHM(7, 40) });
    expect(deadhead?.points.at(-1)).toEqual({ stopId: '1_0', time: fromHM(8, 0) });
  });

  it('時刻が未入力の便は線にならない', () => {
    setTrips([{ ...makeTrip('t1', 'S1', [8, 0]), anchor: null }]);
    expect(selectDiagramScene(state(), theme).trips).toEqual([]);
  });

  it('参照が壊れた便は線にならない', () => {
    setTrips([{ ...makeTrip('t1', 'S1', [8, 0]), patternId: '無い' }]);
    expect(selectDiagramScene(state(), theme).trips).toEqual([]);
  });
});

describe('組み立て直さない', () => {
  it('**同じ状態からは同じ場面が返る**（毎フレーム作り直さない）', () => {
    setTrips([makeTrip('t1', 'S1', [8, 0])]);
    expect(selectDiagramScene(state(), theme)).toBe(selectDiagramScene(state(), theme));
  });

  it('便が変われば作り直す', () => {
    setTrips([makeTrip('t1', 'S1', [8, 0])]);
    const before = selectDiagramScene(state(), theme);

    setTrips([makeTrip('t1', 'S1', [9, 0])]);
    expect(selectDiagramScene(state(), theme)).not.toBe(before);
  });

  it('**選択が変わっても停留所とスジは作り直さない**', () => {
    setTrips([makeTrip('t1', 'S1', [8, 0])]);
    const before = selectDiagramScene(state(), theme);

    store.getState().selectTrips(['t1']);
    const after = selectDiagramScene(state(), theme);

    expect(after).not.toBe(before);
    expect(after.trips).toBe(before.trips);
    expect(after.stops).toBe(before.stops);
    expect(after.selectedTripIds.has('t1')).toBe(true);
  });
});

describe('ネットワーク定義を読む前', () => {
  it('空の場面を返す（描くものが無い）', () => {
    const empty = createAppStore();
    const scene = selectDiagramScene(empty.getState(), theme);

    expect(scene.stops).toEqual([]);
    expect(scene.trips).toEqual([]);
  });
});
