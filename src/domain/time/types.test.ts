import { describe, expect, it } from 'vitest';
import {
  fromHM,
  GRAIN_SECONDS,
  MAX_SECONDS,
  roundToGrain,
  seconds,
  toHM,
  type Seconds,
} from './types';

describe('seconds', () => {
  it('5 分の倍数を受け入れる', () => {
    expect(seconds(0)).toBe(0);
    expect(seconds(300)).toBe(300);
    expect(seconds(28800)).toBe(28800); // 8:00
  });

  it('24 時を超える時刻を受け入れる（仕様書 §2.1）', () => {
    expect(seconds(91800)).toBe(91800); // 25:30
    expect(seconds(86400)).toBe(86400); // 24:00
  });

  it('上限ちょうどを受け入れる', () => {
    expect(seconds(MAX_SECONDS)).toBe(MAX_SECONDS); // 47:55
  });

  // 受入条件: seconds(302) が例外を投げる
  it('5 分の倍数でない値を拒否する', () => {
    expect(() => seconds(302)).toThrow(RangeError);
    expect(() => seconds(1)).toThrow(RangeError);
    expect(() => seconds(299)).toThrow(RangeError);
  });

  it('整数でない値を拒否する', () => {
    expect(() => seconds(300.5)).toThrow(RangeError);
    expect(() => seconds(Number.NaN)).toThrow(RangeError);
  });

  it('負の値を拒否する', () => {
    expect(() => seconds(-300)).toThrow(RangeError);
  });

  it('上限を超える値を拒否する', () => {
    expect(() => seconds(MAX_SECONDS + GRAIN_SECONDS)).toThrow(RangeError);
  });
});

describe('roundToGrain', () => {
  it('5 分単位に四捨五入する', () => {
    expect(roundToGrain(0)).toBe(0);
    expect(roundToGrain(120)).toBe(0); // 2 分 → 0 分
    expect(roundToGrain(150)).toBe(300); // 2.5 分 → 5 分（半分は切り上げ）
    expect(roundToGrain(180)).toBe(300); // 3 分 → 5 分
    expect(roundToGrain(300)).toBe(300);
  });

  it('8:32 を 8:30 に丸める（仕様書 §6.1.2 の例）', () => {
    const eightThirtyTwo = 8 * 3600 + 32 * 60;
    expect(roundToGrain(eightThirtyTwo)).toBe(8 * 3600 + 30 * 60);
  });

  it('8:33 は 8:35 に丸める', () => {
    const eightThirtyThree = 8 * 3600 + 33 * 60;
    expect(roundToGrain(eightThirtyThree)).toBe(8 * 3600 + 35 * 60);
  });

  it('有限でない値を拒否する', () => {
    expect(() => roundToGrain(Number.NaN)).toThrow(RangeError);
    expect(() => roundToGrain(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });

  it('負の値を拒否する', () => {
    expect(() => roundToGrain(-1)).toThrow(RangeError);
  });

  it('丸めた結果が上限を超える値を拒否する', () => {
    expect(() => roundToGrain(MAX_SECONDS + 3600)).toThrow(RangeError);
  });
});

describe('fromHM', () => {
  it('時・分から生成する', () => {
    expect(fromHM(8, 30)).toBe(8 * 3600 + 30 * 60);
    expect(fromHM(0, 0)).toBe(0);
    expect(fromHM(25, 30)).toBe(91800);
  });

  it('整数でない値を拒否する', () => {
    expect(() => fromHM(8.5, 30)).toThrow(RangeError);
    expect(() => fromHM(8, 30.5)).toThrow(RangeError);
  });

  it('分が範囲外の値を拒否する', () => {
    expect(() => fromHM(8, 60)).toThrow(RangeError);
    expect(() => fromHM(8, -1)).toThrow(RangeError);
  });

  it('5 分の倍数でない分を拒否する', () => {
    expect(() => fromHM(8, 31)).toThrow(RangeError);
  });
});

describe('toHM', () => {
  it('時・分に分解する', () => {
    expect(toHM(fromHM(8, 30))).toEqual({ hours: 8, minutes: 30 });
    expect(toHM(fromHM(0, 5))).toEqual({ hours: 0, minutes: 5 });
  });

  it('24 時を超える時刻をそのまま分解する', () => {
    expect(toHM(fromHM(25, 30))).toEqual({ hours: 25, minutes: 30 });
  });

  // 受入条件: 24 時超え時刻が正しく往復変換できる
  it('fromHM と toHM が往復する', () => {
    for (const [h, m] of [
      [0, 0],
      [7, 0],
      [22, 0],
      [24, 0],
      [25, 30],
      [47, 55],
    ] as const) {
      const value: Seconds = fromHM(h, m);
      expect(toHM(value)).toEqual({ hours: h, minutes: m });
    }
  });
});
