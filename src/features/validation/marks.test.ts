/**
 * 便ごとの印の検証（T-61、#165）。
 *
 * 確かめるのは **「どの便にどの印が付くか」** だけである。塗るかどうかは
 * 見せ方の側（`TimetableGrid`）が重大度から決める。
 */

import { describe, expect, it } from 'vitest';
import type { ValidationIssue } from '@/domain/validation';
import { tripMarks } from './marks';

function issue(
  id: ValidationIssue['id'],
  severity: ValidationIssue['severity'],
  tripId: string | undefined,
  message = `${id} の説明`,
): ValidationIssue {
  return { id, severity, message, target: tripId === undefined ? {} : { tripId } };
}

describe('tripMarks', () => {
  it('便ごとに印を返す', () => {
    const marks = tripMarks([issue('V-04', 'error', 't1'), issue('V-07', 'info', 't2')]);

    expect(marks.get('t1')?.severity).toBe('error');
    expect(marks.get('t2')?.severity).toBe('info');
  });

  it('**最も重い 1 件で示す**（印を並べると列が広がる）', () => {
    const marks = tripMarks([
      issue('V-07', 'info', 't1'),
      issue('V-02', 'error', 't1'),
      issue('V-06', 'warning', 't1'),
    ]);

    expect(marks.get('t1')?.severity).toBe('error');
    expect(marks.get('t1')?.message).toBe('V-02 の説明');
  });

  it('同じ重さなら項目番号の順（検証の実行順に左右されない）', () => {
    const marks = tripMarks([issue('V-03', 'error', 't1'), issue('V-01', 'error', 't1')]);

    expect(marks.get('t1')?.message).toBe('V-01 の説明');
  });

  it('件数は全部数える（印は 1 つでも、何件あるかは失わない）', () => {
    const marks = tripMarks([
      issue('V-02', 'error', 't1'),
      issue('V-06', 'warning', 't1'),
      issue('V-07', 'info', 't1'),
    ]);

    expect(marks.get('t1')?.count).toBe(3);
  });

  it('**運用を指す指摘は現れない**（便を指していない）', () => {
    // V-05・V-09 は `blockId` だけを持つ。検証パネルが運用ごとに出す。
    expect(tripMarks([issue('V-05', 'warning', undefined)]).size).toBe(0);
  });

  it('指摘が無ければ空', () => {
    expect(tripMarks([]).size).toBe(0);
  });

  it('**両側から出た 2 件は、それぞれの便に付く**（#165 の核心）', () => {
    const marks = tripMarks([issue('V-02', 'error', 't1'), issue('V-02', 'error', 't2')]);

    expect(marks.get('t1')?.severity).toBe('error');
    expect(marks.get('t2')?.severity).toBe('error');
  });
});
