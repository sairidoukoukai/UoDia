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

import { GRAIN_SECONDS, MAX_SECONDS, SECONDS_PER_MINUTE, type Seconds } from '@/domain/time';

/**
 * 描画の視野。
 *
 * **右端の時刻と下端の軸位置は持たない。** 幅と拡大率から決まる導出値であり、
 * 持つと 2 つの値が食い違う状態を作れてしまう（{@link viewportEndTime}）。
 */
export interface Viewport {
  /** 描画領域の左端が指す時刻。 */
  readonly startTime: Seconds;
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

/** 縦軸ラベル（停留所名）に割く幅。 */
export const AXIS_LABEL_WIDTH = 112;

/** 横軸ラベル（時刻目盛）に割く高さ。 */
export const TIME_LABEL_HEIGHT = 24;

/** 時刻 → x 座標。 */
export function timeToX(time: Seconds, viewport: Viewport): number {
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

/** プロジェクトに保存された表示設定と canvas の大きさから視野を作る。 */
export function viewportOf(
  view: {
    readonly pxPerMinute: number;
    readonly pxPerAxisUnit: number;
    readonly scrollTime: Seconds;
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
