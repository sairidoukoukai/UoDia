import { describe, expect, it } from 'vitest';
import type { ServiceCalendar } from '@/domain/model';
import { validateCalendar } from './calendar';

function makeCalendar(overrides: Partial<ServiceCalendar> = {}): ServiceCalendar {
  return {
    startDate: '2026-04-01',
    endDate: '2027-03-31',
    weekdays: ['mon', 'tue', 'wed', 'thu', 'fri'],
    closedRanges: [],
    ...overrides,
  };
}

const idsOf = (calendar: ServiceCalendar | undefined): string[] =>
  validateCalendar(calendar).map((i) => i.id);

describe('validateCalendar', () => {
  it('**カレンダーが無ければ何も言わない**（持たないことは正しい状態である）', () => {
    // 案を並べて比べているだけのダイヤは運行日を持たない（UC-2）。
    expect(validateCalendar(undefined)).toEqual([]);
  });

  it('揃っていれば何も言わない', () => {
    expect(validateCalendar(makeCalendar())).toEqual([]);
  });
});

describe('V-10: 運行なしの範囲が有効期間の外にある', () => {
  it('**年を打ち間違えた範囲を報告する**', () => {
    // 範囲は静かに効かなくなる——エラーにはならず、休みのはずの日にバスが走る。
    const calendar = makeCalendar({ closedRanges: [{ from: '2025-08-06', to: '2025-09-30' }] });
    expect(idsOf(calendar)).toContain('V-10');
  });

  it('警告である（作業を止める理由が無い）', () => {
    const calendar = makeCalendar({ closedRanges: [{ from: '2025-08-06', to: '2025-09-30' }] });
    expect(validateCalendar(calendar)[0]?.severity).toBe('warning');
  });

  it('範囲を名指しし、注記があれば添える', () => {
    const calendar = makeCalendar({
      closedRanges: [{ from: '2025-08-06', to: '2025-09-30', note: '夏季休業' }],
    });
    const issue = validateCalendar(calendar).find((i) => i.id === 'V-10');

    expect(issue?.message).toContain('2025-08-06');
    expect(issue?.message).toContain('夏季休業');
  });

  it('**便も運用も指さない**（飛び先はカレンダータブである）', () => {
    const calendar = makeCalendar({ closedRanges: [{ from: '2025-08-06', to: '2025-09-30' }] });
    const issue = validateCalendar(calendar).find((i) => i.id === 'V-10');

    expect(issue?.target).toEqual({ calendar: true });
  });

  it('半分だけはみ出した範囲は報告しない', () => {
    const calendar = makeCalendar({ closedRanges: [{ from: '2026-03-01', to: '2026-04-05' }] });
    expect(idsOf(calendar)).not.toContain('V-10');
  });
});

describe('V-11: 走る日が 1 日も無い', () => {
  it('**有効期間を丸ごと運行なしにすると報告する**', () => {
    const calendar = makeCalendar({
      startDate: '2026-04-01',
      endDate: '2026-04-30',
      closedRanges: [{ from: '2026-04-01', to: '2026-04-30' }],
    });

    expect(idsOf(calendar)).toContain('V-11');
  });

  it('走る曜日が有効期間に 1 日も現れないときも報告する', () => {
    // 2026-04-04 と 4-05 は土日。月〜金しか走らないダイヤでは 1 日も走らない。
    const calendar = makeCalendar({ startDate: '2026-04-04', endDate: '2026-04-05' });
    expect(idsOf(calendar)).toContain('V-11');
  });

  it('1 日でも走れば報告しない', () => {
    const calendar = makeCalendar({
      startDate: '2026-04-01',
      endDate: '2026-04-30',
      closedRanges: [{ from: '2026-04-02', to: '2026-04-30' }],
    });

    expect(idsOf(calendar)).not.toContain('V-11');
  });

  it('警告である', () => {
    const calendar = makeCalendar({ startDate: '2026-04-04', endDate: '2026-04-05' });
    expect(validateCalendar(calendar).find((i) => i.id === 'V-11')?.severity).toBe('warning');
  });
});
