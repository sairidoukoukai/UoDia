/**
 * 重ねる順の検証（T-24／T-26、実装計画書 §3.5）。
 *
 * **受入条件は「引数 3 つで完結すること」である。** それを確かめるために、
 * canvas を一切使わず、記録するだけの `ctx` を渡す。実物の canvas が要らない
 * こと自体が、ストアも DOM も見ていない証拠になる。
 *
 * 個々の層の中身は `drawGrid.test.ts` と `drawTrips.test.ts` が見る。ここでは
 * **背景 → 格子 → スジ → 枠**の順に重なることだけを扱う。
 */

import { describe, expect, it } from 'vitest';
import { fromHM } from '@/domain/time';
import { drawDiagram } from './drawDiagram';
import { Recorder } from './recorder.test-utils';
import type { DiagramScene } from './scene';
import { AXIS_LABEL_WIDTH, TIME_LABEL_HEIGHT, viewportOf, type Viewport } from './viewport';

const theme = {
  background: '#ffffff',
  axis: '#cccccc',
  grid: '#e4e4e4',
  gridFaint: '#f0f0f0',
  label: '#666666',
  lane: '#f4f4f4',
};

const scene: DiagramScene = {
  stops: [
    { stopId: '1_0', stopName: '豊中学舎', axisPosition: 0, gridStyle: 'bold', isDepot: false },
    { stopId: '4_0', stopName: '工学部前', axisPosition: 40, gridStyle: 'bold', isDepot: false },
  ],
  trips: [
    {
      tripId: 't1',
      sourceTripId: 't1',
      patternId: 'S1',
      color: '#123456',
      lineDash: [],
      directionId: 0,
      isDeadhead: false,
      blockId: 'A',
      tripNumber: 'E1',
      points: [
        { stopId: '1_0', time: fromHM(8, 0) },
        { stopId: '4_0', time: fromHM(8, 30) },
      ],
    },
  ],
  selectedTripIds: new Set(),
  selectionRect: null,
  tripShift: null,
  theme,
};

const viewport: Viewport = viewportOf(
  { pxPerMinute: 3, pxPerAxisUnit: 6, scrollTime: fromHM(7, 0), scrollAxis: 0 },
  1000,
  600,
);

function draw(view: Viewport = viewport, target: DiagramScene = scene): Recorder {
  const ctx = new Recorder();
  drawDiagram(ctx, target, view);
  return ctx;
}

describe('drawDiagram', () => {
  it('**canvas が無くても描ける**（引数 3 つで完結する）', () => {
    const ctx = draw();
    expect(ctx.segments.length).toBeGreaterThan(0);
  });

  it('**背景を塗る**（書き出し先は透明で始まる）', () => {
    const [background] = draw().rects;

    expect(background).toMatchObject({ x: 0, y: 0, width: 1000, height: 600 });
    expect(background?.fillStyle).toBe(theme.background);
  });

  it('描画領域の枠を描く', () => {
    const segments = draw().segments;
    // 縦軸は左端を下まで、横軸は上端を右まで。
    expect(segments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          x1: AXIS_LABEL_WIDTH,
          y1: TIME_LABEL_HEIGHT,
          x2: AXIS_LABEL_WIDTH,
          y2: 600,
        }),
        expect.objectContaining({
          x1: AXIS_LABEL_WIDTH,
          y1: TIME_LABEL_HEIGHT,
          x2: 1000,
          y2: TIME_LABEL_HEIGHT,
        }),
      ]),
    );
  });

  it('**枠は実線で描く**（格子が残した破線を引き継がない）', () => {
    const frame = draw().segments.filter(
      (segment) => segment.x1 === AXIS_LABEL_WIDTH && segment.x2 === AXIS_LABEL_WIDTH,
    );

    expect(frame.at(-1)?.dash).toEqual([]);
  });

  it('**格子より後にスジを描く**（スジが罫線に埋もれない）', () => {
    const segments = draw().segments;
    const lastGrid = segments.findLastIndex((segment) => segment.strokeStyle === theme.grid);
    const trip = segments.findIndex((segment) => segment.strokeStyle === '#123456');

    expect(trip).toBeGreaterThan(lastGrid);
  });

  it('**同じ入力から同じ絵が出る**（回帰テストの土台）', () => {
    expect(draw().segments).toEqual(draw().segments);
    expect(draw().labels).toEqual(draw().labels);
  });
});

describe('書き出し（v2）の前提', () => {
  it('**4 倍の大きさ・全時間範囲でも同じ関数で描ける**', () => {
    const exportViewport: Viewport = {
      ...viewport,
      startTime: fromHM(7, 0),
      pxPerMinute: 12,
      width: 11000,
      height: 2400,
    };
    const ctx = draw(exportViewport);

    // 背景は canvas 全体を覆う。
    expect(ctx.rects[0]).toMatchObject({ width: 11000, height: 2400 });
    // 7:00〜22:00 の 5 分線まで（15 時間 × 12 + 1 本）。
    expect(ctx.segments.filter((segment) => segment.x1 === segment.x2).length).toBeGreaterThan(180);
    // スジも同じ関数で描かれている。
    expect(ctx.segments.some((segment) => segment.strokeStyle === '#123456')).toBe(true);
  });
});
