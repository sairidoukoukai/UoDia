import { describe, expect, it } from 'vitest';
import {
  directionIdSchema,
  hexColorSchema,
  idSchema,
  isoDateTimeSchema,
  runMinutesSchema,
  secondsSchema,
} from './primitives';
import { fromHM, MAX_SECONDS } from '@/domain/time';

describe('idSchema', () => {
  it('空でない文字列を受け入れる', () => {
    expect(idSchema.safeParse('1_0').success).toBe(true);
    expect(idSchema.safeParse('S1').success).toBe(true);
    // UUID 形式を強制しない（手書きの route.json を受け付けるため）
    expect(idSchema.safeParse('550e8400-e29b-41d4-a716-446655440000').success).toBe(true);
  });

  it('空文字を拒否する', () => {
    expect(idSchema.safeParse('').success).toBe(false);
  });

  it('数値を拒否する', () => {
    expect(idSchema.safeParse(1).success).toBe(false);
  });
});

describe('secondsSchema', () => {
  it('5 分の倍数を受け入れ、Seconds に変換する', () => {
    const result = secondsSchema.safeParse(28800);
    expect(result.success).toBe(true);
    expect(result.success && result.data).toBe(fromHM(8, 0));
  });

  it('24 時超えを受け入れる（仕様書 §2.1）', () => {
    expect(secondsSchema.safeParse(91800).success).toBe(true); // 25:30
  });

  it('0 を受け入れる', () => {
    expect(secondsSchema.safeParse(0).success).toBe(true);
  });

  it('5 分の倍数でない値を拒否する', () => {
    const result = secondsSchema.safeParse(302);
    expect(result.success).toBe(false);
    expect(!result.success && result.error.issues[0]?.message).toContain('5 分');
  });

  it('負の値を拒否する', () => {
    expect(secondsSchema.safeParse(-300).success).toBe(false);
  });

  it('整数でない値を拒否する', () => {
    expect(secondsSchema.safeParse(300.5).success).toBe(false);
  });

  it('上限を超える値を拒否する', () => {
    expect(secondsSchema.safeParse(MAX_SECONDS + 300).success).toBe(false);
  });

  it('数値でない値を拒否する', () => {
    expect(secondsSchema.safeParse('28800').success).toBe(false);
  });
});

describe('runMinutesSchema', () => {
  it('5 の倍数を受け入れる（R-01）', () => {
    expect(runMinutesSchema.safeParse(0).success).toBe(true);
    expect(runMinutesSchema.safeParse(20).success).toBe(true);
    expect(runMinutesSchema.safeParse(25).success).toBe(true);
  });

  it('5 の倍数でない値を拒否する', () => {
    expect(runMinutesSchema.safeParse(7).success).toBe(false);
    expect(runMinutesSchema.safeParse(21).success).toBe(false);
  });

  it('負の値を拒否する', () => {
    expect(runMinutesSchema.safeParse(-5).success).toBe(false);
  });
});

describe('hexColorSchema', () => {
  it('#RRGGBB を受け入れる', () => {
    expect(hexColorSchema.safeParse('#1e3a5f').success).toBe(true);
    expect(hexColorSchema.safeParse('#FFD054').success).toBe(true);
  });

  it('省略形や別形式を拒否する', () => {
    expect(hexColorSchema.safeParse('#fff').success).toBe(false);
    expect(hexColorSchema.safeParse('1e3a5f').success).toBe(false);
    expect(hexColorSchema.safeParse('rgb(0,0,0)').success).toBe(false);
    expect(hexColorSchema.safeParse('#1e3a5fff').success).toBe(false);
  });
});

describe('directionIdSchema', () => {
  it('0 と 1 のみを受け入れる', () => {
    expect(directionIdSchema.safeParse(0).success).toBe(true);
    expect(directionIdSchema.safeParse(1).success).toBe(true);
    expect(directionIdSchema.safeParse(2).success).toBe(false);
    expect(directionIdSchema.safeParse(-1).success).toBe(false);
  });
});

describe('isoDateTimeSchema', () => {
  it('ISO 8601 を受け入れる', () => {
    expect(isoDateTimeSchema.safeParse('2026-07-25T10:00:00+09:00').success).toBe(true);
    expect(isoDateTimeSchema.safeParse('2026-07-25T01:00:00Z').success).toBe(true);
  });

  it('解釈できない文字列を拒否する', () => {
    expect(isoDateTimeSchema.safeParse('昨日').success).toBe(false);
    expect(isoDateTimeSchema.safeParse('').success).toBe(false);
  });
});
