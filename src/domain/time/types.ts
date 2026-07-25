/**
 * 時刻の型と不変条件。
 *
 * 仕様書 §2.1:
 * - 内部表現は「その運行日の 00:00 からの経過秒数」を表す整数
 * - 24 時を超える時刻を許容する（例: 25:30 → 91800）
 * - **すべての時刻は 300 秒（5 分）の倍数である**
 *
 * 3 番目の不変条件を型で保証するため branded type を用いる（実装計画書 §3.1）。
 * 生の `number` を時刻として関数に渡せなくすることで、丸め忘れをコンパイル時に
 * 検出する。
 */

declare const secondsBrand: unique symbol;

/**
 * 00:00 からの経過秒数。
 *
 * 直接キャストせず、必ず {@link seconds} または {@link roundToGrain} を通して生成する。
 */
export type Seconds = number & { readonly [secondsBrand]: 'Seconds' };

/** 時刻の刻み（秒）。仕様書 §2.1 より 5 分固定。 */
export const GRAIN_SECONDS = 300;

export const SECONDS_PER_MINUTE = 60;
export const SECONDS_PER_HOUR = 3600;

/**
 * 許容する最大の「時」。
 *
 * 24 時超えを許容する必要がある一方（仕様書 §2.1）、無制限にすると入力ミスを
 * 検出できない。日をまたぐ運用は翌日の未明までしか続かないため、47 時（＝翌日の
 * 23:59 相当）を上限とする。
 */
export const MAX_HOUR = 47;

/** 許容する最大の秒数（47:59 を 5 分に丸めた 47:55）。 */
export const MAX_SECONDS = MAX_HOUR * SECONDS_PER_HOUR + 55 * SECONDS_PER_MINUTE;

/**
 * 数値を {@link Seconds} に変換する。不変条件を満たさない値は例外を投げる。
 *
 * 丸めは行わない。任意の秒数を受け入れたい場合は {@link roundToGrain} を使う。
 *
 * @throws {RangeError} 整数でない／負／5 分の倍数でない／上限を超える場合
 */
export function seconds(value: number): Seconds {
  if (!Number.isInteger(value)) {
    throw new RangeError(`時刻は整数でなければなりません: ${String(value)}`);
  }
  if (value < 0) {
    throw new RangeError(`時刻は負であってはなりません: ${String(value)}`);
  }
  if (value > MAX_SECONDS) {
    throw new RangeError(`時刻が上限（${String(MAX_SECONDS)} 秒）を超えています: ${String(value)}`);
  }
  if (value % GRAIN_SECONDS !== 0) {
    throw new RangeError(
      `時刻は ${String(GRAIN_SECONDS)} 秒（5 分）の倍数でなければなりません: ${String(value)}`,
    );
  }
  return value as Seconds;
}

/**
 * 任意の秒数を 5 分単位に四捨五入して {@link Seconds} にする。
 *
 * 仕様書 §6.1.2 の「入力値は 5 分単位に四捨五入する」に対応する。
 *
 * @throws {RangeError} 有限でない／負／上限を超える場合
 */
export function roundToGrain(value: number): Seconds {
  if (!Number.isFinite(value)) {
    throw new RangeError(`時刻は有限の数値でなければなりません: ${String(value)}`);
  }
  if (value < 0) {
    throw new RangeError(`時刻は負であってはなりません: ${String(value)}`);
  }
  const rounded = Math.round(value / GRAIN_SECONDS) * GRAIN_SECONDS;
  if (rounded > MAX_SECONDS) {
    throw new RangeError(`時刻が上限（${String(MAX_SECONDS)} 秒）を超えています: ${String(value)}`);
  }
  return rounded as Seconds;
}

/**
 * 時・分から {@link Seconds} を作る。テストと固定データの記述に用いる。
 *
 * @throws {RangeError} 結果が不変条件を満たさない場合
 */
export function fromHM(hours: number, minutes: number): Seconds {
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) {
    throw new RangeError(`時・分は整数でなければなりません: ${String(hours)}:${String(minutes)}`);
  }
  if (minutes < 0 || minutes > 59) {
    throw new RangeError(`分は 0〜59 の範囲でなければなりません: ${String(minutes)}`);
  }
  return seconds(hours * SECONDS_PER_HOUR + minutes * SECONDS_PER_MINUTE);
}

/** {@link Seconds} を時・分に分解する。 */
export function toHM(value: Seconds): { hours: number; minutes: number } {
  return {
    hours: Math.floor(value / SECONDS_PER_HOUR),
    minutes: Math.floor((value % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE),
  };
}
