/**
 * 格子の検証（T-25、仕様書 §6.2.1〜§6.2.3）。
 *
 * T-24 と同じく、**canvas を一切使わない。** 引かれた線と置かれた文字を覚えるだけの
 * `ctx` を渡し、「どの位置に、どの太さで、何本引かれたか」を見る。実物の canvas が
 * 要らないことが、表示範囲を `viewport` 以外から取っていない証拠である。
 */

import { describe, expect, it } from 'vitest';
import { formatTime, fromHM, type Seconds } from '@/domain/time';
import type { DrawContext } from './drawDiagram';
import {
  MIN_STOP_LABEL_GAP,
  MIN_TIME_LABEL_GAP,
  depotLane,
  drawGrid,
  timeLabelStepMinutes,
  timeLines,
} from './drawGrid';
import type { DiagramScene, SceneStop, SceneTheme } from './scene';
import { axisToY, timeToX, viewportOf, xToTime, type Viewport } from './viewport';

interface Segment {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
  readonly strokeStyle: string;
  readonly lineWidth: number;
  readonly dash: readonly number[];
}

interface Label {
  readonly text: string;
  readonly x: number;
  readonly y: number;
  readonly align: CanvasTextAlign;
  readonly maxWidth: number | undefined;
}

interface Band {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly fillStyle: string;
}

/** 引かれた線と置かれた文字を覚えるだけの描画先。 */
class Recorder implements DrawContext {
  // 色は文字列しか渡さない。`String()` を挟まずに比べられる。
  fillStyle = '';
  strokeStyle = '';
  lineWidth = 1;
  font = '';
  textAlign: CanvasTextAlign = 'start';
  textBaseline: CanvasTextBaseline = 'alphabetic';

  readonly segments: Segment[] = [];
  readonly labels: Label[] = [];
  readonly bands: Band[] = [];

  #dash: readonly number[] = [];
  #path: { x: number; y: number }[][] = [];

  save(): void {
    // 状態の保存は数えない。
  }

  restore(): void {
    // 同上。
  }

  clearRect(): void {
    // 消した跡は数えない。
  }

  fillRect(x: number, y: number, width: number, height: number): void {
    this.bands.push({ x, y, width, height, fillStyle: this.fillStyle });
  }

  beginPath(): void {
    this.#path = [];
  }

  moveTo(x: number, y: number): void {
    this.#path.push([{ x, y }]);
  }

  lineTo(x: number, y: number): void {
    this.#path.at(-1)?.push({ x, y });
  }

  stroke(): void {
    for (const subpath of this.#path) {
      for (let i = 1; i < subpath.length; i += 1) {
        const from = subpath[i - 1];
        const to = subpath[i];
        if (from === undefined || to === undefined) continue;
        this.segments.push({
          x1: from.x,
          y1: from.y,
          x2: to.x,
          y2: to.y,
          strokeStyle: this.strokeStyle,
          lineWidth: this.lineWidth,
          dash: this.#dash,
        });
      }
    }
  }

  setLineDash(segments: number[]): void {
    this.#dash = [...segments];
  }

  fillText(text: string, x: number, y: number, maxWidth?: number): void {
    this.labels.push({ text, x, y, align: this.textAlign, maxWidth });
  }
}

const theme: SceneTheme = {
  background: '#ffffff',
  axis: '#cccccc',
  grid: '#e4e4e4',
  gridFaint: '#f0f0f0',
  label: '#666666',
  lane: '#f4f4f4',
};

/** route.json と同じ並び（軸位置の順。`hiddenInEditor` は既に落ちている）。 */
const stops: readonly SceneStop[] = [
  { stopId: '1_0', stopName: '豊中学舎', axisPosition: 0, gridStyle: 'bold', isDepot: false },
  { stopId: '2_0', stopName: '箕面学舎', axisPosition: 20, gridStyle: 'bold', isDepot: false },
  {
    stopId: '3_0',
    stopName: 'コンベンションセンター前',
    axisPosition: 33,
    gridStyle: 'normal',
    isDepot: false,
  },
  {
    stopId: '5_0',
    stopName: '人間科学部前',
    axisPosition: 37,
    gridStyle: 'normal',
    isDepot: false,
  },
  { stopId: '4_0', stopName: '工学部前', axisPosition: 40, gridStyle: 'bold', isDepot: false },
  { stopId: '9_0', stopName: '千里営業所', axisPosition: 52, gridStyle: 'dashed', isDepot: true },
];

const scene: DiagramScene = {
  stops,
  trips: [],
  selectedTripIds: new Set(),
  colorMode: 'pattern',
  tripNumbers: new Map(),
  theme,
};

/** 既定の表示設定（7:00 から、1 分 3px、軸 1 単位 6px）。 */
const viewport: Viewport = viewportOf(
  { pxPerMinute: 3, pxPerAxisUnit: 6, scrollTime: fromHM(7, 0), scrollAxis: 0 },
  1000,
  420,
);

function draw(overrides: Partial<Viewport> = {}, sceneOverride: DiagramScene = scene): Recorder {
  const ctx = new Recorder();
  drawGrid(ctx, sceneOverride, { ...viewport, ...overrides });
  return ctx;
}

const isVertical = (segment: Segment): boolean => segment.x1 === segment.x2;
const isHorizontal = (segment: Segment): boolean => segment.y1 === segment.y2;

/** 罫線は画素の中心へ半分ずらして置かれる（太さ 1 のとき）。 */
const crispX = (time: Seconds, view: Viewport = viewport): number =>
  Math.round(timeToX(time, view)) + 0.5;

describe('時刻線の粗さ（仕様書 §6.2.3）', () => {
  const kindsAt = (pxPerMinute: number): ReadonlySet<string> =>
    new Set(timeLines({ ...viewport, pxPerMinute }).map((line) => line.kind));

  it('**1 分あたり 0.5px 未満では 60 分線だけ**', () => {
    expect(kindsAt(0.4)).toEqual(new Set(['hour']));
  });

  it('0.5px から 30 分線が出る（**下限を含む**）', () => {
    expect(kindsAt(0.5)).toEqual(new Set(['hour', 'half']));
    expect(kindsAt(1.9)).toEqual(new Set(['hour', 'half']));
  });

  it('2px から 10 分線が出る', () => {
    expect(kindsAt(2)).toEqual(new Set(['hour', 'half', 'ten']));
    // 既定の拡大率（3px/分）はここに入る。
    expect(kindsAt(3)).toEqual(new Set(['hour', 'half', 'ten']));
  });

  it('6px から 5 分線が出る', () => {
    expect(kindsAt(6)).toEqual(new Set(['hour', 'half', 'ten', 'five']));
  });

  it('**1 分線は無い**（最小粒度は 5 分。§6.2.2）', () => {
    for (const line of timeLines({ ...viewport, pxPerMinute: 60 })) {
      expect(line.time % 300).toBe(0);
    }
  });

  it('一番粗い区分を採る（8:00 は 60 分線であって 5 分線ではない）', () => {
    const at = (time: Seconds): string | undefined =>
      timeLines({ ...viewport, pxPerMinute: 6 }).find((line) => line.time === time)?.kind;

    expect(at(fromHM(8, 0))).toBe('hour');
    expect(at(fromHM(8, 30))).toBe('half');
    expect(at(fromHM(8, 10))).toBe('ten');
    expect(at(fromHM(8, 5))).toBe('five');
  });
});

describe('表示範囲（7:00〜22:00。仕様書 §6.2.1）', () => {
  it('**7:00 より前に線を引かない**', () => {
    // 6:00 を左端にしても、最初の線は 7:00 である。
    const lines = timeLines({ ...viewport, startTime: fromHM(6, 0) });
    expect(lines[0]?.time).toBe(fromHM(7, 0));
  });

  it('**22:00 より後に線を引かない**', () => {
    // 21:00 から 1 分 3px なら右端は 25:56。22:00 で止まること。
    const lines = timeLines({ ...viewport, startTime: fromHM(21, 0) });
    expect(lines.at(-1)?.time).toBe(fromHM(22, 0));
  });

  it('視野の右端より先は描かない（カリング）', () => {
    // 右端は 7:00 + (1000 − 144) ÷ 3 分。
    const end = xToTime(viewport.width, viewport);
    for (const line of timeLines(viewport)) {
      expect(line.time).toBeLessThanOrEqual(end);
    }
  });

  it('**表示範囲が視野から外れたら何も描かない**', () => {
    expect(draw({ startTime: fromHM(22, 0) }).segments).toEqual([]);
  });

  it('罫線は表示範囲の右端で途切れる', () => {
    // 20:00 から 1 分 3px なら 22:00 は 144 + 360 = 504px。
    const horizontal = draw({ startTime: fromHM(20, 0) }).segments.filter(isHorizontal);
    for (const segment of horizontal) {
      expect(segment.x2).toBe(504);
    }
  });
});

describe('時刻線', () => {
  it('縦の線が描画領域の上端から下端まで引かれる', () => {
    const vertical = draw().segments.filter(isVertical);
    expect(vertical.length).toBeGreaterThan(0);
    for (const segment of vertical) {
      expect(segment.y1).toBe(viewport.originY);
      expect(segment.y2).toBe(viewport.height);
    }
  });

  it('**引かれた線はすべて 5 分の倍数の位置にある**', () => {
    for (const segment of draw({ pxPerMinute: 6 }).segments.filter(isVertical)) {
      const minutes = Math.round(xToTime(segment.x1, { ...viewport, pxPerMinute: 6 }) / 60);
      expect(minutes % 5).toBe(0);
    }
  });

  it('60 分線が一番濃く、5 分線が一番淡い', () => {
    const vertical = draw({ pxPerMinute: 6 }).segments.filter(isVertical);
    const colorAt = (time: Seconds): string | undefined =>
      vertical.find((segment) => segment.x1 === crispX(time, { ...viewport, pxPerMinute: 6 }))
        ?.strokeStyle;

    expect(colorAt(fromHM(8, 0))).toBe(theme.axis);
    expect(colorAt(fromHM(8, 30))).toBe(theme.grid);
    expect(colorAt(fromHM(8, 5))).toBe(theme.gridFaint);
  });

  it('10 分線は点線で描く（§6.2.2）', () => {
    const vertical = draw().segments.filter(isVertical);
    const ten = vertical.find((segment) => segment.x1 === crispX(fromHM(8, 10)));

    expect(ten?.dash).toEqual([1, 3]);
  });
});

describe('停留所線', () => {
  it('見えている停留所の数だけ横の線が引かれる', () => {
    const horizontal = draw().segments.filter(isHorizontal);
    // 停留所 6 本 + 営業所レーンの境界線 1 本。
    expect(horizontal).toHaveLength(7);
  });

  it('軸位置の示す高さに引かれる', () => {
    const horizontal = draw().segments.filter(isHorizontal);
    // 豊中学舎（0）は太線のため画素の境目に置く。工学部前（40）も同じ。
    expect(horizontal.map((segment) => segment.y1)).toContain(axisToY(0, viewport));
    expect(horizontal.map((segment) => segment.y1)).toContain(axisToY(40, viewport));
  });

  it('`gridStyle` が太さと線種を決める', () => {
    const horizontal = draw().segments.filter(isHorizontal);
    const at = (axisPosition: number): Segment | undefined =>
      horizontal.find(
        (segment) =>
          Math.abs(segment.y1 - axisToY(axisPosition, viewport)) <= 0.5 && segment.lineWidth > 0,
      );

    // bold: 太い実線 / normal: 細い実線 / dashed: 破線。
    expect(at(0)?.lineWidth).toBe(2);
    expect(at(0)?.dash).toEqual([]);
    expect(at(33)?.lineWidth).toBe(1);
    expect(at(33)?.dash).toEqual([]);
    expect(at(52)?.dash).toEqual([4, 4]);
  });

  it('**描画領域の外に出た停留所線は描かない**（カリング）', () => {
    // 軸 1 単位 20px なら千里営業所（52）は y = 1064。高さ 420 に入らない。
    const horizontal = draw({ pxPerAxisUnit: 20 }).segments.filter(isHorizontal);
    for (const segment of horizontal) {
      expect(segment.y1).toBeLessThanOrEqual(viewport.height);
    }
  });
});

describe('千里営業所の専用レーン（仕様書 §6.2.1）', () => {
  it('**縦軸の外側に地色の帯を敷く**', () => {
    const [band] = draw().bands;

    // 工学部前（40）と千里営業所（52）の中間 46 → y = 24 + 276。
    expect(band?.y).toBe(axisToY(46, viewport));
    expect(band?.height).toBe(viewport.height - axisToY(46, viewport));
    expect(band?.fillStyle).toBe(theme.lane);
  });

  it('境界線が帯の上端に引かれる', () => {
    const boundary = draw()
      .segments.filter(isHorizontal)
      .find((segment) => Math.abs(segment.y1 - axisToY(46, viewport)) <= 0.5);

    expect(boundary?.strokeStyle).toBe(theme.axis);
  });

  it('**営業所が縦軸の上にあれば帯は上に付く**（上端でも下端でもよい）', () => {
    const above: DiagramScene = {
      ...scene,
      stops: [{ ...stops[5]!, axisPosition: -10 }, ...stops.slice(0, 5)],
    };
    const lane = depotLane(above, viewport);

    // 豊中学舎（0）と営業所（−10）の中間 −5。上端（originY）から境界まで。
    expect(lane?.top).toBe(viewport.originY);
    expect(lane?.bottom).toBe(axisToY(-5, viewport));
  });

  it('営業所が無ければレーンは無い', () => {
    const withoutDepot: DiagramScene = { ...scene, stops: stops.slice(0, 5) };
    expect(depotLane(withoutDepot, viewport)).toBeNull();
  });

  it('営業停留所が無ければレーンは無い（隔てるものが決まらない）', () => {
    const onlyDepot: DiagramScene = { ...scene, stops: [stops[5]!] };
    expect(depotLane(onlyDepot, viewport)).toBeNull();
  });

  it('帯が描画領域から外れたら塗らない', () => {
    expect(draw({ pxPerAxisUnit: 20 }).bands).toEqual([]);
  });
});

describe('時刻目盛', () => {
  it('既定の拡大率では 1 時間ごとに出す', () => {
    const texts = draw().labels.map((label) => label.text);

    expect(texts).toContain('7:00');
    expect(texts).toContain('8:00');
    expect(texts).toContain('11:00');
  });

  it('**線の右側に置く**（左端の目盛が停留所名の欄にはみ出さない）', () => {
    const first = draw().labels.find((label) => label.text === '7:00');

    expect(first?.align).toBe('left');
    expect(first?.x).toBeGreaterThanOrEqual(viewport.originX);
  });

  it('刻みは拡大率で決まる', () => {
    expect(timeLabelStepMinutes(3)).toBe(60);
    // 1 時間が 30px では「22:00」が入らない。2 時間ごとにする。
    expect(timeLabelStepMinutes(0.5)).toBe(120);
    expect(timeLabelStepMinutes(0.2)).toBe(360);
  });

  it('**縮めても数字が重ならない**（線は残して数字だけ間引く）', () => {
    for (const pxPerMinute of [0.5, 0.3, 0.2]) {
      const labels = draw({ pxPerMinute }).labels.filter((label) => label.text.includes(':'));
      const xs = labels.map((label) => label.x).sort((a, b) => a - b);

      for (let i = 1; i < xs.length; i += 1) {
        expect(xs[i]! - xs[i - 1]!).toBeGreaterThanOrEqual(MIN_TIME_LABEL_GAP);
      }
      // 線そのものは残っている。
      expect(draw({ pxPerMinute }).segments.filter(isVertical).length).toBeGreaterThan(xs.length);
    }
  });

  it('目盛は横軸ラベルの帯に収める', () => {
    for (const label of draw().labels.filter((item) => item.text.includes(':'))) {
      expect(label.y).toBeLessThan(viewport.originY);
    }
  });
});

describe('停留所名', () => {
  it('縦軸の左に右揃えで置く', () => {
    const labels = draw().labels.filter((label) => !label.text.includes(':'));

    expect(labels.map((label) => label.text)).toEqual(stops.map((stop) => stop.stopName));
    for (const label of labels) {
      expect(label.align).toBe('right');
      expect(label.x).toBeLessThan(viewport.originX);
    }
  });

  it('**欄の幅を超えない**（`maxWidth` で押し込む）', () => {
    const label = draw().labels.find((item) => item.text === 'コンベンションセンター前');

    expect(label?.maxWidth).toBeLessThanOrEqual(viewport.originX);
  });

  it('**縮めたときは近すぎる名前を落とす**（重ねない）', () => {
    const labels = draw({ pxPerAxisUnit: 2 }).labels.filter((label) => !label.text.includes(':'));
    const ys = labels.map((label) => label.y);

    // 人間科学部前（37）はコンベンションセンター前（33）に近すぎる。
    expect(labels.map((label) => label.text)).not.toContain('人間科学部前');
    for (let i = 1; i < ys.length; i += 1) {
      expect(ys[i]! - ys[i - 1]!).toBeGreaterThanOrEqual(MIN_STOP_LABEL_GAP);
    }
  });

  it('線は残る（拡大すれば名前が戻る）', () => {
    const horizontal = draw({ pxPerAxisUnit: 2 }).segments.filter(isHorizontal);
    expect(horizontal.length).toBeGreaterThan(
      draw({ pxPerAxisUnit: 2 }).labels.filter((label) => !label.text.includes(':')).length,
    );
  });
});

describe('書き出し（v2）の前提', () => {
  it('**別の大きさ・別の時間範囲でも同じ関数で描ける**', () => {
    const exportViewport: Viewport = {
      ...viewport,
      startTime: fromHM(7, 0),
      pxPerMinute: 8,
      width: 7500,
      height: 1600,
    };
    const ctx = new Recorder();
    drawGrid(ctx, scene, exportViewport);

    // 7:00〜22:00 の全体が入る幅。5 分線まで出て、最後の目盛は 22:00。
    const texts = ctx.labels.map((label) => label.text);
    expect(texts).toContain(formatTime(fromHM(22, 0)));
    expect(ctx.segments.filter(isVertical)).toHaveLength(15 * 12 + 1);
  });
});
