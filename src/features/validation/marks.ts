/**
 * 便ごとの印（T-61、#165、仕様書 v1.1 §5.2）。
 *
 * 検証の指摘は検証パネルにしか出ていなかった。**時刻表を見ているあいだ、どの列に
 * 問題があるのかが分からない。** パネルの項目を押せばその便へ飛べるが、それは
 * 一覧を読んでいるときの動線であって、表を読んでいるときの動線ではない。
 *
 * ここが返すのは「この便に付ける印」だけである。**塗るかどうかは見せ方の側が
 * 決める**（重大度から決まる。仕様書 v1.1 §9.3）。
 */

import type { Severity, ValidationIssue } from '@/domain/validation';
import { SEVERITY_ORDER } from './severity';

/** 1 つの便に付ける印。 */
export interface TripMark {
  /** 最も重い指摘の重大度。 */
  readonly severity: Severity;
  /** その指摘の文面。`title` に出す。 */
  readonly message: string;
  /** その便に付いている指摘の件数。2 件以上なら `title` に添える。 */
  readonly count: number;
}

/** 重い順、同じ重さなら項目番号の順。`shownIssues` の並べ替えと同じ規則。 */
function isHeavier(candidate: ValidationIssue, current: ValidationIssue): boolean {
  const bySeverity =
    SEVERITY_ORDER.indexOf(candidate.severity) - SEVERITY_ORDER.indexOf(current.severity);
  return bySeverity === 0 ? candidate.id.localeCompare(current.id) < 0 : bySeverity < 0;
}

/**
 * 便ごとに、**最も重い 1 件**の印を返す。
 *
 * **印を並べない。** 2 件以上付く便に記号を 2 つ出すと列が広がる——列の幅を
 * 決めるのは時刻である（仕様書 v4.37）。件数は `title` に添えるため、
 * 何件あるかは失われない。
 *
 * 運用を指す指摘（V-05・V-09）は便を指していないため、ここには現れない。
 * それらは検証パネルが運用ごとに出す。
 */
export function tripMarks(issues: readonly ValidationIssue[]): ReadonlyMap<string, TripMark> {
  const heaviest = new Map<string, ValidationIssue>();
  const counts = new Map<string, number>();

  for (const issue of issues) {
    const { tripId } = issue.target;
    if (tripId === undefined) continue;

    counts.set(tripId, (counts.get(tripId) ?? 0) + 1);
    const current = heaviest.get(tripId);
    if (current === undefined || isHeavier(issue, current)) heaviest.set(tripId, issue);
  }

  const marks = new Map<string, TripMark>();
  for (const [tripId, issue] of heaviest) {
    marks.set(tripId, {
      severity: issue.severity,
      message: issue.message,
      count: counts.get(tripId) ?? 1,
    });
  }
  return marks;
}
