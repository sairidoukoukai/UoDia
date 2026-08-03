/**
 * 重大度の見せ方（仕様書 §6.6、T-34）。
 *
 * **色だけで区別しない**（§9.4）。記号と言葉を添えることで、色が見分けられない
 * 環境でもエラーと情報を取り違えない。
 *
 * 並べ替えと数え上げをここに置くのは、パネルが「並べるだけ」で済むように
 * するためである。
 */

import type { Severity, ValidationIssue } from '@/domain/validation';

/** 重い順。画面の並びも数の並びもこの順に従う。 */
export const SEVERITY_ORDER: readonly Severity[] = ['error', 'warning', 'info'];

export const SEVERITY_LABEL: Readonly<Record<Severity, string>> = {
  error: 'エラー',
  warning: '警告',
  info: '情報',
};

/** 記号。色に頼らずに重大度を伝える（§9.4）。 */
export const SEVERITY_MARK: Readonly<Record<Severity, string>> = {
  error: '✖',
  warning: '▲',
  info: 'ℹ',
};

/** 重大度ごとの件数。0 件のものも数に入れる（「エラーはありません」を出すため）。 */
export function countBySeverity(
  issues: readonly ValidationIssue[],
): Readonly<Record<Severity, number>> {
  const counts: Record<Severity, number> = { error: 0, warning: 0, info: 0 };
  for (const issue of issues) counts[issue.severity] += 1;
  return counts;
}

/**
 * 画面に出す指摘。**重い順、同じ重さなら項目番号の順**に並べる。
 *
 * 検証の実行順に並べると、便を 1 つ足しただけで一覧の順序が入れ替わる。同じ
 * 指摘が同じ場所にあることが、直した結果を追える条件である。
 */
export function shownIssues(
  issues: readonly ValidationIssue[],
  shown: ReadonlySet<Severity>,
): readonly ValidationIssue[] {
  return issues
    .filter((issue) => shown.has(issue.severity))
    .toSorted(
      (a, b) =>
        SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity) ||
        a.id.localeCompare(b.id),
    );
}
