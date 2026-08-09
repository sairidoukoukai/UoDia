/**
 * 運行日の算出（#197、仕様書 v2 §4）。
 *
 * カレンダーが持つのは 2 段である（§4.3）。
 *
 * 1. **走る曜日** — 繰り返し
 * 2. **運行なしの範囲** — 例外
 *
 * ここで行うのは、その 2 段から「実際に走る日」と「GTFS に出す運休日」を出す
 * ことだけである。**純関数のみ**（README の制約 1）。
 */

import type { CalendarDate, ClosedRange, ServiceCalendar } from '@/domain/model';
import { eachDate, includesDate, weekdayOf } from './dates';

/** その日が走る曜日に当たるか。 */
function runsOnWeekday(calendar: ServiceCalendar, date: CalendarDate): boolean {
  return calendar.weekdays.includes(weekdayOf(date));
}

/** その日が運行なしの範囲に入っているか。 */
function isClosed(ranges: readonly ClosedRange[], date: CalendarDate): boolean {
  return ranges.some((range) => includesDate(range, date));
}

/**
 * 実際に走る日を昇順に並べる。
 *
 * **範囲が重なっていても二重に引かない。** 「その日が 1 つでも範囲に入っているか」
 * を見るだけであり、範囲の数は結果に影響しない（§4.4）。
 */
export function serviceDates(calendar: ServiceCalendar): CalendarDate[] {
  return eachDate(calendar.startDate, calendar.endDate).filter(
    (date) => runsOnWeekday(calendar, date) && !isClosed(calendar.closedRanges, date),
  );
}

/**
 * GTFS `calendar_dates.txt` に `exception_type: 2`（運休）として出す日。
 *
 * **曜日で既に外れている日は出さない**（§4.6）。夏季休業の中の日曜を運休として
 * 出しても意味は変わらないが、**行数が 3 倍近くになる。** 読む側が「なぜこの日が
 * 2 回外れているのか」を確かめる羽目になる。
 *
 * **有効期間の外も出さない。** `calendar.txt` の `start_date` / `end_date` の
 * 外側は、そもそも走らない日である。
 */
export function closedDates(calendar: ServiceCalendar): CalendarDate[] {
  return eachDate(calendar.startDate, calendar.endDate).filter(
    (date) => runsOnWeekday(calendar, date) && isClosed(calendar.closedRanges, date),
  );
}

/**
 * その日にバスが走るか。
 *
 * **有効期間の外は走らない。** カレンダーは「いつからいつまでのダイヤか」を
 * 含めて 1 つの決めである。
 */
export function runsOn(calendar: ServiceCalendar, date: CalendarDate): boolean {
  if (date < calendar.startDate || calendar.endDate < date) return false;
  return runsOnWeekday(calendar, date) && !isClosed(calendar.closedRanges, date);
}

/**
 * 有効期間の外にはみ出している運行なしの範囲。
 *
 * **V-10 が使う**（仕様書 v2 §8.2）。年を打ち間違えるとこうなる——`2027-08-06` と
 * 書くつもりで `2026-08-06` と書けば、範囲は静かに効かなくなる。
 *
 * **一部でも重なっていれば「外ではない」とする。** 半分だけはみ出した範囲は
 * 意図した入力であることが多い（学年度の変わり目）。
 */
export function rangesOutsidePeriod(calendar: ServiceCalendar): ClosedRange[] {
  return calendar.closedRanges.filter(
    (range) => range.to < calendar.startDate || calendar.endDate < range.from,
  );
}
