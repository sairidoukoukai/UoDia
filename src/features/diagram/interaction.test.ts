/**
 * 送りと拡げの検証（T-27、仕様書 §6.2.3）。
 *
 * **受入条件は「拡大縮小の中心がカーソル位置に固定される」である。** 掴んで
 * いる場所が動くと、拡げるたびに見ていた便を探し直すことになる。ここでは
 * 「カーソルの下の時刻が変わらない」ことを座標で確かめる。
 */

import { describe, expect, it } from 'vitest';
import { DIAGRAM_ZOOM_LIMITS, type DiagramView } from '@/domain/model';
import { fromHM } from '@/domain/time';
import {
  axisBoundsOf,
  clampScroll,
  DEFAULT_DIAGRAM_VIEW,
  sameView,
  viewAfterDrag,
  viewAfterWheel,
  type AxisBounds,
  type WheelInput,
} from './interaction';
import type { DiagramScene } from './scene';
import { AXIS_LABEL_WIDTH, viewportOf, xToTime, yToAxis, type Viewport } from './viewport';

const view: DiagramView = DEFAULT_DIAGRAM_VIEW;
const viewport: Viewport = viewportOf(view, 1000, 420);

/** 縦軸の範囲（0〜40）。営業所は縦軸に並ばない（#118）。 */
const bounds: AxisBounds = { min: 0, max: 40 };

function wheel(overrides: Partial<WheelInput> = {}): WheelInput {
  return {
    deltaX: 0,
    deltaY: 0,
    zoomKey: false,
    shiftKey: false,
    x: 500,
    y: 200,
    ...overrides,
  };
}

/** その視野で、その画面位置に見えている時刻。 */
const timeAt = (x: number, of: DiagramView): number => xToTime(x, viewportOf(of, 1000, 420));
const axisAt = (y: number, of: DiagramView): number => yToAxis(y, viewportOf(of, 1000, 420));

describe('横方向の拡大縮小（Ctrl + ホイール）', () => {
  it('上に回すと拡がる', () => {
    const next = viewAfterWheel(view, wheel({ zoomKey: true, deltaY: -100 }), viewport, bounds);
    expect(next.pxPerMinute).toBeGreaterThan(view.pxPerMinute);
  });

  it('下に回すと縮む', () => {
    const next = viewAfterWheel(view, wheel({ zoomKey: true, deltaY: 100 }), viewport, bounds);
    expect(next.pxPerMinute).toBeLessThan(view.pxPerMinute);
  });

  it('**カーソルの下の時刻が動かない**（受入条件）', () => {
    for (const x of [AXIS_LABEL_WIDTH, 300, 700, 999]) {
      const before = timeAt(x, view);
      const next = viewAfterWheel(
        view,
        wheel({ zoomKey: true, deltaY: -120, x }),
        viewport,
        bounds,
      );

      expect(timeAt(x, next)).toBeCloseTo(before, 6);
    }
  });

  it('縮めても中心が動かない', () => {
    const zoomed = { ...view, pxPerMinute: 12, scrollTime: fromHM(9, 0) };
    const at = viewportOf(zoomed, 1000, 420);
    const before = timeAt(600, zoomed);
    const next = viewAfterWheel(zoomed, wheel({ zoomKey: true, deltaY: 120, x: 600 }), at, bounds);

    expect(timeAt(600, next)).toBeCloseTo(before, 6);
  });

  it('**縦の拡大率は変わらない**', () => {
    const next = viewAfterWheel(view, wheel({ zoomKey: true, deltaY: -100 }), viewport, bounds);
    expect(next.pxPerAxisUnit).toBe(view.pxPerAxisUnit);
  });

  it('上限・下限で止まる', () => {
    let zoomed = view;
    for (let i = 0; i < 40; i += 1) {
      zoomed = viewAfterWheel(zoomed, wheel({ zoomKey: true, deltaY: -200 }), viewport, bounds);
    }
    expect(zoomed.pxPerMinute).toBe(DIAGRAM_ZOOM_LIMITS.maxPxPerMinute);

    for (let i = 0; i < 80; i += 1) {
      zoomed = viewAfterWheel(zoomed, wheel({ zoomKey: true, deltaY: 200 }), viewport, bounds);
    }
    expect(zoomed.pxPerMinute).toBe(DIAGRAM_ZOOM_LIMITS.minPxPerMinute);
  });
});

describe('縦方向の拡大縮小（Ctrl+Shift + ホイール）', () => {
  it('縦だけが変わる', () => {
    const next = viewAfterWheel(
      view,
      wheel({ zoomKey: true, shiftKey: true, deltaY: -100 }),
      viewport,
      bounds,
    );

    expect(next.pxPerAxisUnit).toBeGreaterThan(view.pxPerAxisUnit);
    expect(next.pxPerMinute).toBe(view.pxPerMinute);
  });

  it('**カーソルの下の停留所が動かない**', () => {
    // 全体が入っている状態では送りが端に寄るため、拡げた状態から始める。
    const zoomed = { ...view, pxPerAxisUnit: 20, scrollAxis: 10 };
    const at = viewportOf(zoomed, 1000, 420);
    const before = axisAt(300, zoomed);
    const next = viewAfterWheel(
      zoomed,
      wheel({ zoomKey: true, shiftKey: true, deltaY: -100, y: 300 }),
      at,
      bounds,
    );

    expect(axisAt(300, next)).toBeCloseTo(before, 6);
  });
});

describe('スクロール', () => {
  it('ホイールは縦に送る', () => {
    const zoomed = { ...view, pxPerAxisUnit: 20 };
    const next = viewAfterWheel(
      zoomed,
      wheel({ deltaY: 100 }),
      viewportOf(zoomed, 1000, 420),
      bounds,
    );

    expect(next.scrollAxis).toBeGreaterThan(zoomed.scrollAxis);
    expect(next.scrollTime).toBe(zoomed.scrollTime);
  });

  it('**Shift + ホイールは横に送る**', () => {
    const next = viewAfterWheel(view, wheel({ shiftKey: true, deltaY: 100 }), viewport, bounds);

    expect(next.scrollTime).toBeGreaterThan(view.scrollTime);
    expect(next.scrollAxis).toBe(view.scrollAxis);
  });

  it('横回転を持つ装置ではそちらを使う', () => {
    const next = viewAfterWheel(
      view,
      wheel({ shiftKey: true, deltaX: 60, deltaY: 0 }),
      viewport,
      bounds,
    );
    expect(next.scrollTime).toBeGreaterThan(view.scrollTime);
  });

  it('送った量は px と拡大率で決まる（1 分 3px なら 90px で 30 分）', () => {
    const next = viewAfterWheel(view, wheel({ shiftKey: true, deltaY: 90 }), viewport, bounds);
    expect(next.scrollTime - view.scrollTime).toBe(30 * 60);
  });
});

describe('掴んで動かす（中ボタン・スペース + 引きずり）', () => {
  it('**右へ引きずると前の時刻へ戻る**（紙をずらす向き）', () => {
    const scrolled = { ...view, scrollTime: fromHM(10, 0) };
    const next = viewAfterDrag(scrolled, 90, 0, viewportOf(scrolled, 1000, 420), bounds);

    expect(next.scrollTime).toBe(fromHM(10, 0) - 30 * 60);
  });

  it('下へ引きずると上の停留所へ戻る', () => {
    const zoomed = { ...view, pxPerAxisUnit: 20, scrollAxis: 20 };
    const next = viewAfterDrag(zoomed, 0, 40, viewportOf(zoomed, 1000, 420), bounds);

    expect(next.scrollAxis).toBe(18);
  });
});

describe('送りの範囲', () => {
  it('**7:00 より前へは送らない**', () => {
    const next = viewAfterDrag(view, 600, 0, viewport, bounds);
    expect(next.scrollTime).toBe(fromHM(7, 0));
  });

  it('**22:00 より後ろへは送らない**（右端が表示範囲の外に出ない）', () => {
    const zoomed = { ...view, pxPerMinute: 6 };
    const at = viewportOf(zoomed, 1000, 420);
    const next = viewAfterDrag(zoomed, -100_000, 0, at, bounds);

    // 右端がちょうど 22:00 になる位置で止まる。
    expect(xToTime(1000, viewportOf(next, 1000, 420))).toBeCloseTo(fromHM(22, 0), 6);
  });

  it('**全体が入っているときは端に寄せる**（何も無い場所へ迷い込ませない）', () => {
    // 既定では縦軸（0〜40）が画面に収まっている。
    const next = viewAfterWheel(view, wheel({ deltaY: 500 }), viewport, bounds);
    expect(next.scrollAxis).toBe(0);
  });

  it('縦に拡げると送れるようになる', () => {
    const zoomed = { ...view, pxPerAxisUnit: 30 };
    const next = viewAfterWheel(
      zoomed,
      wheel({ deltaY: 300 }),
      viewportOf(zoomed, 1000, 420),
      bounds,
    );

    expect(next.scrollAxis).toBeGreaterThan(0);
    // 下端も縦軸の外へは出ない。
    expect(next.scrollAxis).toBeLessThanOrEqual(52);
  });

  it('停留所が無ければ縦には動かない', () => {
    const empty: DiagramScene = {
      stops: [],
      trips: [],
      selectedTripIds: new Set(),
      selectionRect: null,
      tripShift: null,
      theme: {
        background: '#fff',
        axis: '#ccc',
        grid: '#e4e4e4',
        gridFaint: '#f0f0f0',
        label: '#666',
      },
    };
    const next = clampScroll({ ...view, scrollAxis: 30 }, viewport, axisBoundsOf(empty));

    expect(next.scrollAxis).toBe(0);
  });

  it('場面から縦軸の端を取る', () => {
    const scene = {
      stops: [
        { stopId: 'a', stopName: '', axisPosition: 0, gridStyle: 'bold' },
        { stopId: 'b', stopName: '', axisPosition: 40, gridStyle: 'dashed' },
      ],
    } as unknown as DiagramScene;

    expect(axisBoundsOf(scene)).toEqual({ min: 0, max: 40 });
  });
});

describe('既定に戻す（Ctrl+0）', () => {
  it('**スキーマの既定値と同じ**（新規作成した直後と同じ画面になる）', () => {
    expect(DEFAULT_DIAGRAM_VIEW).toEqual({
      pxPerMinute: 3,
      pxPerAxisUnit: 8,
      scrollTime: fromHM(7, 0),
      scrollAxis: 0,
    });
  });
});

describe('同じ視野か', () => {
  it('4 つの値がすべて同じなら同じ', () => {
    expect(sameView(view, { ...view })).toBe(true);
  });

  it('1 つでも違えば違う', () => {
    expect(sameView(view, { ...view, pxPerMinute: 3.0001 })).toBe(false);
    expect(sameView(view, { ...view, pxPerAxisUnit: 7 })).toBe(false);
    expect(sameView(view, { ...view, scrollTime: view.scrollTime + 1 })).toBe(false);
    expect(sameView(view, { ...view, scrollAxis: 1 })).toBe(false);
  });
});
