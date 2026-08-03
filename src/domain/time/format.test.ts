import { describe, expect, it } from 'vitest';
import { formatMinutesSigned, formatTime, formatTimePadded } from './format';
import { fromHM } from './types';

describe('formatTime', () => {
  it('H:MM 形式で整形する', () => {
    expect(formatTime(fromHM(8, 30))).toBe('8:30');
    expect(formatTime(fromHM(8, 5))).toBe('8:05');
    expect(formatTime(fromHM(0, 0))).toBe('0:00');
  });

  it('24 時を超える時刻をそのまま表示する（仕様書 §2.1）', () => {
    expect(formatTime(fromHM(24, 0))).toBe('24:00');
    expect(formatTime(fromHM(25, 30))).toBe('25:30');
  });

  it('時を 0 埋めしない', () => {
    expect(formatTime(fromHM(7, 0))).toBe('7:00');
  });
});

describe('formatTimePadded', () => {
  it('HH:MM 形式で桁をそろえる', () => {
    expect(formatTimePadded(fromHM(8, 30))).toBe('08:30');
    expect(formatTimePadded(fromHM(0, 5))).toBe('00:05');
    expect(formatTimePadded(fromHM(25, 30))).toBe('25:30');
  });
});

describe('formatMinutesSigned', () => {
  it('正の値に + を付ける', () => {
    expect(formatMinutesSigned(15)).toBe('+15 分');
  });

  it('負の値はそのまま表示する', () => {
    expect(formatMinutesSigned(-15)).toBe('-15 分');
  });

  it('0 には符号を付けない', () => {
    expect(formatMinutesSigned(0)).toBe('0 分');
  });
});

describe('往復変換', () => {
  // 受入条件: 24 時超え時刻が正しく往復変換できる
  it('formatTime の結果が元の時刻を表す', () => {
    for (const [h, m] of [
      [0, 0],
      [7, 0],
      [8, 30],
      [22, 0],
      [24, 0],
      [25, 30],
      [47, 55],
    ] as const) {
      expect(formatTime(fromHM(h, m))).toBe(`${String(h)}:${String(m).padStart(2, '0')}`);
    }
  });
});
