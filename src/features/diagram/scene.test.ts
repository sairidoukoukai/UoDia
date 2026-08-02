/**
 * 描くものの組み立ての検証（T-24、実装計画書 §3.5）。
 *
 * ここが**ストアの形を描画側から隠す境目**である。便がどの停留所を何時に通るかは
 * 導出値であり（仕様書 §5.6）、それを毎フレーム解き直させないための層でもある。
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Project, Trip } from '@/domain/model';
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
const theme: SceneTheme = {
  background: '#ffffff',
  axis: '#cccccc',
  grid: '#e4e4e4',
  gridFaint: '#f0f0f0',
  label: '#666666',
};

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

function setView(recipe: (view: Project['view']) => void): void {
  store.getState().editProject('表示設定の変更', (project) => {
    recipe(project.view);
  });
}

function state(): AppState {
  return store.getState();
}

function tripIds(): readonly string[] {
  return selectDiagramScene(state(), theme).trips.map((trip) => trip.tripId);
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

  it('**縦軸に出すのは略称である**（正式名ではない。#116）', () => {
    const { stops } = selectDiagramScene(state(), theme);
    const convention = stops.find((stop) => stop.stopId === '3_0');

    // 正式名「コンベンションセンター前」を出すには縦軸の欄を 12 文字ぶん取る
    // ことになり、そのぶん描く場所が狭くなる。
    expect(convention?.shortName).toBe('コンベ前');
    expect(stops.map((stop) => stop.shortName)).toEqual([
      '豊中',
      '箕面',
      'コンベ前',
      '人科前',
      '工学部',
    ]);
  });

  it('**微生物研究所前は縦軸に出ない**（`hiddenInEditor`）', () => {
    const { stops } = selectDiagramScene(state(), theme);
    expect(stops.map((stop) => stop.stopId)).not.toContain('6_0');
  });

  it('**千里営業所は縦軸に出ない**（#118、仕様書 §6.2.1）', () => {
    // 営業所は 3 拠点のいずれからも 20 分にあり、縦軸のどこに置いても等距離を
    // 表せない。意味の無い位置へ線を引くと、その傾きにも意味が無くなる。
    const { stops } = selectDiagramScene(state(), theme);
    expect(stops.map((stop) => stop.stopId)).not.toContain('9_0');
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
    // **車庫側の点は縦軸に無い**（#118）。落とさずに `offAxis` を立てて残す——
    // 落とすと線が 1 点になり、出区を付け忘れていることが絵から消える。
    expect(deadhead?.points[0]).toEqual({ stopId: '9_0', time: fromHM(7, 40), offAxis: true });
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

describe('スジに添える値（T-26）', () => {
  it('**便番号を持つ。回送は空文字**（番号を持たない）', () => {
    setTrips([makeTrip('t1', 'S1', [8, 0], { pullOut: true })]);
    const { trips } = selectDiagramScene(state(), theme);

    expect(trips.find((trip) => !trip.isDeadhead)?.tripNumber).not.toBe('');
    expect(trips.find((trip) => trip.isDeadhead)?.tripNumber).toBe('');
  });

  it('**回送は元の便を指す**（`sourceTripId`。選択の単位は保存されている便）', () => {
    setTrips([makeTrip('t1', 'S1', [8, 0], { pullOut: true })]);
    const { trips } = selectDiagramScene(state(), theme);

    expect(trips.every((trip) => trip.sourceTripId === 't1')).toBe(true);
    expect(trips.find((trip) => trip.isDeadhead)?.tripId).toBe('t1#out');
  });

  it('**同じ方向のパターンには違う線種が付く**（色に頼らせない。§9.4）', () => {
    setTrips([makeTrip('t1', 'S1', [8, 0]), makeTrip('t2', 'S3', [9, 0])]);
    const { trips } = selectDiagramScene(state(), theme);

    expect(trips[0]?.lineDash).not.toEqual(trips[1]?.lineDash);
  });

  it('回送は破線になる', () => {
    setTrips([makeTrip('t1', 'S1', [8, 0], { pullOut: true })]);
    const deadhead = selectDiagramScene(state(), theme).trips.find((trip) => trip.isDeadhead);

    expect(deadhead?.lineDash.length).toBeGreaterThan(0);
  });
});

describe('着色モード（仕様書 §6.2.4）', () => {
  it('既定はパターンの色', () => {
    setTrips([makeTrip('t1', 'S1', [8, 0])]);
    expect(selectDiagramScene(state(), theme).trips[0]?.color).toBe(
      network.findPattern('S1')?.color,
    );
  });

  it('**運用で着色すると、同じ運用の便が同じ色になる**', () => {
    setTrips([
      makeTrip('t1', 'S1', [8, 0], { blockId: 'A' }),
      makeTrip('t2', 'T1', [9, 0], { blockId: 'A' }),
      makeTrip('t3', 'S1', [10, 0], { blockId: 'B' }),
    ]);
    setView((view) => {
      view.colorMode = 'block';
    });
    const { trips } = selectDiagramScene(state(), theme);

    expect(trips[0]?.color).toBe(trips[1]?.color);
    expect(trips[0]?.color).not.toBe(trips[2]?.color);
  });

  it('**回送も元の便と同じ運用の色になる**', () => {
    setTrips([makeTrip('t1', 'S1', [8, 0], { pullOut: true })]);
    setView((view) => {
      view.colorMode = 'block';
    });
    const { trips } = selectDiagramScene(state(), theme);

    expect(new Set(trips.map((trip) => trip.color)).size).toBe(1);
  });

  it('運用番号が空欄の便はパターンの色で描く', () => {
    setTrips([makeTrip('t1', 'S1', [8, 0], { blockId: '' })]);
    setView((view) => {
      view.colorMode = 'block';
    });

    expect(selectDiagramScene(state(), theme).trips[0]?.color).toBe(
      network.findPattern('S1')?.color,
    );
  });

  it('**隠されている便も色の割り当てに数える**（表示を切り替えて色が入れ替わらない）', () => {
    setTrips([
      makeTrip('t1', 'S1', [8, 0], { blockId: 'A' }),
      makeTrip('t2', 'S1', [9, 0], { blockId: 'B' }),
    ]);
    setView((view) => {
      view.colorMode = 'block';
    });
    const before = selectDiagramScene(state(), theme).trips[1]?.color;

    setView((view) => {
      view.hiddenBlockIds = ['A'];
    });
    const [remaining] = selectDiagramScene(state(), theme).trips;

    expect(remaining?.blockId).toBe('B');
    expect(remaining?.color).toBe(before);
  });
});

describe('表示フィルタ（仕様書 §6.2.4）', () => {
  beforeEach(() => {
    setTrips([
      makeTrip('t1', 'S1', [8, 0], { blockId: 'A', pullOut: true }),
      makeTrip('t2', 'T1', [9, 0], { blockId: 'B' }),
    ]);
  });

  it('既定では全部出る（回送も含む）', () => {
    expect(tripIds()).toEqual(['t1#out', 't1', 't2']);
  });

  it('パターンを隠す', () => {
    setView((view) => {
      view.hiddenPatternIds = ['S1'];
    });
    expect(tripIds()).toEqual(['t2']);
  });

  it('運用を隠す', () => {
    setView((view) => {
      view.hiddenBlockIds = ['B'];
    });
    expect(tripIds()).toEqual(['t1#out', 't1']);
  });

  it('方向を隠す', () => {
    setView((view) => {
      view.hiddenDirections = [1];
    });
    expect(tripIds()).toEqual(['t1#out', 't1']);
  });

  it('回送だけを隠す', () => {
    setView((view) => {
      view.showDeadhead = false;
    });
    expect(tripIds()).toEqual(['t1', 't2']);
  });

  it('**営業便を隠すと、その出区・入区も消える**（回送は元の便の一部である）', () => {
    setView((view) => {
      view.hiddenPatternIds = ['S1'];
    });
    expect(tripIds()).not.toContain('t1#out');
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

  it('**拡大率やスクロール位置が変わってもスジは作り直さない**（パンのたびに組み直さない）', () => {
    setTrips([makeTrip('t1', 'S1', [8, 0])]);
    const before = selectDiagramScene(state(), theme);

    setView((view) => {
      view.diagram.pxPerMinute = 6;
      view.diagram.scrollTime = fromHM(9, 0);
    });

    expect(selectDiagramScene(state(), theme).trips).toBe(before.trips);
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
