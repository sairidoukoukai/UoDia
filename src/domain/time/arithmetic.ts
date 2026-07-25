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
