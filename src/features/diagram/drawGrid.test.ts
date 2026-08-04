/**
 * 格子の検証（T-25、仕様書 §6.2.1〜§6.2.3）。
 *
 * T-24 と同じく、**canvas を一切使わない。** 引かれた線と置かれた文字を覚えるだけの
 * `ctx` を渡し、「どの位置に、どの太さで、何本引かれたか」を見る。実物の canvas が
 * 要らないことが、表示範囲を `viewport` 以外から取っていない証拠である。
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadNetworkDef } from '@/domain/network';
import { formatTime, fromHM, type Seconds } from '@/domain/time';
import {
  LABEL_PADDING,
  MIN_STOP_LABEL_GAP,
  MIN_TIME_LABEL_GAP,
  STOP_LABEL_FONT,
  drawGrid,
  timeLabelStepMinutes,
  timeLines,
} from './drawGrid';
import { Recorder, isHorizontal, isVertical, type RecordedSegment } from './recorder.test-utils';
import type { DiagramScene, SceneStop, SceneTheme } from './scene';
import { AXIS_LABEL_WIDTH, axisToY, timeToX, viewportOf, xToTime, type Viewport } from './viewport';

const theme: SceneTheme = {
  background: '#ffffff',
  axis: '#cccccc',
  grid: '#e4e4e4',
  gridFaint: '#f0f0f0',
  label: '#666666',
};

/** route.json と同じ並び（軸位置の順。`hiddenInEditor` は既に落ちている）。 */
const stops: readonly SceneStop[] = [
  { stopId: '1_0', shortName: '豊中', axisPosition: 0, gridStyle: 'bold' },
  { stopId: '2_0', shortName: '箕面', axisPosition: 20, gridStyle: 'bold' },
  // コンベ前と人科前は**同じ軸位置**にある（#117）。どちらも工学部前から 5 分。
  { stopId: '3_0', shortName: 'コンベ前', axisPosition: 35, gridStyle: 'normal' },
  { stopId: '5_0', shortName: '人科前', axisPosition: 35, gridStyle: 'normal' },
  { stopId: '4_0', shortName: '工学部', axisPosition: 40, gridStyle: 'bold' },
];

const scene: DiagramScene = {
  stops,
  trips: [],
  blockLinks: [],
  selectedTripIds: new Set(),
  selectionRect: null,
  tripShift: null,
  theme,
};

/**
 * 破線の停留所線を持つ場面。
 *
 * route.json で `dashed` なのは微研（`hiddenInEditor`）と営業所（#118 で縦軸から
 * 外れた）だけであり、どちらも縦軸には並ばない。**線種の決まりはデータに残る**
 * ため、それが効くことはここで確かめる。
 */
const dashedScene: DiagramScene = {
  ...scene,
  stops: [...stops, { stopId: 'x_0', shortName: '仮', axisPosition: 45, gridStyle: 'dashed' }],
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
    // 20:00 から 1 分 3px なら 22:00 は 56 + 360 = 416px。
    const horizontal = draw({ startTime: fromHM(20, 0) }).segments.filter(isHorizontal);
    for (const segment of horizontal) {
      expect(segment.x2).toBe(416);
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
    // 停留所 5 本。営業所レーンの境界線は無くなった（#118）。
    expect(horizontal).toHaveLength(5);
  });

  it('軸位置の示す高さに引かれる', () => {
    const horizontal = draw().segments.filter(isHorizontal);
    // 豊中学舎（0）は太線のため画素の境目に置く。工学部前（40）も同じ。
    expect(horizontal.map((segment) => segment.y1)).toContain(axisToY(0, viewport));
    expect(horizontal.map((segment) => segment.y1)).toContain(axisToY(40, viewport));
  });

  it('`gridStyle` が太さと線種を決める', () => {
    const horizontal = draw().segments.filter(isHorizontal);
    const at = (axisPosition: number): RecordedSegment | undefined =>
      horizontal.find(
        (segment) =>
          Math.abs(segment.y1 - axisToY(axisPosition, viewport)) <= 0.5 && segment.lineWidth > 0,
      );

    // bold: 太い実線 / normal: 細い実線 / dashed: 破線。
    expect(at(0)?.lineWidth).toBe(2);
    expect(at(0)?.dash).toEqual([]);
    expect(at(35)?.lineWidth).toBe(1);
    expect(at(35)?.dash).toEqual([]);

    const dashed = draw({}, dashedScene)
      .segments.filter(isHorizontal)
      .find((segment) => Math.abs(segment.y1 - axisToY(45, viewport)) <= 0.5);
    expect(dashed?.dash).toEqual([4, 4]);
  });

  it('**描画領域の外に出た停留所線は描かない**（カリング）', () => {
    // 軸 1 単位 20px なら工学部前（40）は y = 824。高さ 420 に入らない。
    const horizontal = draw({ pxPerAxisUnit: 20 }).segments.filter(isHorizontal);
    for (const segment of horizontal) {
      expect(segment.y1).toBeLessThanOrEqual(viewport.height);
    }
  });
});

describe('千里営業所（#118、仕様書 §6.2.1）', () => {
  it('**帯も境界線も引かない**（営業所レーンを廃した）', () => {
    // 営業所は縦軸に並ばず、回送は営業便の端から伸びるヒゲになった。隔てるものが
    // 無くなったため、地色の帯も境界線も要らない。
    expect(draw().rects).toEqual([]);
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
  it('**route.json の一番長い略称が縦軸の欄に入る**（#116、仕様書 §6.2.2）', () => {
    // 幅は名前から決める（T-25）。逆にすると、収まらない名前が `maxWidth` で
    // 押し潰され、どの線がどの停留所かを読めなくする。
    const routeJsonPath = fileURLToPath(new URL('../../../data/route.json', import.meta.url));
    const loaded = loadNetworkDef(readFileSync(routeJsonPath, 'utf8'));
    if (!loaded.ok) throw new Error('route.json を読み込めません');

    const longest = Math.max(...loaded.network.def.stops.map((stop) => stop.shortName.length));
    const fontSize = Number.parseInt(STOP_LABEL_FONT, 10);

    expect(AXIS_LABEL_WIDTH).toBeGreaterThanOrEqual(longest * fontSize + LABEL_PADDING);
  });

  it('縦軸の左に右揃えで置く', () => {
    const labels = draw().labels.filter((label) => !label.text.includes(':'));

    expect(labels.map((label) => label.text)).toEqual(stops.map((stop) => stop.shortName));
    for (const label of labels) {
      expect(label.align).toBe('right');
      expect(label.x).toBeLessThan(viewport.originX);
    }
  });

  it('**欄の幅を超えない**（`maxWidth` で押し込む）', () => {
    const label = draw().labels.find((item) => item.text === 'コンベ前');

    expect(label?.maxWidth).toBeLessThanOrEqual(viewport.originX);
  });

  it('**同じ高さの停留所は名前を上下に振り分ける**（#117）', () => {
    const labels = draw().labels.filter((label) => !label.text.includes(':'));
    const yOf = (text: string): number =>
      labels.find((label) => label.text === text)?.y ?? Number.NaN;

    // コンベ前と人科前は同じ線の上にある。**どちらも出す**——重ならない置き方が
    // あるのに片方を落とすと、その停留所はどの拡大率でも読めないままになる。
    const line = axisToY(35, viewport);
    expect(yOf('コンベ前')).toBe(line - MIN_STOP_LABEL_GAP / 2);
    expect(yOf('人科前')).toBe(line + MIN_STOP_LABEL_GAP / 2);
    expect(yOf('人科前') - yOf('コンベ前')).toBe(MIN_STOP_LABEL_GAP);
  });

  it('**縮めたときは近すぎる名前を落とす**（重ねない）', () => {
    const labels = draw({ pxPerAxisUnit: 2 }).labels.filter((label) => !label.text.includes(':'));
    const ys = labels.map((label) => label.y);

    // 工学部（40）はコンベ前・人科前（35）の名前に近すぎる。
    expect(labels.map((label) => label.text)).not.toContain('工学部');
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
