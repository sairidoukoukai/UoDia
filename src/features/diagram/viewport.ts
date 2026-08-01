/**
 * ダイヤグラムの座標系（仕様書 §6.2.1、実装計画書 §3.5、T-24）。
 *
 * **横軸は時刻、縦軸は停留所の軸位置**である。変換はすべて {@link Viewport} だけに
 * 依存する純関数として書く。ストアも DOM も見ない。
 *
 * ## なぜ引数だけで決まる形にするのか
 *
 * v2 で予定している画像・PDF の書き出しは、「画面用 canvas の代わりに、任意の
 * 解像度・任意の時間範囲のオフスクリーン canvas を渡す」だけで実現できる
 * （実装計画書 §3.5）。描画側が画面の状態を覗く作りにすると、書き出しの日に
 * レンダラを書き直すことになる。
 */

import { fromHM, GRAIN_SECONDS, MAX_SECONDS, SECONDS_PER_MINUTE } from '@/domain/time';

/**
 * 描画の視野。
 *
 * **右端の時刻と下端の軸位置は持たない。** 幅と拡大率から決まる導出値であり、
 * 持つと 2 つの値が食い違う状態を作れてしまう（{@link viewportEndTime}）。
 */
export interface Viewport {
  /**
   * 描画領域の左端が指す時刻（秒）。
   *
   * **`Seconds` ではない。** 5 分の倍数に縛ると、拡大の中心をカーソルに
   * 合わせられない（仕様書 §6.2.3、v4.17）。
   */
  readonly startTime: number;
  /** 描画領域の上端が指す軸位置（`Stop.axisPosition`）。 */
  readonly startAxis: number;
  /** 1 分あたりの px。 */
  readonly pxPerMinute: number;
  /** 軸位置 1 単位あたりの px。 */
  readonly pxPerAxisUnit: number;
  /** 描画領域の左端（縦軸ラベルの幅）。 */
  readonly originX: number;
  /** 描画領域の上端（横軸ラベルの高さ）。 */
  readonly originY: number;
  /** canvas 全体の幅（CSS px）。 */
  readonly width: number;
  /** canvas 全体の高さ（CSS px）。 */
  readonly height: number;
}

/**
 * 縦軸ラベル（停留所名）に割く幅。
 *
 * 一番長い停留所名「コンベンションセンター前」（12 文字）が 12px の字で 144px
 * になる。**幅を名前から決める。** 逆にすると、収まらない名前を縮めて出すことに
 * なり、どの線がどの停留所かを読めなくする（T-25）。
 */
export const AXIS_LABEL_WIDTH = 144;

/** 横軸ラベル（時刻目盛）に割く高さ。 */
export const TIME_LABEL_HEIGHT = 24;

/** ダイヤグラムの表示範囲（仕様書 §6.2.1）。 */
export const DIAGRAM_START_TIME = fromHM(7, 0);
export const DIAGRAM_END_TIME = fromHM(22, 0);

/**
 * 時刻 → x 座標。
 *
 * **`Seconds` に限らない。** 送りの位置や矩形選択の端は 5 分の倍数にならない
 * （T-27、T-28）。ここは掛け算と足し算しかしておらず、5 分の倍数であることを
 * 使ってもいない。
 */
export function timeToX(time: number, viewport: Viewport): number {
  return (
    viewport.originX + ((time - viewport.startTime) / SECONDS_PER_MINUTE) * viewport.pxPerMinute
  );
}

/**
 * x 座標 → 時刻（秒）。
 *
 * **5 分に丸めない。** 丸めるかどうかは使う側が決める（升目への入力は丸めるが、
 * 目盛の位置合わせは丸めてはならない）。`Seconds` を名乗らないのはそのためで
 * ある——この型は 5 分の倍数であることを含む（`domain/time`）。
 */
export function xToTime(x: number, viewport: Viewport): number {
  return viewport.startTime + ((x - viewport.originX) / viewport.pxPerMinute) * SECONDS_PER_MINUTE;
}

/** 軸位置 → y 座標。 */
export function axisToY(axisPosition: number, viewport: Viewport): number {
  return viewport.originY + (axisPosition - viewport.startAxis) * viewport.pxPerAxisUnit;
}

/** y 座標 → 軸位置。 */
export function yToAxis(y: number, viewport: Viewport): number {
  return viewport.startAxis + (y - viewport.originY) / viewport.pxPerAxisUnit;
}

/** 描画領域の右端が指す時刻（秒）。表せる範囲を超えないよう頭を押さえる。 */
export function viewportEndTime(viewport: Viewport): number {
  return Math.min(xToTime(viewport.width, viewport), MAX_SECONDS);
}

/** 描画領域の下端が指す軸位置。 */
export function viewportEndAxis(viewport: Viewport): number {
  return yToAxis(viewport.height, viewport);
}

/**
 * その時刻が描画領域の横幅に入るか（仕様書 §6.2.2 のカリング）。
 *
 * 端でちょうど切れるスジを消さないよう、1 目盛（5 分）ぶんの余裕を持たせる。
 */
export function isTimeVisible(time: number, viewport: Viewport): boolean {
  return (
    time >= viewport.startTime - GRAIN_SECONDS && time <= viewportEndTime(viewport) + GRAIN_SECONDS
  );
}

/**
 * 罫線とスジを描いてよい横方向の範囲（px）。
 *
 * 描画領域のうち、**表示範囲（7:00〜22:00）と重なっている部分**である。時刻線と
 * 停留所線がここで揃って途切れることで、表示範囲が絵として現れる。
 *
 * @returns 表示範囲が視野から外れているときは `null`
 */
export function plotXRange(
  viewport: Viewport,
): { readonly left: number; readonly right: number } | null {
  const left = Math.max(viewport.originX, timeToX(DIAGRAM_START_TIME, viewport));
  const right = Math.min(viewport.width, timeToX(DIAGRAM_END_TIME, viewport));
  return right > left ? { left, right } : null;
}

/** 画面上の矩形（px）。 */
export interface ScreenRect {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/**
 * 描くものの座標で持った矩形を、画面の座標に直す。
 *
 * 矩形選択の枠（T-28）に使う。**引数の型を構造で受ける**ことで、この層が
 * ストアの型（`SelectionRect`）を知らずに済む。
 */
export function screenRect(
  rect: {
    readonly fromTime: number;
    readonly toTime: number;
    readonly fromAxis: number;
    readonly toAxis: number;
  },
  viewport: Viewport,
): ScreenRect {
  const x1 = timeToX(rect.fromTime, viewport);
  const x2 = timeToX(rect.toTime, viewport);
  const y1 = axisToY(rect.fromAxis, viewport);
  const y2 = axisToY(rect.toAxis, viewport);

  return {
    left: Math.min(x1, x2),
    right: Math.max(x1, x2),
    top: Math.min(y1, y2),
    bottom: Math.max(y1, y2),
  };
}

/** プロジェクトに保存された表示設定と canvas の大きさから視野を作る。 */
export function viewportOf(
  view: {
    readonly pxPerMinute: number;
    readonly pxPerAxisUnit: number;
    readonly scrollTime: number;
    readonly scrollAxis: number;
  },
  width: number,
  height: number,
): Viewport {
  return {
    startTime: view.scrollTime,
    startAxis: view.scrollAxis,
    pxPerMinute: view.pxPerMinute,
    pxPerAxisUnit: view.pxPerAxisUnit,
    originX: AXIS_LABEL_WIDTH,
    originY: TIME_LABEL_HEIGHT,
    width,
    height,
  };
}

/**
 * canvas の裏側の解像度を「CSS の大きさ × 画素密度」に合わせる。
 *
 * **これが線と文字のぼやけない理由である。** CSS 上の大きさだけを与えると、
 * 裏側は既定の 300×150 のまま拡大され、輪郭が滲む。
 *
 * 既に合っていれば触らない。`canvas.width` への代入は中身を消すため、毎フレーム
 * 書き込むと描いたものが消える。
 *
 * @returns 大きさを変えたか
 */
export function fitBackingStore(
  canvas: {
    width: number;
    height: number;
    readonly clientWidth: number;
    readonly clientHeight: number;
  },
  pixelRatio: number,
): boolean {
  const width = Math.round(canvas.clientWidth * pixelRatio);
  const height = Math.round(canvas.clientHeight * pixelRatio);
  if (canvas.width === width && canvas.height === height) return false;

  canvas.width = width;
  canvas.height = height;
  return true;
}
