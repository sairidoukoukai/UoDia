/**
 * 運行日カレンダーの検証（V-10・V-11。#197、仕様書 v2 §8.2）。
 *
 * **便を見ない。** 見るのはカレンダーだけであり、`validateService`（便と運用の
 * 検証）とは入力が重ならない。同じ関数に混ぜると、便を 1 つ動かすたびに暦の
 * 計算をやり直すことになる。
 *
 * **どちらも警告にする。** 検討の途中でこうなることはあり、作業を止める理由が
 * 無い（重大度の扱いは仕様書 v1.1 §9.3）。
 */

import { rangesOutsidePeriod, serviceDates } from '@/domain/calendar';
import type { ServiceCalendar } from '@/domain/model';
import { SEVERITY_OF, type ValidationIssue } from './types';

/**
 * 運行日カレンダーを検証する。
 *
 * **カレンダーが無ければ何も言わない。** 持たないことは正しい状態である
 * （案を並べて比べているだけのダイヤ）。
 */
export function validateCalendar(calendar: ServiceCalendar | undefined): ValidationIssue[] {
  if (calendar === undefined) return [];

  return [...checkRangesInPeriod(calendar), ...checkHasServiceDay(calendar)];
}

/**
 * V-10: 運行なしの範囲が有効期間の外にある。
 *
 * **年を打ち間違えるとこうなる。** `2027-08-06` と書くつもりで `2026-08-06` と
 * 書けば、範囲は**静かに効かなくなる**——エラーにはならず、休みのはずの日に
 * バスが走ることになる。
 */
function checkRangesInPeriod(calendar: ServiceCalendar): ValidationIssue[] {
  return rangesOutsidePeriod(calendar).map((range) => ({
    id: 'V-10' as const,
    severity: SEVERITY_OF['V-10'],
    message:
      `運行なしの期間 ${range.from}〜${range.to}` +
      (range.note === undefined ? '' : `（${range.note}）`) +
      ` が有効期間 ${calendar.startDate}〜${calendar.endDate} の外にあります`,
    target: { calendar: true as const },
  }));
}

/**
 * V-11: 運行なしの範囲を差し引くと、走る日が 1 日も無い。
 *
 * **有効期間を丸ごと運行なしにすると起きる。** ダイヤとしては成立しているが、
 * この状態で GTFS を出すと**便が 1 本も走らないフィード**ができる。
 */
function checkHasServiceDay(calendar: ServiceCalendar): ValidationIssue[] {
  if (serviceDates(calendar).length > 0) return [];

  return [
    {
      id: 'V-11',
      severity: SEVERITY_OF['V-11'],
      message: `有効期間 ${calendar.startDate}〜${calendar.endDate} に走る日が 1 日もありません`,
      target: { calendar: true },
    },
  ];
}
