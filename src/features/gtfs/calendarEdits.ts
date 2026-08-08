/**
 * 運行日カレンダーの編集（#197、仕様書 v2 §4.5、T-73）。**純関数のみ。**
 *
 * **次のカレンダーを返す。** 画面はそれを `editProject` に渡すだけであり、
 * 「何をどう変えるか」の判断はここに集める（`domain/service/operations.ts` と
 * 同じ作り）。
 */

import type { CalendarDate, ClosedRange, ServiceCalendar, Weekday } from '@/domain/model';

/**
 * まだカレンダーを持たないダイヤに置く既定値。
 *
 * **月〜金・1 年間**とする。このバスは平日に走り（実例の `calendar.txt` も
 * 月〜金である）、学年度はおよそ 1 年で切り替わる。**打ち直す前提の値であり、
 * 当てずっぽうではなく「たいていこうなる」ところに置く。**
 */
export function defaultCalendar(today: CalendarDate): ServiceCalendar {
  const year = Number(today.slice(0, 4));
  return {
    startDate: `${String(year)}-04-01`,
    endDate: `${String(year + 1)}-03-31`,
    weekdays: ['mon', 'tue', 'wed', 'thu', 'fri'],
    closedRanges: [],
  };
}

/**
 * 走る曜日を切り替える。
 *
 * **最後の 1 つは外せない。** 空にできないのはスキーマの決めであり（`weekdays`
 * は 1 つ以上）、**外せてしまうと保存できないカレンダーが画面上で作れる。**
 */
export function toggleWeekday(calendar: ServiceCalendar, weekday: Weekday): ServiceCalendar {
  const has = calendar.weekdays.includes(weekday);
  if (has && calendar.weekdays.length === 1) return calendar;

  const weekdays = has
    ? calendar.weekdays.filter((w) => w !== weekday)
    : [...calendar.weekdays, weekday];

  return { ...calendar, weekdays };
}

/**
 * 運行なしの範囲を足す。**両端はどちら向きに選んでもよい。**
 *
 * ドラッグは右から左へも引ける。**引いた向きで結果が変わっては、選び直すたびに
 * 向きを気にすることになる。**
 */
export function addClosedRange(
  calendar: ServiceCalendar,
  from: CalendarDate,
  to: CalendarDate,
  note?: string,
): ServiceCalendar {
  const range: ClosedRange = {
    from: from <= to ? from : to,
    to: from <= to ? to : from,
    ...(note === undefined || note === '' ? {} : { note }),
  };

  return { ...calendar, closedRanges: [...calendar.closedRanges, range] };
}

/** 運行なしの範囲を消す。 */
export function removeClosedRange(calendar: ServiceCalendar, index: number): ServiceCalendar {
  return {
    ...calendar,
    closedRanges: calendar.closedRanges.filter((_, i) => i !== index),
  };
}

/** 運行なしの範囲を打ち直す。 */
export function replaceClosedRange(
  calendar: ServiceCalendar,
  index: number,
  next: ClosedRange,
): ServiceCalendar {
  return {
    ...calendar,
    closedRanges: calendar.closedRanges.map((range, i) => (i === index ? next : range)),
  };
}

/**
 * 有効期間を変える。
 *
 * **逆順にはしない。** 開始日を終了日より後にしようとしたら、終了日も一緒に
 * 動かす——弾いて打てなくすると、期間を丸ごと後ろへずらせなくなる（開始日を
 * 先に打つと必ず逆順を通る）。
 */
export function setPeriod(
  calendar: ServiceCalendar,
  startDate: CalendarDate,
  endDate: CalendarDate,
): ServiceCalendar {
  if (startDate <= endDate) return { ...calendar, startDate, endDate };

  return startDate === calendar.startDate
    ? // 終了日を前へ動かして逆順になった。開始日を合わせる。
      { ...calendar, startDate: endDate, endDate }
    : // 開始日を後ろへ動かして逆順になった。終了日を合わせる。
      { ...calendar, startDate, endDate: startDate };
}

/** 範囲を人が読む形にする。 */
export function formatRange(range: ClosedRange): string {
  return range.from === range.to ? range.from : `${range.from} 〜 ${range.to}`;
}
