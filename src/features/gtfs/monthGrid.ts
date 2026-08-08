/**
 * カレンダーの月表（#197、仕様書 v2 §4.5、T-73）。**純関数のみ。**
 *
 * 暦の計算そのものは `domain/calendar` が持つ。ここにあるのは**画面に並べる形**
 * ——7 列の升目と、その日をどう描くか——だけである。
 */

import { eachDate, includesDate, weekdayOf } from '@/domain/calendar';
import { WEEKDAYS, type CalendarDate, type ServiceCalendar, type Weekday } from '@/domain/model';

/**
 * その日の見え方。**曜日で外れる日と、範囲で外れる日を描き分ける**（§4.5）。
 *
 * どちらも「走らない日」だが、**直し方が違う**——前者は曜日のチェックを、後者は
 * 範囲を触ることになる。同じ見た目にすると、消せない日をクリックし続けることに
 * なる。
 */
export type DayKind =
  /** 走る。 */
  | 'runs'
  /** 走る曜日ではない。**押しても範囲は増えない。** */
  | 'offWeekday'
  /** 運行なしの範囲に入っている。 */
  | 'closed'
  /** 有効期間の外。 */
  | 'outside';

export interface DayCell {
  readonly date: CalendarDate;
  /** その月の日（1〜31）。 */
  readonly day: number;
  readonly kind: DayKind;
  /** 表示中の月に属するか。前後の月からはみ出した升目は `false`。 */
  readonly inMonth: boolean;
}

/** 1 か月ぶんの升目。**週の並びに切ってある。** */
export interface MonthGrid {
  /** `YYYY-MM`。 */
  readonly month: string;
  readonly year: number;
  /** 1〜12。 */
  readonly monthNumber: number;
  /** 週ごとの 7 升。 */
  readonly weeks: readonly (readonly DayCell[])[];
}

/** `YYYY-MM-DD` から `YYYY-MM` を取る。 */
export function monthOf(date: CalendarDate): string {
  return date.slice(0, 7);
}

/** `YYYY-MM` の 1 日。 */
function firstOfMonth(month: string): CalendarDate {
  return `${month}-01`;
}

/** `YYYY-MM` の末日。 */
function lastOfMonth(month: string): CalendarDate {
  const [year = 0, monthNumber = 1] = month.split('-').map(Number);
  // 翌月の 0 日 = 今月の末日。UTC で組む（`domain/calendar` と同じ理由）。
  const last = new Date(Date.UTC(year, monthNumber, 0));
  return last.toISOString().slice(0, 10);
}

/** 月を送る（`delta` は月数）。 */
export function shiftMonth(month: string, delta: number): string {
  const [year = 0, monthNumber = 1] = month.split('-').map(Number);
  const shifted = new Date(Date.UTC(year, monthNumber - 1 + delta, 1));
  return shifted.toISOString().slice(0, 7);
}

/**
 * 送れる先を有効期間の中に留める（§4.5.2）。
 *
 * **送り続けられると、自分がどこを見ているのか分からなくなる。**
 */
export function clampMonth(month: string, calendar: ServiceCalendar): string {
  const first = monthOf(calendar.startDate);
  const last = monthOf(calendar.endDate);
  if (month < first) return first;
  if (month > last) return last;
  return month;
}

/** その日をどう描くか。 */
export function dayKindOf(calendar: ServiceCalendar, date: CalendarDate): DayKind {
  if (date < calendar.startDate || calendar.endDate < date) return 'outside';
  if (!calendar.weekdays.includes(weekdayOf(date))) return 'offWeekday';
  if (calendar.closedRanges.some((range) => includesDate(range, date))) return 'closed';
  return 'runs';
}

/**
 * 月表を組む。**月曜始まり**（`WEEKDAYS` の並びと揃える）。
 *
 * 前後の月の日で升目を埋める。空欄にすると、週の形が月によって変わり、
 * **どの列が何曜日なのかを毎回数え直すことになる。**
 */
export function monthGrid(calendar: ServiceCalendar, month: string): MonthGrid {
  const first = firstOfMonth(month);
  const last = lastOfMonth(month);

  // 週の頭（月曜）まで前へ、週の終わり（日曜）まで後ろへ広げる。
  const leading = WEEKDAYS.indexOf(weekdayOf(first));
  const trailing = 6 - WEEKDAYS.indexOf(weekdayOf(last));

  const from = shiftDays(first, -leading);
  const to = shiftDays(last, trailing);

  const cells: DayCell[] = eachDate(from, to).map((date) => ({
    date,
    day: Number(date.slice(8, 10)),
    kind: dayKindOf(calendar, date),
    inMonth: monthOf(date) === month,
  }));

  const weeks: DayCell[][] = [];
  for (let index = 0; index < cells.length; index += 7) {
    weeks.push(cells.slice(index, index + 7));
  }

  const [year = 0, monthNumber = 1] = month.split('-').map(Number);
  return { month, year, monthNumber, weeks };
}

/** 日を前後にずらす。 */
function shiftDays(date: CalendarDate, days: number): CalendarDate {
  const [year = 0, month = 1, day = 1] = date.split('-').map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return shifted.toISOString().slice(0, 10);
}

/** 曜日の見出し。**月曜始まり。** */
export const WEEKDAY_LABEL: Readonly<Record<Weekday, string>> = {
  mon: '月',
  tue: '火',
  wed: '水',
  thu: '木',
  fri: '金',
  sat: '土',
  sun: '日',
};
