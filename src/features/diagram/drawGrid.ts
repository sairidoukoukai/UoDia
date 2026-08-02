/**
 * ダイヤグラムの罫線と目盛を描く（仕様書 §6.2.1〜§6.2.3、T-25）。
 *
 * 引数は {@link drawDiagram} と同じ 3 つである。ストアも DOM も見ない。
 *
 * ## 何を描くと何が読めるようになるのか
 *
 * ダイヤの読み方は「線の傾きを目で追う」ことに尽きる。傾きを読むには**基準の
 * 格子**が要る。停留所線は「どこ」を、時刻線は「いつ」を与える。格子が無い絵は、
 * スジが引かれていても読めない。
 *
 * ## 間引きは飾りではない
 *
 * 縮めた画面に 5 分線を全部描くと、線が潰れて灰色の帯になる。**格子が読めなく
 * なった時点で、格子は情報ではなく汚れである。** 拡大率に応じて粗くするのは、
 * どの拡大率でも「数えられる格子」を保つための決まりである（仕様書 §6.2.3）。
 */

import type { GridStyle } from '@/domain/model';
import {
  formatTime,
  GRAIN_SECONDS,
  SECONDS_PER_MINUTE,
  seconds,
  type Seconds,
} from '@/domain/time';
import type { DiagramScene, SceneTheme } from './scene';
import {
  axisToY,
  DIAGRAM_END_TIME,
  DIAGRAM_START_TIME,
  plotXRange,
  timeToX,
  viewportEndTime,
  type Viewport,
} from './viewport';
import type { DrawContext } from './drawContext';

/** 時刻線の粗さ。仕様書 §6.2.2 の 60 / 30 / 10 / 5 分に対応する。 */
export type TimeLineKind = 'hour' | 'half' | 'ten' | 'five';

/** 時刻線 1 本。 */
export interface TimeLine {
  readonly time: Seconds;
  readonly kind: TimeLineKind;
}

/**
 * その粗さの線を描き始める拡大率（1 分あたり px。仕様書 §6.2.3）。
 *
 * **下限は含む。** 表の「0.5 〜 2」は 0.5 を含む側に寄せる。境目でどちらとも
 * 取れる書き方をすると、実装ごとに違う絵が出る。
 */
const MIN_PX_PER_MINUTE: Record<TimeLineKind, number> = {
  hour: 0,
  half: 0.5,
  ten: 2,
  five: 6,
};

/** 淡い線から順に描く。濃い線が後から上に乗る。 */
const DRAW_ORDER: readonly TimeLineKind[] = ['five', 'ten', 'half', 'hour'];

const SOLID: readonly number[] = [];
const DOTTED: readonly number[] = [1, 3];
const DASHED: readonly number[] = [4, 4];

interface LineStyle {
  /** {@link SceneTheme} のどの濃さを使うか。 */
  readonly color: 'axis' | 'grid' | 'gridFaint';
  readonly width: number;
  readonly dash: readonly number[];
}

const TIME_LINE_STYLE: Record<TimeLineKind, LineStyle> = {
  hour: { color: 'axis', width: 1, dash: SOLID },
  half: { color: 'grid', width: 1, dash: SOLID },
  ten: { color: 'grid', width: 1, dash: DOTTED },
  five: { color: 'gridFaint', width: 1, dash: SOLID },
};

const STOP_LINE_STYLE: Record<GridStyle, LineStyle> = {
  bold: { color: 'axis', width: 2, dash: SOLID },
  normal: { color: 'axis', width: 1, dash: SOLID },
  dashed: { color: 'grid', width: 1, dash: DASHED },
};

/** ラベルと罫線のあいだの余白。 */
export const LABEL_PADDING = 8;

/** 文字の大きさ。テーマに追随させるのは T-39 の仕事である。 */
export const STOP_LABEL_FONT = '12px system-ui, sans-serif';
const TIME_LABEL_FONT = '11px system-ui, sans-serif';

/**
 * 時刻目盛を並べる最小の間隔（px）。
 *
 * 「22:00」が 11px の字で約 30px になる。**隣と触れない**ようにするため、それに
 * 余白を足した値を下限とする。
 */
export const MIN_TIME_LABEL_GAP = 44;

/** 停留所名を並べる最小の間隔（px）。文字の高さより狭くしない。 */
export const MIN_STOP_LABEL_GAP = 14;

/**
 * 時刻目盛の刻み（分）。狭くて入らないときは倍にしていく。
 *
 * 60 分ごとに出せないほど縮めた画面では、1 時間ごとの目盛は読めない。**線は
 * 残して数字だけ間引く。**
 */
const TIME_LABEL_STEPS: readonly number[] = [60, 120, 180, 360];

/** これより縮めたときは重なりを許す。拡大率の下限は T-27 が定める。 */
const WIDEST_TIME_LABEL_STEP = 720;

export function drawGrid(ctx: DrawContext, scene: DiagramScene, viewport: Viewport): void {
  const range = plotXRange(viewport);
  // 表示範囲（7:00〜22:00）が視野から外れている。描く格子が無い。
  if (range === null) return;

  drawTimeLines(ctx, scene.theme, viewport);
  drawStopLines(ctx, scene, viewport, range);
  drawTimeLabels(ctx, scene.theme, viewport);
  drawStopLabels(ctx, scene, viewport);
}

/**
 * 描く時刻線。視野と表示範囲の重なりに限る（カリング）。
 *
 * **1 分線は作らない。** 全時刻が 5 分刻みである以上（仕様書 §2.1）、1 分の位置に
 * 線を引いても指せるものが無い。
 */
export function timeLines(viewport: Viewport): readonly TimeLine[] {
  const from = Math.max(DIAGRAM_START_TIME, viewport.startTime);
  const to = Math.min(DIAGRAM_END_TIME, viewportEndTime(viewport));
  const first = Math.ceil(from / GRAIN_SECONDS) * GRAIN_SECONDS;

  const lines: TimeLine[] = [];
  for (let time = first; time <= to; time += GRAIN_SECONDS) {
    const kind = kindOf(time);
    if (viewport.pxPerMinute >= MIN_PX_PER_MINUTE[kind]) {
      lines.push({ time: seconds(time), kind });
    }
  }
  return lines;
}

/** その時刻がどの粗さの線になるか。**一番粗い区分を採る。** */
function kindOf(time: number): TimeLineKind {
  const minutes = time / SECONDS_PER_MINUTE;
  if (minutes % 60 === 0) return 'hour';
  if (minutes % 30 === 0) return 'half';
  if (minutes % 10 === 0) return 'ten';
  return 'five';
}

/** 時刻目盛を出す間隔（分）。 */
export function timeLabelStepMinutes(pxPerMinute: number): number {
  for (const step of TIME_LABEL_STEPS) {
    if (step * pxPerMinute >= MIN_TIME_LABEL_GAP) return step;
  }
  return WIDEST_TIME_LABEL_STEP;
}

function drawTimeLines(ctx: DrawContext, theme: SceneTheme, viewport: Viewport): void {
  const lines = timeLines(viewport);

  for (const kind of DRAW_ORDER) {
    const style = TIME_LINE_STYLE[kind];
    const drawn = lines.filter((line) => line.kind === kind);
    if (drawn.length === 0) continue;

    applyStyle(ctx, theme, style);
    ctx.beginPath();
    for (const line of drawn) {
      const x = crisp(timeToX(line.time, viewport), style.width);
      ctx.moveTo(x, viewport.originY);
      ctx.lineTo(x, viewport.height);
    }
    ctx.stroke();
  }
}

function drawStopLines(
  ctx: DrawContext,
  scene: DiagramScene,
  viewport: Viewport,
  range: { readonly left: number; readonly right: number },
): void {
  // 線種ごとに 1 本の道にまとめる。線の色と太さは道ごとにしか変えられない。
  const byStyle = new Map<GridStyle, number[]>();

  for (const stop of scene.stops) {
    const y = axisToY(stop.axisPosition, viewport);
    if (y < viewport.originY || y > viewport.height) continue;

    const ys = byStyle.get(stop.gridStyle);
    if (ys === undefined) byStyle.set(stop.gridStyle, [y]);
    else ys.push(y);
  }

  for (const [gridStyle, ys] of byStyle) {
    const style = STOP_LINE_STYLE[gridStyle];
    applyStyle(ctx, scene.theme, style);
    ctx.beginPath();
    for (const y of ys) {
      const aligned = crisp(y, style.width);
      ctx.moveTo(range.left, aligned);
      ctx.lineTo(range.right, aligned);
    }
    ctx.stroke();
  }
}

function drawTimeLabels(ctx: DrawContext, theme: SceneTheme, viewport: Viewport): void {
  const step = timeLabelStepMinutes(viewport.pxPerMinute);

  ctx.fillStyle = theme.label;
  ctx.font = TIME_LABEL_FONT;
  // **線の右側に置く。** 中央に揃えると、左端の目盛が停留所名の欄にはみ出す。
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';

  for (const line of timeLines(viewport)) {
    if (line.kind !== 'hour') continue;
    if ((line.time / SECONDS_PER_MINUTE) % step !== 0) continue;

    ctx.fillText(
      formatTime(line.time),
      timeToX(line.time, viewport) + 3,
      viewport.originY / 2,
      MIN_TIME_LABEL_GAP,
    );
  }
}

/**
 * 停留所の略称を縦軸の左に置く。
 *
 * 縮めた画面では**近すぎる名前を落とす**。重ねて出すと、両方とも読めなくなる。
 * 線は残るため、拡大すれば名前が戻る。
 */
function drawStopLabels(ctx: DrawContext, scene: DiagramScene, viewport: Viewport): void {
  ctx.fillStyle = scene.theme.label;
  ctx.font = STOP_LABEL_FONT;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';

  let lastY = Number.NEGATIVE_INFINITY;
  for (const stop of scene.stops) {
    const y = axisToY(stop.axisPosition, viewport);
    if (y < viewport.originY || y > viewport.height) continue;
    if (y - lastY < MIN_STOP_LABEL_GAP) continue;

    ctx.fillText(
      stop.shortName,
      viewport.originX - LABEL_PADDING,
      y,
      viewport.originX - LABEL_PADDING,
    );
    lastY = y;
  }
}

function applyStyle(ctx: DrawContext, theme: SceneTheme, style: LineStyle): void {
  ctx.strokeStyle = theme[style.color];
  ctx.lineWidth = style.width;
  ctx.setLineDash([...style.dash]);
}

/**
 * 1px の線をぼやけさせない。
 *
 * canvas の座標は画素の**境目**を指す。境目に太さ 1 の線を引くと、左右の画素に
 * 半分ずつ乗って 2 列の薄い線になる。半画素ずらして画素の中心に置く。
 */
function crisp(value: number, lineWidth: number): number {
  return lineWidth % 2 === 0 ? Math.round(value) : Math.round(value) + 0.5;
}
