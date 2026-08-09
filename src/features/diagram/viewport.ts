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
  /** 描画領域の上端。**目盛の帯の下**である。 */
  readonly originY: number;
  /**
   * この視野に割り当てられた帯の天（CSS px。T-86）。
   *
   * **目盛の帯の上**である。canvas 全体を 1 つの視野で使うなら `0`。書き出しは
   * 1 枚を 3 段に割るため、2 段目以降はここが 0 でなくなる（`exportBands`）。
   *
   * **`left` は無い。** 段は縦にしか割らないためであり、要るものだけを持つ。
   */
  readonly top: number;
  /**
   * 割り当てられた帯の右端（CSS px）。
   *
   * canvas 全体を使うなら canvas の幅そのものである。
   */
  readonly width: number;
  /**
   * 割り当てられた帯の地（CSS px）。
   *
   * **高さではなく下端の座標である**（`top` からの差ではない）。canvas 全体を
   * 使うなら canvas の高さと一致するため、これまで区別が要らなかった。
   */
  readonly height: number;
}

/**
 * 縦軸ラベル（停留所の略称）に割く幅。
 *
 * 一番長い略称「コンベ前」（4 文字）が 12px の字で 48px になり、線との間合い
 * （`LABEL_PADDING`）を足して 56px とする。**幅を名前から決める。** 逆にすると、
 * 収まらない名前を縮めて出すことになり、どの線がどの停留所かを読めなくする
 * （T-25）。
 *
 * 正式名「コンベンションセンター前」（12 文字）で採っていた 144px から詰めた
 * （#116）。**削っていたのは描画領域である**——縦軸の欄が広いぶんだけ、1 画面に
 * 出せる時間帯が狭くなっていた。
 */
export const AXIS_LABEL_WIDTH = 56;

/** 横軸ラベル（時刻目盛）に割く高さ。 */
export const TIME_LABEL_HEIGHT = 24;

/**
 * 縦軸の端に空ける余白（px。#171）。
 *
 * **端の停留所線を描画領域の縁に張り付かせない。** 縁に来ると、その線の上に
 * 描くものが半分に切れる——停車点の丸（半径 3.5px）・選択のつまみ（一辺 7px を
 * 中心合わせ）・便番号の文字。豊中学舎は `axisPosition: 0` であり、**一番上まで
 * 送ると線がちょうど `originY` に来るため、既定の配置で必ず起きていた。**
 *
 * **px で持つ。** 線幅や点の半径と同じ**絵の記号の大きさ**であって、距離でも
 * 時間でもない。軸の単位で持つと、縦に拡げるたびに余白が広がる。
 *
 * **送りの範囲ではなく軸の写像に入れる。** 範囲の端をずらす形にすると、保存
 * されている `scrollAxis: 0`（既定）が範囲の外になり、**一度動かすまで直らない。**
 * `originY` をずらす形にすると、枠・クリップ・格子の範囲まで一緒に動く——
 * **動かしたいのは停留所線の位置だけである。**
 *
 * **幅はそこに何が積まれるかで決まる。** 端の外側に出るものを数え、最も遠い
 * ものに合わせる。
 *
 * | 積まれるもの | はみ出し |
 * | --- | --- |
 * | 選択のつまみ（一辺 7px を中心合わせ） | 3.5px |
 * | 停車点の丸 | 3.5px |
 * | 折返しの接続線（#167）。7px × 3 段 | 21px |
 * | **回送のヒゲ**（#179。`STUB_LENGTH`） | **30px** |
 *
 * **32px はヒゲに合わせた値である。** ヒゲは下へしか伸びず、接続線は上下の
 * 両方へ積まれるが、**余白を上下で違えると `scrollRanges` の引き算が 2 通りに
 * なる**——1 つの値で足りるなら 1 つにする。
 *
 * **接続線が 4 段以上になると一番外の線は切れる。** 切れたことは絵から読める
 * ため、起きたときに広げればよい——起きるかどうか分からない段数ぶんを、いま
 * 画面から削る理由が無い。
 */
export const AXIS_EDGE_MARGIN = 32;

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
  return (
    viewport.originY +
    AXIS_EDGE_MARGIN +
    (axisPosition - viewport.startAxis) * viewport.pxPerAxisUnit
  );
}

/** y 座標 → 軸位置。 */
export function yToAxis(y: number, viewport: Viewport): number {
  return viewport.startAxis + (y - viewport.originY - AXIS_EDGE_MARGIN) / viewport.pxPerAxisUnit;
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
    // 画面は canvas 全体を 1 つの視野で使う。段に割るのは書き出しだけである。
    top: 0,
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
