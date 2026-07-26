/** 時刻の演算。すべて 5 分刻みの不変条件を保つ。 */

import { GRAIN_SECONDS, seconds, SECONDS_PER_MINUTE, type Seconds } from './types';

/**
 * 時刻に分を加算する。
 *
 * 5 分の倍数でない分数は不変条件を壊すため受け付けない。ダイヤ設計上の操作は
 * すべて 5 分単位（入力の丸め・ドラッグのスナップ・区間所要時間）であり、
 * それ以外の値が渡るのは呼び出し側の誤りである。
 *
 * @throws {RangeError} 分が整数でない／5 の倍数でない場合、結果が範囲外の場合
 */
export function addMinutes(time: Seconds, minutes: number): Seconds {
  if (!Number.isInteger(minutes)) {
    throw new RangeError(`加算する分は整数でなければなりません: ${String(minutes)}`);
  }
  const delta = minutes * SECONDS_PER_MINUTE;
  if (delta % GRAIN_SECONDS !== 0) {
    throw new RangeError(`加算する分は 5 の倍数でなければなりません: ${String(minutes)}`);
  }
  return seconds(time + delta);
}

/**
 * {@link addMinutes} と同じ計算を行い、不変条件を満たせない場合に `null` を返す。
 *
 * 便の時刻導出（T-08）やスジのドラッグは、範囲外になり得る加算を**判定として**
 * 行う。そこで例外を投げると、描画やドラッグ中の座標計算が中断してしまう。
 * 「できない」ことが正常な結果である文脈のために用意する。
 *
 * `addMinutes` を呼び分けるのではなく包むことで、許容条件が 2 箇所に分かれて
 * 食い違うことを防いでいる。例外は範囲外のときにしか起きず、通常の経路では
 * 送出されない。
 */
export function tryAddMinutes(time: Seconds, minutes: number): Seconds | null {
  try {
    return addMinutes(time, minutes);
  } catch {
    return null;
  }
}

/**
 * 2 つの時刻の差を分で返す。`a - b`。負の値を取り得る。
 *
 * 折返し時分（次便の始発 − 当便の終着）の算出に用いる。仕様書 §2.2 では下限が
 * 0 分であり、負の値は検証エラー V-02 として扱われるため、ここでは負を許容する。
 */
export function diffMinutes(a: Seconds, b: Seconds): number {
  return (a - b) / SECONDS_PER_MINUTE;
}

/** `a` が `b` 以前か。 */
export function isBeforeOrEqual(a: Seconds, b: Seconds): boolean {
  return a <= b;
}

/** 時刻の昇順比較関数。`Array.prototype.sort` に渡す。 */
export function compareTime(a: Seconds, b: Seconds): number {
  return a - b;
}
