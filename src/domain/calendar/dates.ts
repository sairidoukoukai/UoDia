/**
 * 暦の上の日の計算（#197、仕様書 v2 §4）。
 *
 * **`YYYY-MM-DD` の文字列を値として扱う。** `Date` は日をまたぐ計算のためにだけ
 * 使い、外へは出さない——外へ出すとタイムゾーンの解釈が呼び出し側にまで漏れる。
 *
 * **UTC で組む。** ローカル時刻で組むと、実行環境の時差によって日付が 1 日ずれ、
 * **同じプロジェクトが環境によって違う日数を返す。**
 */

import { WEEKDAYS, type CalendarDate, type Weekday } from '@/domain/model';

/** 1 日のミリ秒。 */
const DAY_MS = 24 * 60 * 60 * 1000;

/** `YYYY-MM-DD` を UTC のミリ秒にする。 */
function toEpoch(date: CalendarDate): number {
  const [year = 0, month = 1, day = 1] = date.split('-').map(Number);
  return Date.UTC(year, month - 1, day);
}

/** UTC のミリ秒を `YYYY-MM-DD` にする。 */
function toDate(epoch: number): CalendarDate {
  return new Date(epoch).toISOString().slice(0, 10);
}

/**
 * その日の曜日。
 *
 * `Date.getUTCDay()` は日曜が 0 だが、{@link WEEKDAYS} は月曜始まりである
 * （カレンダーの並びと揃えてある）。**並びの違いをここ 1 か所で吸収する。**
 */
export function weekdayOf(date: CalendarDate): Weekday {
  const index = (new Date(toEpoch(date)).getUTCDay() + 6) % 7;
  // WEEKDAYS は 7 要素の凍結配列であり、index は 0〜6 に収まる。
  return WEEKDAYS[index] ?? 'mon';
}

/** `from` から `to` まで（**両端を含む**）の日を昇順に並べる。 */
export function eachDate(from: CalendarDate, to: CalendarDate): CalendarDate[] {
  if (from > to) return [];

  const dates: CalendarDate[] = [];
  const end = toEpoch(to);
  for (let epoch = toEpoch(from); epoch <= end; epoch += DAY_MS) {
    dates.push(toDate(epoch));
  }
  return dates;
}

/** その範囲に日が含まれるか。**両端を含む。** */
export function includesDate(range: { from: CalendarDate; to: CalendarDate }, date: CalendarDate) {
  return range.from <= date && date <= range.to;
}
