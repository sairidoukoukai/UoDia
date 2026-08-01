/**
 * 重大度の見せ方の検証（T-34、仕様書 §6.6）。
 */

import { describe, expect, it } from 'vitest';
import type { Severity, ValidationIssue } from '@/domain/validation';
import { SEVERITY_MARK, SEVERITY_ORDER, countBySeverity, shownIssues } from './severity';

function issue(id: ValidationIssue['id'], severity: Severity, tripId = 't1'): ValidationIssue {
  return { id, severity, message: `${id} の指摘`, target: { tripId } };
}

const ISSUES: readonly ValidationIssue[] = [
  issue('V-07', 'info'),
  issue('V-02', 'error'),
  issue('V-06', 'warning'),
  issue('V-01', 'error'),
];

describe('数え上げ', () => {
  it('重大度ごとに数える', () => {
    expect(countBySeverity(ISSUES)).toEqual({ error: 2, warning: 1, info: 1 });
  });

  it('**0 件も数に入れる**（「エラーはありません」を出すため）', () => {
    expect(countBySeverity([])).toEqual({ error: 0, warning: 0, info: 0 });
  });
});

describe('並べ方', () => {
  it('重い順、同じ重さなら項目番号の順に並べる', () => {
    const shown = shownIssues(ISSUES, new Set(SEVERITY_ORDER));
    expect(shown.map((entry) => entry.id)).toEqual(['V-01', 'V-02', 'V-06', 'V-07']);
  });

  it('**検証の実行順に左右されない**（直した結果を同じ場所で追える）', () => {
    const reordered = [...ISSUES].reverse();
    expect(shownIssues(reordered, new Set(SEVERITY_ORDER)).map((entry) => entry.id)).toEqual(
      shownIssues(ISSUES, new Set(SEVERITY_ORDER)).map((entry) => entry.id),
    );
  });

  it('元の配列を書き換えない', () => {
    const before = [...ISSUES];
    shownIssues(ISSUES, new Set(SEVERITY_ORDER));
    expect(ISSUES).toEqual(before);
  });
});

describe('絞り込み', () => {
  it('選んだ重大度だけを出す', () => {
    const shown = shownIssues(ISSUES, new Set<Severity>(['error']));
    expect(shown.map((entry) => entry.id)).toEqual(['V-01', 'V-02']);
  });

  it('すべて外せば空になる', () => {
    expect(shownIssues(ISSUES, new Set())).toEqual([]);
  });
});

describe('記号', () => {
  it('**色に頼らず重大度が分かる**（§9.4）', () => {
    expect(new Set(Object.values(SEVERITY_MARK)).size).toBe(3);
  });
});
