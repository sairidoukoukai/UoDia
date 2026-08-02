/**
 * スジの検証（T-26、仕様書 §6.2.2）。
 *
 * canvas は使わない。引かれた線分と置かれた文字を覚えるだけの `ctx` に描かせ、
 * **傾き・線種・色・番号の位置**を数値で確かめる。
 */

import { describe, expect, it } from 'vitest';
import { fromHM, type Seconds } from '@/domain/time';
import { drawTrips, isTripVisible, tripPolyline } from './drawTrips';
import { Recorder } from './recorder.test-utils';
import type { DiagramScene, SceneStop, SceneTrip } from './scene';
import { AXIS_LABEL_WIDTH, axisToY, timeToX, viewportOf, type Viewport } from './viewport';

const theme = {
  background: '#ffffff',
  axis: '#cccccc',
  grid: '#e4e4e4',
  gridFaint: '#f0f0f0',
  label: '#666666',
  lane: '#f4f4f4',
};

/** route.json と同じ並び。 */
const stops: readonly SceneStop[] = [
  { stopId: '1_0', shortName: '豊中', axisPosition: 0, gridStyle: 'bold', isDepot: false },
  { stopId: '2_0', shortName: '箕面', axisPosition: 20, gridStyle: 'bold', isDepot: false },
  {
    stopId: '3_0',
    shortName: 'コンベ前',
    axisPosition: 33,
    gridStyle: 'normal',
    isDepot: false,
  },
  { stopId: '4_0', shortName: '工学部', axisPosition: 40, gridStyle: 'bold', isDepot: false },
  { stopId: '9_0', shortName: '車庫', axisPosition: 52, gridStyle: 'dashed', isDepot: true },
];

/** 吹田方面の直行便。箕面学舎（20）を経由しない。 */
function through(overrides: Partial<SceneTrip> = {}): SceneTrip {
  return {
    tripId: 't1',
    sourceTripId: 't1',
    patternId: 'S1',
    color: '#1a4f8a',
    lineDash: [],
    directionId: 0,
    isDeadhead: false,
    blockId: 'A',
    tripNumber: 'E1',
    points: [
      { stopId: '1_0', time: fromHM(8, 0) },
      { stopId: '3_0', time: fromHM(8, 25) },
      { stopId: '4_0', time: fromHM(8, 30) },
    ],
    ...overrides,
  };
}

/** 豊中方面の便（工学部前から豊中学舎へ）。 */
function inbound(overrides: Partial<SceneTrip> = {}): SceneTrip {
  return {
    ...through({
      tripId: 't2',
      sourceTripId: 't2',
      patternId: 'T1',
      color: '#a63a2e',
      directionId: 1,
      tripNumber: 'W1',
      points: [
        { stopId: '4_0', time: fromHM(9, 0) },
        { stopId: '3_0', time: fromHM(9, 5) },
        { stopId: '1_0', time: fromHM(9, 30) },
      ],
    }),
    ...overrides,
  };
}

/** 出庫回送（車庫 → 豊中学舎）。 */
function pullOut(overrides: Partial<SceneTrip> = {}): SceneTrip {
  return {
    ...through({
      tripId: 't1#out',
      sourceTripId: 't1',
      patternId: 'DS-out',
      color: '#8a8a8a',
      lineDash: [5, 4],
      isDeadhead: true,
      tripNumber: '',
      points: [
        { stopId: '9_0', time: fromHM(7, 40) },
        { stopId: '1_0', time: fromHM(8, 0) },
      ],
    }),
    ...overrides,
  };
}

function sceneOf(
  trips: readonly SceneTrip[],
  selected: readonly string[] = [],
  selectionRect: DiagramScene['selectionRect'] = null,
  tripShift: DiagramScene['tripShift'] = null,
): DiagramScene {
  return { stops, trips, selectedTripIds: new Set(selected), selectionRect, tripShift, theme };
}

const viewport: Viewport = viewportOf(
  { pxPerMinute: 3, pxPerAxisUnit: 6, scrollTime: fromHM(7, 0), scrollAxis: 0 },
  1000,
  420,
);

function draw(
  trips: readonly SceneTrip[],
  selected: readonly string[] = [],
  overrides: Partial<Viewport> = {},
): Recorder {
  const ctx = new Recorder();
  drawTrips(ctx, sceneOf(trips, selected), { ...viewport, ...overrides });
  return ctx;
}

describe('折れ線', () => {
  it('折れ点をつないで 1 本の線になる', () => {
    const segments = draw([through()]).segments;

    expect(segments).toHaveLength(2);
    expect(segments[0]?.x1).toBe(timeToX(fromHM(8, 0), viewport));
    expect(segments[0]?.y1).toBe(axisToY(0, viewport));
    expect(segments.at(-1)?.y2).toBe(axisToY(40, viewport));
  });

  it('**直行便は箕面学舎で折れない**（縦軸の 20 を貫通する）', () => {
    const points = tripPolyline(through(), sceneOf([]), viewport);

    expect(points.map((point) => point.y)).not.toContain(axisToY(20, viewport));
    // 豊中学舎（0）からコンベンションセンター前（33）へ一気に下る線が、
    // 箕面学舎（20）の高さを横切っている。
    const [first, second] = points;
    expect(first?.y).toBeLessThan(axisToY(20, viewport));
    expect(second?.y).toBeGreaterThan(axisToY(20, viewport));
  });

  it('**吹田方面は右下がり、豊中方面は右上がり**（仕様書 §6.2.1）', () => {
    const outward = tripPolyline(through(), sceneOf([]), viewport);
    const homeward = tripPolyline(inbound(), sceneOf([]), viewport);

    expect(outward.at(-1)?.x).toBeGreaterThan(outward[0]?.x ?? 0);
    expect(outward.at(-1)?.y).toBeGreaterThan(outward[0]?.y ?? 0);

    expect(homeward.at(-1)?.x).toBeGreaterThan(homeward[0]?.x ?? 0);
    expect(homeward.at(-1)?.y).toBeLessThan(homeward[0]?.y ?? 0);
  });

  it('パターンの色と線種で描く（§9.4）', () => {
    const segments = draw([through({ lineDash: [8, 4] })]).segments;

    expect(segments[0]?.strokeStyle).toBe('#1a4f8a');
    expect(segments[0]?.dash).toEqual([8, 4]);
  });

  it('罫線より太く描く（格子に沈まない）', () => {
    expect(draw([through()]).segments[0]?.lineWidth).toBeGreaterThan(1);
  });
});

describe('回送スジ', () => {
  it('**破線で描き、営業所レーンに繋がる**（§6.2.2）', () => {
    const segments = draw([pullOut()]).segments;

    expect(segments[0]?.dash).toEqual([5, 4]);
    // 千里営業所（52）から豊中学舎（0）へ。
    expect(segments[0]?.y1).toBe(axisToY(52, viewport));
    expect(segments[0]?.y2).toBe(axisToY(0, viewport));
  });

  it('番号は付けない（回送は便番号を持たない）', () => {
    expect(draw([pullOut()]).labels).toEqual([]);
  });

  it('**営業スジより細い**（運用で着色すると色も線種も似るため）', () => {
    const deadhead = draw([pullOut()]).segments[0]?.lineWidth ?? 0;
    const revenue = draw([through()]).segments[0]?.lineWidth ?? 0;

    expect(deadhead).toBeLessThan(revenue);
    // 選んだときも細いままである（太さの差が消えない）。
    const selectedDeadhead = draw([pullOut()], ['t1']).segments[0]?.lineWidth ?? 0;
    const selectedRevenue = draw([through()], ['t1']).segments[0]?.lineWidth ?? 0;
    expect(selectedDeadhead).toBeLessThan(selectedRevenue);
  });

  it('**元の便を選ぶと回送も太くなる**（同じ便の一部である）', () => {
    const normal = draw([pullOut()]).segments[0]?.lineWidth ?? 0;
    const selected = draw([pullOut()], ['t1']).segments[0]?.lineWidth ?? 0;

    expect(selected).toBeGreaterThan(normal);
  });
});

describe('選択の強調（仕様書 §6.2.2）', () => {
  it('太線で描く', () => {
    const plain = draw([through()]).segments[0]?.lineWidth ?? 0;
    const bold = draw([through()], ['t1']).segments[0]?.lineWidth ?? 0;

    expect(bold).toBeGreaterThan(plain);
  });

  it('**端点にハンドルを置く**', () => {
    const rects = draw([through()], ['t1']).rects;

    expect(rects).toHaveLength(2);
    expect(rects[0]?.fillStyle).toBe('#1a4f8a');
    // 始点（8:00・豊中学舎）と終点（8:30・工学部前）を囲む。
    expect(rects[0]?.x).toBeCloseTo(timeToX(fromHM(8, 0), viewport) - 3.5, 5);
    expect(rects[1]?.y).toBeCloseTo(axisToY(40, viewport) - 3.5, 5);
  });

  it('選んでいない便にハンドルは出ない', () => {
    expect(draw([through()]).rects).toEqual([]);
  });

  it('**選択されたスジを後から描く**（他の線の下に潜らない）', () => {
    const segments = draw([through(), inbound()], ['t1']).segments;

    // 豊中方面（W1）が先、選択された吹田方面（E1）が後。
    expect(segments[0]?.strokeStyle).toBe('#a63a2e');
    expect(segments.at(-1)?.strokeStyle).toBe('#1a4f8a');
  });
});

describe('便番号ラベル', () => {
  it('始点の近くに置く', () => {
    const [label] = draw([through()]).labels;

    expect(label?.text).toBe('E1');
    expect(label?.x).toBeGreaterThan(timeToX(fromHM(8, 0), viewport));
    expect(label?.fillStyle).toBe('#1a4f8a');
  });

  it('**上に余地が無ければ下へ回す**（縦軸の一番上から始まる便）', () => {
    // 吹田方面の始点は豊中学舎（軸位置 0 = 描画領域の上端）。
    const [label] = draw([through()]).labels;
    expect(label?.y).toBeGreaterThanOrEqual(viewport.originY);
  });

  it('上に余地があれば上に置く', () => {
    // 豊中方面の始点は工学部前（軸位置 40）。
    const [label] = draw([inbound()]).labels;
    expect(label?.y).toBeLessThan(axisToY(40, viewport));
  });

  it('**重なる番号は落とす**（どれも読めなくなるより 1 つを読める）', () => {
    // 同じ時刻・同じ停留所から出る便を 5 本。番号を置けるのは 1 つだけ。
    const crowd = [0, 1, 2, 3, 4].map((index) =>
      through({ tripId: `t${String(index)}`, tripNumber: `E${String(index)}` }),
    );

    expect(draw(crowd).labels).toHaveLength(1);
    // 線は 5 本とも引かれている（落ちるのは番号だけ）。
    expect(draw(crowd).segments).toHaveLength(10);
  });

  it('離れていれば両方に置く', () => {
    const later = through({
      tripId: 't3',
      tripNumber: 'E3',
      points: through().points.map((point) => ({ ...point, time: (point.time + 3600) as Seconds })),
    });

    expect(draw([through(), later]).labels).toHaveLength(2);
  });
});

describe('囲んでいる最中の枠（T-28）', () => {
  const rect = { fromTime: fromHM(8, 0), toTime: fromHM(9, 0), fromAxis: 0, toAxis: 40 };

  it('**破線の輪郭だけを描く**（塗ると下のスジが隠れる）', () => {
    const ctx = new Recorder();
    drawTrips(ctx, sceneOf([], [], rect), viewport);

    // 4 辺。塗りは無い。
    expect(ctx.segments).toHaveLength(4);
    expect(ctx.rects).toEqual([]);
    expect(ctx.segments[0]?.dash).toEqual([4, 3]);
    // 罫線と同じ色にすると格子の一部に見える。文字と同じ濃さにする。
    expect(ctx.segments[0]?.strokeStyle).toBe(theme.label);
  });

  it('囲んだ範囲に合わせて置く', () => {
    const ctx = new Recorder();
    drawTrips(ctx, sceneOf([], [], rect), viewport);

    expect(ctx.segments[0]?.x1).toBe(timeToX(fromHM(8, 0), viewport));
    expect(ctx.segments[0]?.y1).toBe(axisToY(0, viewport));
    expect(ctx.segments[1]?.x2).toBe(timeToX(fromHM(9, 0), viewport));
    expect(ctx.segments[1]?.y2).toBe(axisToY(40, viewport));
  });

  it('掴んでいなければ枠は出ない', () => {
    expect(draw([]).segments).toEqual([]);
  });
});

describe('引きずっている最中の移動量（T-29）', () => {
  const shift = { minutes: 15, atTime: fromHM(9, 0), atAxis: 20 };

  it('**カーソルの近くに数字で出す**（仕様書 §6.3.2）', () => {
    const ctx = new Recorder();
    drawTrips(ctx, sceneOf([], [], null, shift), viewport);

    const [label] = ctx.labels;
    expect(label?.text).toBe('+15 分');
    expect(label?.x).toBeGreaterThan(timeToX(fromHM(9, 0), viewport));
    expect(label?.y).toBeLessThan(axisToY(20, viewport));
  });

  it('早める向きには符号が付く', () => {
    const ctx = new Recorder();
    drawTrips(ctx, sceneOf([], [], null, { ...shift, minutes: -15 }), viewport);

    expect(ctx.labels[0]?.text).toBe('-15 分');
  });

  it('掴んでいなければ出ない', () => {
    expect(draw([]).labels).toEqual([]);
  });
});

describe('カリング（仕様書 §6.2.2）', () => {
  it('視野の外の便は描かない', () => {
    // 右端は 11:45 ごろ。13:00 発の便は入らない。
    const late = through({
      points: [
        { stopId: '1_0', time: fromHM(13, 0) },
        { stopId: '4_0', time: fromHM(13, 30) },
      ],
    });

    expect(isTripVisible(late, viewport)).toBe(false);
    expect(draw([late]).segments).toEqual([]);
  });

  it('**視野をまたいで通り過ぎる便は描く**', () => {
    // 6:00 発 20:00 着（あり得ない便だが、判定の境目を突く）。
    const across = through({
      points: [
        { stopId: '1_0', time: fromHM(6, 0) },
        { stopId: '4_0', time: fromHM(20, 0) },
      ],
    });

    expect(isTripVisible(across, viewport)).toBe(true);
  });

  it('端で切れる便は残す', () => {
    const edge = through({
      points: [
        { stopId: '1_0', time: fromHM(11, 40) },
        { stopId: '4_0', time: fromHM(12, 10) },
      ],
    });

    expect(isTripVisible(edge, viewport)).toBe(true);
  });

  it('折れ点の無い便は線にならない', () => {
    expect(isTripVisible(through({ points: [] }), viewport)).toBe(false);
    expect(draw([through({ points: [] })]).segments).toEqual([]);
  });
});

describe('描画領域から出さない', () => {
  it('**表示範囲に切り取ってから描く**（停留所名の欄を汚さない）', () => {
    const [clip] = draw([through()]).clips;

    expect(clip).toEqual({
      x: AXIS_LABEL_WIDTH,
      y: viewport.originY,
      width: 1000 - AXIS_LABEL_WIDTH,
      height: 420 - viewport.originY,
    });
  });

  it('表示範囲が視野の外なら何も描かない', () => {
    const ctx = draw([through()], [], { startTime: fromHM(22, 0) });

    expect(ctx.segments).toEqual([]);
    expect(ctx.clips).toEqual([]);
  });
});

describe('性能（受入条件: 100 便で 60fps）', () => {
  it('**100 便のスジを 1 フレーム（16.7ms）より速く描く**', () => {
    // 5 分ごとに 100 便。座標の組み立てとラベルの重なり判定を含む。
    const many = Array.from({ length: 100 }, (_, index) =>
      through({
        tripId: `t${String(index)}`,
        sourceTripId: `t${String(index)}`,
        tripNumber: `E${String(index)}`,
        points: through().points.map((point) => ({
          ...point,
          time: (point.time + index * 300) as Seconds,
        })),
      }),
    );
    const scene = sceneOf(many, ['t50']);

    // **最も速かった 1 回を採る。** 他の試験と並んで走るため、平均には混み合いの
    // 影響が混じる。測りたいのは描画そのものにかかる時間である。
    let perFrame = Number.POSITIVE_INFINITY;
    for (let batch = 0; batch < 5; batch += 1) {
      const started = performance.now();
      for (let i = 0; i < 10; i += 1) drawTrips(new Recorder(), scene, viewport);
      perFrame = Math.min(perFrame, (performance.now() - started) / 10);
    }

    // 記録役への呼び出しぶんも含んだ値である。実際のラスタライズは含まない。
    expect(perFrame).toBeLessThan(16.7);
  });
});
