/**
 * 描画関数の検証（T-24、実装計画書 §3.5）。
 *
 * **受入条件は「引数 3 つで完結すること」である。** それを確かめるために、
 * canvas を一切使わず、呼び出しを記録するだけの `ctx` を渡す。実物の canvas が
 * 要らないこと自体が、ストアも DOM も見ていない証拠になる。
 *
 * あわせて、**画面と違う大きさ・違う時間範囲でも同じ関数で描ける**ことを見る。
 * v2 の画像書き出しはこれだけを前提にしている。
 */

import { describe, expect, it } from 'vitest';
import { fromHM } from '@/domain/time';
import { drawDiagram, tripPolyline, type DrawContext } from './drawDiagram';
import type { DiagramScene } from './scene';
import { AXIS_LABEL_WIDTH, TIME_LABEL_HEIGHT, viewportOf, type Viewport } from './viewport';

/** 呼び出しを順に覚えるだけの描画先。 */
function recorder(): DrawContext & { readonly calls: string[] } {
  const calls: string[] = [];
  const push = (name: string, args: readonly number[] = []): void => {
    calls.push(`${name}(${args.map((value) => String(Math.round(value))).join(',')})`);
  };

  return {
    calls,
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    font: '',
    textAlign: 'start',
    textBaseline: 'alphabetic',
    save: (): void => {
      push('save');
    },
    restore: (): void => {
      push('restore');
    },
    clearRect: (x, y, w, h): void => {
      push('clearRect', [x, y, w, h]);
    },
    fillRect: (x, y, w, h): void => {
      push('fillRect', [x, y, w, h]);
    },
    beginPath: (): void => {
      push('beginPath');
    },
    moveTo: (x, y): void => {
      push('moveTo', [x, y]);
    },
    lineTo: (x, y): void => {
      push('lineTo', [x, y]);
    },
    stroke: (): void => {
      push('stroke');
    },
    setLineDash: (dash): void => {
      push('setLineDash', [...dash]);
    },
    fillText: (text, x, y): void => {
      calls.push(`fillText(${text},${String(Math.round(x))},${String(Math.round(y))})`);
    },
  };
}

const scene: DiagramScene = {
  stops: [
    {
      stopId: '1_0',
      stopName: '豊中学舎',
      axisPosition: 0,
      gridStyle: 'normal',
      isDepot: false,
    },
    {
      stopId: '4_0',
      stopName: '工学部前',
      axisPosition: 40,
      gridStyle: 'normal',
      isDepot: false,
    },
  ],
  trips: [
    {
      tripId: 't1',
      patternId: 'S1',
      color: '#123456',
      directionId: 0,
      isDeadhead: false,
      blockId: 'A',
      points: [
        { stopId: '1_0', time: fromHM(8, 0) },
        { stopId: '4_0', time: fromHM(8, 30) },
      ],
    },
  ],
  selectedTripIds: new Set(),
  colorMode: 'pattern',
  tripNumbers: new Map([['t1', 'E1']]),
  theme: {
    background: '#ffffff',
    axis: '#cccccc',
    grid: '#e4e4e4',
    gridFaint: '#f0f0f0',
    label: '#666666',
    lane: '#f4f4f4',
  },
};

const viewport: Viewport = viewportOf(
  { pxPerMinute: 3, pxPerAxisUnit: 6, scrollTime: fromHM(7, 0), scrollAxis: 0 },
  1000,
  600,
);

describe('drawDiagram', () => {
  it('**canvas が無くても描ける**（引数 3 つで完結する）', () => {
    const ctx = recorder();
    drawDiagram(ctx, scene, viewport);

    expect(ctx.calls.length).toBeGreaterThan(0);
  });

  it('**背景を塗る**（書き出し先は透明で始まる）', () => {
    const ctx = recorder();
    drawDiagram(ctx, scene, viewport);

    expect(ctx.calls).toContain('clearRect(0,0,1000,600)');
    expect(ctx.calls).toContain('fillRect(0,0,1000,600)');
  });

  it('描画領域の枠を描く', () => {
    const ctx = recorder();
    drawDiagram(ctx, scene, viewport);

    // 縦軸は左端を下まで、横軸は上端を右まで。
    expect(ctx.calls).toContain(`moveTo(${String(AXIS_LABEL_WIDTH)},${String(TIME_LABEL_HEIGHT)})`);
    expect(ctx.calls).toContain(`lineTo(${String(AXIS_LABEL_WIDTH)},600)`);
    expect(ctx.calls).toContain(`lineTo(1000,${String(TIME_LABEL_HEIGHT)})`);
  });

  it('**状態を書き換えない**（save と restore で挟む）', () => {
    const ctx = recorder();
    drawDiagram(ctx, scene, viewport);

    expect(ctx.calls[0]).toBe('save()');
    expect(ctx.calls.at(-1)).toBe('restore()');
  });

  it('**同じ入力から同じ呼び出しが出る**（回帰テストの土台）', () => {
    const first = recorder();
    const second = recorder();
    drawDiagram(first, scene, viewport);
    drawDiagram(second, scene, viewport);

    expect(first.calls).toEqual(second.calls);
  });
});

describe('書き出し（v2）の前提', () => {
  it('**4 倍の大きさ・別の時間範囲でも同じ関数で描ける**', () => {
    const exportViewport: Viewport = {
      ...viewport,
      startTime: fromHM(0, 0),
      pxPerMinute: 12,
      width: 4000,
      height: 2400,
    };

    const ctx = recorder();
    drawDiagram(ctx, scene, exportViewport);

    expect(ctx.calls).toContain('fillRect(0,0,4000,2400)');
    expect(ctx.calls).toContain('lineTo(4000,24)');
  });
});

describe('スジの座標', () => {
  it('**折れ点が時刻と軸位置から決まる**', () => {
    // 8:00 は 7:00 から 60 分後 → 112 + 180。工学部前は軸位置 40 → 24 + 240。
    expect(tripPolyline(scene.trips[0]!, scene, viewport)).toEqual([
      { x: AXIS_LABEL_WIDTH + 180, y: TIME_LABEL_HEIGHT },
      { x: AXIS_LABEL_WIDTH + 270, y: TIME_LABEL_HEIGHT + 240 },
    ]);
  });

  it('**吹田方面は右下がりになる**（§6.2.1）', () => {
    const points = tripPolyline(scene.trips[0]!, scene, viewport);
    const [first, last] = [points[0]!, points.at(-1)!];

    expect(last.x).toBeGreaterThan(first.x);
    expect(last.y).toBeGreaterThan(first.y);
  });

  it('縦軸に無い停留所は座標を持たない', () => {
    const withHidden = {
      ...scene,
      trips: [
        {
          ...scene.trips[0]!,
          points: [...scene.trips[0]!.points, { stopId: '6_0', time: fromHM(8, 30) }],
        },
      ],
    };

    expect(tripPolyline(withHidden.trips[0]!, withHidden, viewport)).toHaveLength(2);
  });
});
