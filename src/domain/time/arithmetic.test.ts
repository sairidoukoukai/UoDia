import { describe, expect, it } from 'vitest';
import { addMinutes, compareTime, diffMinutes, isBeforeOrEqual } from './arithmetic';
import { fromHM } from './types';

describe('addMinutes', () => {
  it('分を加算する', () => {
    expect(addMinutes(fromHM(8, 30), 15)).toBe(fromHM(8, 45));
    expect(addMinutes(fromHM(8, 30), 30)).toBe(fromHM(9, 0));
  });

  it('負の分で減算する', () => {
    expect(addMinutes(fromHM(8, 30), -15)).toBe(fromHM(8, 15));
  });

  it('0 を加算しても変わらない', () => {
    expect(addMinutes(fromHM(8, 30), 0)).toBe(fromHM(8, 30));
  });

  it('24 時をまたいで加算できる', () => {
    expect(addMinutes(fromHM(23, 50), 30)).toBe(fromHM(24, 20));
  });

  it('5 の倍数でない分を拒否する', () => {
    expect(() => addMinutes(fromHM(8, 30), 1)).toThrow(RangeError);
    expect(() => addMinutes(fromHM(8, 30), 7)).toThrow(RangeError);
  });

  it('整数でない分を拒否する', () => {
    expect(() => addMinutes(fromHM(8, 30), 5.5)).toThrow(RangeError);
  });

  it('結果が負になる減算を拒否する', () => {
    expect(() => addMinutes(fromHM(0, 5), -10)).toThrow(RangeError);
  });

  it('結果が上限を超える加算を拒否する', () => {
    expect(() => addMinutes(fromHM(47, 55), 5)).toThrow(RangeError);
  });
});

describe('diffMinutes', () => {
  it('差を分で返す', () => {
    expect(diffMinutes(fromHM(9, 0), fromHM(8, 30))).toBe(30);
  });

  it('負の差を返せる（折返し時分が負のケース。仕様書 §2.2 / V-02）', () => {
    expect(diffMinutes(fromHM(8, 30), fromHM(9, 0))).toBe(-30);
  });

  it('同時刻なら 0 を返す（折返し時分 0 分は正常値）', () => {
    expect(diffMinutes(fromHM(8, 30), fromHM(8, 30))).toBe(0);
  });

  it('24 時をまたぐ差を計算できる', () => {
    expect(diffMinutes(fromHM(24, 10), fromHM(23, 50))).toBe(20);
  });

  it('仕様書 §2.2 の例: 8:55 着と 9:05 発の停車時分は 10 分', () => {
    expect(diffMinutes(fromHM(9, 5), fromHM(8, 55))).toBe(10);
  });
});

describe('isBeforeOrEqual', () => {
  it('前後関係を判定する', () => {
    expect(isBeforeOrEqual(fromHM(8, 30), fromHM(9, 0))).toBe(true);
    expect(isBeforeOrEqual(fromHM(9, 0), fromHM(8, 30))).toBe(false);
  });

  it('同時刻は true（折返し時分の下限が 0 分であるため）', () => {
    expect(isBeforeOrEqual(fromHM(8, 30), fromHM(8, 30))).toBe(true);
  });
});

describe('compareTime', () => {
  it('昇順に並べ替えられる', () => {
    const times = [fromHM(9, 0), fromHM(7, 30), fromHM(25, 30), fromHM(8, 15)];
    expect([...times].sort(compareTime)).toEqual([
      fromHM(7, 30),
      fromHM(8, 15),
      fromHM(9, 0),
      fromHM(25, 30),
    ]);
  });
});
