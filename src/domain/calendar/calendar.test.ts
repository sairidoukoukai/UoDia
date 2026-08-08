import { describe, expect, it } from 'vitest';
import type { ServiceCalendar } from '@/domain/model';
import {
  closedDates,
  eachDate,
  rangesOutsidePeriod,
  runsOn,
  serviceDates,
  weekdayOf,
} from './index';

/** 月〜金に走る、2026 年度いっぱいのカレンダー。 */
function makeCalendar(overrides: Partial<ServiceCalendar> = {}): ServiceCalendar {
  return {
    startDate: '2026-04-01',
    endDate: '2027-03-31',
    weekdays: ['mon', 'tue', 'wed', 'thu', 'fri'],
    closedRanges: [],
    ...overrides,
  };
}

describe('weekdayOf', () => {
  it('曜日を返す', () => {
    // 2026-04-01 は水曜日。
    expect(weekdayOf('2026-04-01')).toBe('wed');
    expect(weekdayOf('2026-04-04')).toBe('sat');
    expect(weekdayOf('2026-04-05')).toBe('sun');
    expect(weekdayOf('2026-04-06')).toBe('mon');
  });

  it('**月をまたいでも数え間違えない**', () => {
    expect(weekdayOf('2026-04-30')).toBe('thu');
    expect(weekdayOf('2026-05-01')).toBe('fri');
  });

  it('閏日を数える', () => {
    // 2028 は閏年。
    expect(weekdayOf('2028-02-29')).toBe('tue');
    expect(weekdayOf('2028-03-01')).toBe('wed');
  });
});

describe('eachDate', () => {
  it('両端を含む', () => {
    expect(eachDate('2026-04-01', '2026-04-03')).toEqual([
      '2026-04-01',
      '2026-04-02',
      '2026-04-03',
    ]);
  });

  it('同じ日なら 1 日だけ返す', () => {
    expect(eachDate('2026-04-01', '2026-04-01')).toEqual(['2026-04-01']);
  });

  it('逆順なら空を返す', () => {
    expect(eachDate('2026-04-03', '2026-04-01')).toEqual([]);
  });

  it('**月と年をまたぐ**', () => {
    expect(eachDate('2026-12-30', '2027-01-02')).toEqual([
      '2026-12-30',
      '2026-12-31',
      '2027-01-01',
      '2027-01-02',
    ]);
  });

  it('閏日を飛ばさない', () => {
    expect(eachDate('2028-02-28', '2028-03-01')).toEqual([
      '2028-02-28',
      '2028-02-29',
      '2028-03-01',
    ]);
  });
});

describe('serviceDates', () => {
  it('走る曜日だけを返す', () => {
    const calendar = makeCalendar({ startDate: '2026-04-01', endDate: '2026-04-07' });
    // 4/1 水・2 木・3 金・4 土・5 日・6 月・7 火
    expect(serviceDates(calendar)).toEqual([
      '2026-04-01',
      '2026-04-02',
      '2026-04-03',
      '2026-04-06',
      '2026-04-07',
    ]);
  });

  it('運行なしの範囲を差し引く', () => {
    const calendar = makeCalendar({
      startDate: '2026-04-01',
      endDate: '2026-04-07',
      closedRanges: [{ from: '2026-04-02', to: '2026-04-03', note: '休講' }],
    });

    expect(serviceDates(calendar)).toEqual(['2026-04-01', '2026-04-06', '2026-04-07']);
  });

  it('**範囲が重なっても二重に引かない**', () => {
    // 「夏季休業」と「お盆」を別々に書けることが、重なりを許す理由である。
    const base = makeCalendar({
      startDate: '2026-08-01',
      endDate: '2026-08-31',
      closedRanges: [{ from: '2026-08-06', to: '2026-08-31', note: '夏季休業' }],
    });
    const overlapped = makeCalendar({
      startDate: '2026-08-01',
      endDate: '2026-08-31',
      closedRanges: [
        { from: '2026-08-06', to: '2026-08-31', note: '夏季休業' },
        { from: '2026-08-13', to: '2026-08-16', note: 'お盆' },
      ],
    });

    expect(serviceDates(overlapped)).toEqual(serviceDates(base));
  });

  it('**年をまたぐ有効期間で正しく数える**', () => {
    const calendar = makeCalendar({ startDate: '2026-12-28', endDate: '2027-01-04' });
    // 12/28 月・29 火・30 水・31 木・1/1 金・2 土・3 日・4 月
    expect(serviceDates(calendar)).toEqual([
      '2026-12-28',
      '2026-12-29',
      '2026-12-30',
      '2026-12-31',
      '2027-01-01',
      '2027-01-04',
    ]);
  });

  it('1 年分を数えても落ちない', () => {
    expect(serviceDates(makeCalendar()).length).toBeGreaterThan(200);
  });
});

describe('closedDates（GTFS の運休日）', () => {
  it('**曜日で既に外れている日は出さない**（行数が 3 倍近くになる）', () => {
    const calendar = makeCalendar({
      startDate: '2026-04-01',
      endDate: '2026-04-07',
      closedRanges: [{ from: '2026-04-01', to: '2026-04-07' }],
    });

    // 土日（4/4・4/5）は曜日で外れているため出ない。
    expect(closedDates(calendar)).toEqual([
      '2026-04-01',
      '2026-04-02',
      '2026-04-03',
      '2026-04-06',
      '2026-04-07',
    ]);
  });

  it('有効期間の外は出さない', () => {
    const calendar = makeCalendar({
      startDate: '2026-04-01',
      endDate: '2026-04-03',
      closedRanges: [{ from: '2026-03-01', to: '2026-05-31' }],
    });

    expect(closedDates(calendar)).toEqual(['2026-04-01', '2026-04-02', '2026-04-03']);
  });

  it('**走る日と運休日を足すと、曜日に当たる日の全部になる**', () => {
    const calendar = makeCalendar({
      startDate: '2026-04-01',
      endDate: '2026-04-30',
      closedRanges: [{ from: '2026-04-10', to: '2026-04-20' }],
    });

    const all = eachDate('2026-04-01', '2026-04-30').filter((d) =>
      calendar.weekdays.includes(weekdayOf(d)),
    );
    expect([...serviceDates(calendar), ...closedDates(calendar)].sort()).toEqual(all);
  });
});

describe('runsOn', () => {
  const calendar = makeCalendar({
    startDate: '2026-04-01',
    endDate: '2026-04-30',
    closedRanges: [{ from: '2026-04-10', to: '2026-04-10' }],
  });

  it('走る曜日で、運行なしでなければ走る', () => {
    expect(runsOn(calendar, '2026-04-01')).toBe(true);
  });

  it('走らない曜日は走らない', () => {
    expect(runsOn(calendar, '2026-04-04')).toBe(false);
  });

  it('運行なしの日は走らない', () => {
    expect(runsOn(calendar, '2026-04-10')).toBe(false);
  });

  it('**有効期間の外は走らない**', () => {
    expect(runsOn(calendar, '2026-03-31')).toBe(false);
    expect(runsOn(calendar, '2026-05-01')).toBe(false);
  });
});

describe('rangesOutsidePeriod（V-10 が使う）', () => {
  it('有効期間の中の範囲は返さない', () => {
    const calendar = makeCalendar({ closedRanges: [{ from: '2026-08-06', to: '2026-09-30' }] });
    expect(rangesOutsidePeriod(calendar)).toEqual([]);
  });

  it('**年を打ち間違えた範囲を返す**', () => {
    // 2027-08-06 と書くつもりで 2025-08-06 と書くと、範囲は静かに効かなくなる。
    const calendar = makeCalendar({ closedRanges: [{ from: '2025-08-06', to: '2025-09-30' }] });
    expect(rangesOutsidePeriod(calendar)).toHaveLength(1);
  });

  it('**半分だけはみ出した範囲は返さない**（学年度の変わり目では普通にある）', () => {
    const calendar = makeCalendar({ closedRanges: [{ from: '2026-03-01', to: '2026-04-05' }] });
    expect(rangesOutsidePeriod(calendar)).toEqual([]);
  });
});
