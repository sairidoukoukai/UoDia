/**
 * ダイヤグラムの送りと拡げ（仕様書 §6.2.3、T-27）。
 *
 * ## 計算は純関数、器は薄く
 *
 * 「どの視野からどの視野へ移るか」は入力装置の話ではない。ホイールの回転量と
 * カーソルの位置が決まれば、次の視野は一意に決まる。**その計算をここに純関数
 * として置き、DOM の出来事は薄い層で受ける。** 拡大の中心がずれるといった
 * 不具合は、いつも計算の側にあり、イベントの側には無い。
 *
 * ## 視野は履歴に載らない
 *
 * 画面を送ることは編集ではない（`store.ts` の `setDiagramView`）。undo が
 * 「さっき縮めたぶん」を戻し始めたら、便を直した記憶にたどり着けない。
 */

import { clampDiagramView, diagramViewSchema, type DiagramView } from '@/domain/model';
import { SECONDS_PER_MINUTE } from '@/domain/time';
import type { DiagramScene } from './scene';
import {
  AXIS_EDGE_MARGIN,
  DIAGRAM_END_TIME,
  DIAGRAM_START_TIME,
  viewportOf,
  xToTime,
  yToAxis,
  type Viewport,
} from './viewport';

/**
 * 既定の視野（<kbd>Ctrl</kbd>+<kbd>0</kbd> で戻る先）。
 *
 * **スキーマの既定値をそのまま使う。** ここに数を書き写すと、既定を変えた日に
 * 「新規作成した直後」と「戻したあと」が違う画面になる。
 */
export const DEFAULT_DIAGRAM_VIEW: DiagramView = diagramViewSchema.parse({});

/**
 * ホイールの回転量 1 に対する拡大率の変化。
 *
 * 指数で効かせる。**倍率は掛け算で積み上がる**ため、同じ回転量なら、拡大でも
 * 縮小でも、いま何倍であっても、同じ「手応え」になる。加算にすると、縮んで
 * いるときほど大きく動く。
 */
const ZOOM_SENSITIVITY = 0.002;

/** 縦軸の送りの範囲。 */
export interface AxisBounds {
  readonly min: number;
  readonly max: number;
}

const NO_AXIS: AxisBounds = { min: 0, max: 0 };

/** 場面から縦軸の端を求める。停留所が無ければ動かせる範囲も無い。 */
export function axisBoundsOf(scene: DiagramScene): AxisBounds {
  return axisBoundsOfStops(scene.stops);
}

/**
 * 停留所の並びから縦軸の端を求める。
 *
 * 場面を組まずに済む道を開けておく。送りのつまみ（`DiagramScrollbars`）は
 * **色を知らない**ため、場面（`selectDiagramScene`）を通したくない。
 */
export function axisBoundsOfStops(stops: readonly { readonly axisPosition: number }[]): AxisBounds {
  if (stops.length === 0) return NO_AXIS;

  const positions = stops.map((stop) => stop.axisPosition);
  return { min: Math.min(...positions), max: Math.max(...positions) };
}

/** 送りの動かせる範囲。 */
export interface ScrollRanges {
  /** 時間（秒）。 */
  readonly time: AxisBounds;
  /** 縦軸（軸の単位）。 */
  readonly axis: AxisBounds;
}

/**
 * 送りの動かせる範囲（仕様書 §6.2.3）。
 *
 * **収める先と、つまみの端は同じでなければならない。** 別々に決めると、つまみを
 * 端まで動かしても届かない場所や、届いた先で弾き返される場所ができる。
 * `clampScroll` もこの関数を通る。
 *
 * `max` が `min` と同じなら、その向きには動かせる先が無い（全体が見えている）。
 */
export function scrollRanges(
  view: DiagramView,
  viewport: Viewport,
  bounds: AxisBounds,
): ScrollRanges {
  const visibleSeconds =
    ((viewport.width - viewport.originX) / view.pxPerMinute) * SECONDS_PER_MINUTE;
  /*
   * **上下に余白を残す**（#171）。軸の写像（`axisToY`）が上の余白を空けており、
   * 下も同じだけ残すために 2 つぶん引く。引かないと、一番下まで送ったときに
   * 最後の停留所線が縁に張り付き、停車点の丸が切れる。
   */
  const visibleAxis =
    (viewport.height - viewport.originY - AXIS_EDGE_MARGIN * 2) / view.pxPerAxisUnit;

  return {
    time: {
      min: DIAGRAM_START_TIME,
      max: Math.max(DIAGRAM_START_TIME, DIAGRAM_END_TIME - visibleSeconds),
    },
    axis: { min: bounds.min, max: Math.max(bounds.min, bounds.max - visibleAxis) },
  };
}

/** ホイールの入力。**DOM のイベントそのものは受け取らない。** */
export interface WheelInput {
  readonly deltaX: number;
  readonly deltaY: number;
  /** <kbd>Ctrl</kbd>（macOS では <kbd>Cmd</kbd>）。拡大縮小に切り替える。 */
  readonly zoomKey: boolean;
  readonly shiftKey: boolean;
  /** canvas の左上を原点とするカーソルの位置（CSS px）。 */
  readonly x: number;
  readonly y: number;
}

/**
 * ホイールを回したあとの視野（仕様書 §6.2.3）。
 *
 * | 修飾 | はたらき |
 * | --- | --- |
 * | <kbd>Ctrl</kbd> | 横方向（時間軸）の拡大縮小 |
 * | <kbd>Ctrl</kbd>+<kbd>Shift</kbd> | 縦方向の拡大縮小 |
 * | <kbd>Shift</kbd> | 横スクロール |
 * | なし | 縦スクロール |
 */
export function viewAfterWheel(
  view: DiagramView,
  input: WheelInput,
  viewport: Viewport,
  bounds: AxisBounds,
): DiagramView {
  if (input.zoomKey && input.shiftKey) return zoomAxis(view, input, viewport, bounds);
  if (input.zoomKey) return zoomTime(view, input, viewport, bounds);

  // Shift + ホイールは横送り。横回転を持つ装置ではそちらを優先する。
  const [dx, dy] = input.shiftKey
    ? [input.deltaX !== 0 ? input.deltaX : input.deltaY, 0]
    : [input.deltaX, input.deltaY];

  return panBy(view, dx, dy, viewport, bounds);
}

/**
 * 画面を dx・dy だけ**掴んで動かした**あとの視野。
 *
 * 送りの向きが逆であることに注意する。画面を右へ引きずるのは、**紙を右へ
 * ずらす**ことであり、見ている時刻は前へ戻る。
 */
export function viewAfterDrag(
  view: DiagramView,
  dx: number,
  dy: number,
  viewport: Viewport,
  bounds: AxisBounds,
): DiagramView {
  return panBy(view, -dx, -dy, viewport, bounds);
}

/** 画面の中身を dx・dy px ぶん送った視野。 */
function panBy(
  view: DiagramView,
  dx: number,
  dy: number,
  viewport: Viewport,
  bounds: AxisBounds,
): DiagramView {
  return clampScroll(
    {
      ...view,
      scrollTime: view.scrollTime + (dx / view.pxPerMinute) * SECONDS_PER_MINUTE,
      scrollAxis: view.scrollAxis + dy / view.pxPerAxisUnit,
    },
    viewport,
    bounds,
  );
}

/**
 * 横方向の拡大縮小。**カーソルの下にある時刻を動かさない。**
 *
 * 掴んでいる場所が動くと、拡げるたびに見ていた便を探し直すことになる。
 */
function zoomTime(
  view: DiagramView,
  input: WheelInput,
  viewport: Viewport,
  bounds: AxisBounds,
): DiagramView {
  const anchorTime = xToTime(input.x, viewport);
  const zoomed = clampDiagramView({
    ...view,
    pxPerMinute: view.pxPerMinute * zoomFactor(input.deltaY),
  });

  // 拡大率が上限・下限で止まったなら、送りも動かさない。
  const offsetMinutes = (input.x - viewport.originX) / zoomed.pxPerMinute;

  return clampScroll(
    { ...zoomed, scrollTime: anchorTime - offsetMinutes * SECONDS_PER_MINUTE },
    viewport,
    bounds,
  );
}

/** 縦方向の拡大縮小。カーソルの下にある軸位置を動かさない。 */
function zoomAxis(
  view: DiagramView,
  input: WheelInput,
  viewport: Viewport,
  bounds: AxisBounds,
): DiagramView {
  const anchorAxis = yToAxis(input.y, viewport);
  const zoomed = clampDiagramView({
    ...view,
    pxPerAxisUnit: view.pxPerAxisUnit * zoomFactor(input.deltaY),
  });

  return clampScroll(
    {
      ...zoomed,
      // **`axisToY` の逆を解く。** 軸の写像は原点に余白を挟んでいるため
      // （`AXIS_EDGE_MARGIN`、#171）、ここでも同じだけ引かないとカーソルの
      // 下の停留所がずれる。
      scrollAxis:
        anchorAxis - (input.y - viewport.originY - AXIS_EDGE_MARGIN) / zoomed.pxPerAxisUnit,
    },
    viewport,
    bounds,
  );
}

/** 回転量から倍率へ。上に回す（負の値）と拡がる。 */
function zoomFactor(deltaY: number): number {
  return Math.exp(-deltaY * ZOOM_SENSITIVITY);
}

/**
 * 送りを描くものの範囲に収める。
 *
 * **中身より広く見えているときは端に寄せる。** 全体が入っているのに更に送れると、
 * 何も無い場所へ迷い込み、戻る手立てが分からなくなる。
 */
export function clampScroll(
  view: DiagramView,
  viewport: Viewport,
  bounds: AxisBounds,
): DiagramView {
  const ranges = scrollRanges(view, viewport, bounds);

  return {
    ...view,
    scrollTime: clamp(view.scrollTime, ranges.time.min, ranges.time.max),
    scrollAxis: clamp(view.scrollAxis, ranges.axis.min, ranges.axis.max),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** 視野が変わったか。同じなら状態を書き換えない（描き直しを起こさない）。 */
export function sameView(a: DiagramView, b: DiagramView): boolean {
  return (
    a.pxPerMinute === b.pxPerMinute &&
    a.pxPerAxisUnit === b.pxPerAxisUnit &&
    a.scrollTime === b.scrollTime &&
    a.scrollAxis === b.scrollAxis
  );
}

/** canvas の今の大きさに合わせた視野を作る。 */
export function viewportForCanvas(view: DiagramView, canvas: HTMLCanvasElement): Viewport {
  return viewportOf(view, canvas.clientWidth, canvas.clientHeight);
}
