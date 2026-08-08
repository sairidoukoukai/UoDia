import { describe, expect, it } from 'vitest';
import type { ServiceCalendar } from '@/domain/model';
import {
  addClosedRange,
  defaultCalendar,
  formatRange,
  removeClosedRange,
  replaceClosedRange,
  setPeriod,
  toggleWeekday,
} from './calendarEdits';
import { clampMonth, dayKindOf, monthGrid, monthOf, shiftMonth } from './monthGrid';

function makeCalendar(overrides: Partial<ServiceCalendar> = {}): ServiceCalendar {
  return {
    startDate: '2026-04-01',
    endDate: '2027-03-31',
    weekdays: ['mon', 'tue', 'wed', 'thu', 'fri'],
    closedRanges: [],
    ...overrides,
  };
}

describe('defaultCalendar', () => {
  it('月〜金・年度いっぱいを既定にする', () => {
    const calendar = defaultCalendar('2026-08-09');
    expect(calendar.weekdays).toEqual(['mon', 'tue', 'wed', 'thu', 'fri']);
    expect(calendar.startDate).toBe('2026-04-01');
    expect(calendar.endDate).toBe('2027-03-31');
  });

  it('運行なしの範囲は持たずに始まる', () => {
    expect(defaultCalendar('2026-08-09').closedRanges).toEqual([]);
  });
});

describe('toggleWeekday', () => {
  it('外す', () => {
    expect(toggleWeekday(makeCalendar(), 'mon').weekdays).toEqual(['tue', 'wed', 'thu', 'fri']);
  });

  it('足す', () => {
    expect(toggleWeekday(makeCalendar(), 'sat').weekdays).toContain('sat');
  });

  it('**最後の 1 つは外せない**（保存できないカレンダーを画面上で作らせない）', () => {
    const single = makeCalendar({ weekdays: ['mon'] });
    expect(toggleWeekday(single, 'mon')).toBe(single);
  });
});

describe('addClosedRange', () => {
  it('範囲を足す', () => {
    const next = addClosedRange(makeCalendar(), '2026-08-06', '2026-09-30', '夏季休業');
    expect(next.closedRanges).toEqual([{ from: '2026-08-06', to: '2026-09-30', note: '夏季休業' }]);
  });

  it('**逆向きに引いても同じ結果になる**', () => {
    const forward = addClosedRange(makeCalendar(), '2026-08-06', '2026-09-30');
    const backward = addClosedRange(makeCalendar(), '2026-09-30', '2026-08-06');
    expect(backward.closedRanges).toEqual(forward.closedRanges);
  });

  it('**1 日だけの範囲を作れる**', () => {
    const next = addClosedRange(makeCalendar(), '2026-05-01', '2026-05-01');
    expect(next.closedRanges[0]).toEqual({ from: '2026-05-01', to: '2026-05-01' });
  });

  it('空の注記は項目ごと落とす', () => {
    const next = addClosedRange(makeCalendar(), '2026-05-01', '2026-05-01', '');
    expect(next.closedRanges[0]).not.toHaveProperty('note');
  });

  it('**重なっていても足せる**（夏季休業とお盆を別々に書ける）', () => {
    let calendar = addClosedRange(makeCalendar(), '2026-08-06', '2026-09-30', '夏季休業');
    calendar = addClosedRange(calendar, '2026-08-13', '2026-08-16', 'お盆');
    expect(calendar.closedRanges).toHaveLength(2);
  });
});

describe('removeClosedRange / replaceClosedRange', () => {
  const calendar = makeCalendar({
    closedRanges: [
      { from: '2026-05-01', to: '2026-05-01' },
      { from: '2026-08-06', to: '2026-09-30' },
    ],
  });

  it('消す', () => {
    expect(removeClosedRange(calendar, 0).closedRanges).toEqual([
      { from: '2026-08-06', to: '2026-09-30' },
    ]);
  });

  it('打ち直す', () => {
    const next = replaceClosedRange(calendar, 1, {
      from: '2026-08-06',
      to: '2026-09-30',
      note: '夏季休業',
    });
    expect(next.closedRanges[1]?.note).toBe('夏季休業');
    expect(next.closedRanges[0]).toEqual(calendar.closedRanges[0]);
  });
});

describe('setPeriod', () => {
  it('そのまま入れる', () => {
    const next = setPeriod(makeCalendar(), '2026-04-01', '2026-09-30');
    expect(next.endDate).toBe('2026-09-30');
  });

  it('**終了日を開始日より前にしたら、開始日を合わせる**', () => {
    const next = setPeriod(makeCalendar(), '2026-04-01', '2026-03-01');
    expect(next.startDate).toBe('2026-03-01');
    expect(next.endDate).toBe('2026-03-01');
  });

  it('**開始日を終了日より後にしたら、終了日を合わせる**（期間を後ろへずらせる）', () => {
    const next = setPeriod(makeCalendar(), '2027-06-01', '2027-03-31');
    expect(next.startDate).toBe('2027-06-01');
    expect(next.endDate).toBe('2027-06-01');
  });
});

describe('formatRange', () => {
  it('1 日なら 1 つだけ出す', () => {
    expect(formatRange({ from: '2026-05-01', to: '2026-05-01' })).toBe('2026-05-01');
  });

  it('範囲なら両端を出す', () => {
    expect(formatRange({ from: '2026-05-01', to: '2026-05-06' })).toBe('2026-05-01 〜 2026-05-06');
  });
});

describe('monthOf / shiftMonth / clampMonth', () => {
  it('月を取る', () => {
    expect(monthOf('2026-08-09')).toBe('2026-08');
  });

  it('**年をまたいで送る**', () => {
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2027-01', -1)).toBe('2026-12');
  });

  it('**有効期間の外へは出ない**（送り続けると、どこを見ているか分からなくなる）', () => {
    const calendar = makeCalendar();
    expect(clampMonth('2025-01', calendar)).toBe('2026-04');
    expect(clampMonth('2030-01', calendar)).toBe('2027-03');
    expect(clampMonth('2026-08', calendar)).toBe('2026-08');
  });
});

describe('dayKindOf', () => {
  const calendar = makeCalendar({
    closedRanges: [{ from: '2026-08-06', to: '2026-09-30' }],
  });

  it('走る日', () => {
    expect(dayKindOf(calendar, '2026-04-01')).toBe('runs');
  });

  it('**走らない曜日と運行なしを分ける**（直し方が違う）', () => {
    expect(dayKindOf(calendar, '2026-04-04')).toBe('offWeekday');
    expect(dayKindOf(calendar, '2026-08-06')).toBe('closed');
  });

  it('**曜日で外れる日が優先される**（土曜は範囲に入っていても offWeekday）', () => {
    // 2026-08-08 は土曜。範囲の中だが、直すべきは曜日のチェックではない——
    // ここを closed と描くと、範囲を消しても走らないままで理由が分からない。
    expect(dayKindOf(calendar, '2026-08-08')).toBe('offWeekday');
  });

  it('期間の外', () => {
    expect(dayKindOf(calendar, '2026-03-31')).toBe('outside');
    expect(dayKindOf(calendar, '2027-04-01')).toBe('outside');
  });
});

describe('monthGrid', () => {
  const calendar = makeCalendar();

  it('**週の頭は月曜**（曜日の並びと揃える）', () => {
    const grid = monthGrid(calendar, '2026-04');
    expect(grid.weeks[0]).toHaveLength(7);
    expect(grid.weeks.every((week) => week.length === 7)).toBe(true);
  });

  it('**前後の月で升目を埋める**（週の形が月によって変わらない）', () => {
    const grid = monthGrid(calendar, '2026-04');
    const first = grid.weeks[0]?.[0];
    expect(first?.inMonth).toBe(false);
    expect(first?.date).toBe('2026-03-30');
  });

  it('その月の日をすべて含む', () => {
    const grid = monthGrid(calendar, '2026-04');
    const inMonth = grid.weeks.flat().filter((cell) => cell.inMonth);
    expect(inMonth).toHaveLength(30);
  });

  it('**閏月でも数え間違えない**', () => {
    const leap = makeCalendar({ startDate: '2028-01-01', endDate: '2028-12-31' });
    const inMonth = monthGrid(leap, '2028-02')
      .weeks.flat()
      .filter((cell) => cell.inMonth);
    expect(inMonth).toHaveLength(29);
  });

  it('年と月を持つ', () => {
    const grid = monthGrid(calendar, '2026-04');
    expect(grid.year).toBe(2026);
    expect(grid.monthNumber).toBe(4);
  });
});
