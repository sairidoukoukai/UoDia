/**
 * 上下 2 分割の寸法の検証（T-32、仕様書 §6.4）。
 *
 * ここで確かめるのは「どんな入力からも、開き直せる比率が返る」ことである。
 * 範囲を外れた比率はファイルに書けず（`viewSettingsSchema`）、書けてしまえば
 * 二度と開けないプロジェクトができる。
 */

import { describe, expect, it } from 'vitest';
import { SPLIT_RATIO_LIMITS, viewSettingsSchema } from '@/domain/model';
import {
  SPLIT_STEP,
  effectiveRatio,
  isCollapsed,
  ratioAfterKey,
  ratioAtPointer,
  ratioPercent,
  togglePane,
} from './layout';

describe('境界の引きずり', () => {
  it('掴んだ位置がそのまま比率になる', () => {
    expect(ratioAtPointer(200, 0, 400)).toBe(0.5);
    expect(ratioAtPointer(300, 100, 400)).toBe(0.5);
  });

  it('**下限と上限に収める**（どちらかを潰しきれない）', () => {
    expect(ratioAtPointer(0, 0, 400)).toBe(SPLIT_RATIO_LIMITS.min);
    expect(ratioAtPointer(400, 0, 400)).toBe(SPLIT_RATIO_LIMITS.max);
    expect(ratioAtPointer(-1000, 0, 400)).toBe(SPLIT_RATIO_LIMITS.min);
  });

  it('高さを測れないときは動かさない', () => {
    // 大きさの決まっていない画面（描画前など）では 0 が返る。0 で割ると
    // 比率が NaN になり、以降どこを掴んでも動かなくなる。
    expect(ratioAtPointer(200, 0, 0)).toBeNull();
    expect(ratioAtPointer(200, 0, Number.NaN)).toBeNull();
  });

  it('返す比率はファイルに書ける', () => {
    for (const y of [0, 1, 137, 399, 400]) {
      const ratio = ratioAtPointer(y, 0, 400);
      expect(() => viewSettingsSchema.parse({ splitRatio: ratio })).not.toThrow();
    }
  });
});

describe('キーボードで動かす', () => {
  it('上下の矢印で 1 段ずつ動く', () => {
    expect(SPLIT_STEP).toBe(0.05);
    expect(ratioAfterKey(0.6, 'ArrowDown')).toBe(0.65);
    expect(ratioAfterKey(0.6, 'ArrowUp')).toBe(0.55);
  });

  it('**足し引きの誤差を残さない**（0.55000000000000004 を書き込まない）', () => {
    expect(ratioAfterKey(0.6, 'ArrowUp')).toBe(0.55);
    expect(ratioAfterKey(0.55, 'ArrowUp')).toBe(0.5);
  });

  it('Home / End は端まで動く。**端は下限と上限であって 0 と 1 ではない**', () => {
    expect(ratioAfterKey(0.6, 'Home')).toBe(SPLIT_RATIO_LIMITS.min);
    expect(ratioAfterKey(0.6, 'End')).toBe(SPLIT_RATIO_LIMITS.max);
  });

  it('端から先へは出ない', () => {
    expect(ratioAfterKey(SPLIT_RATIO_LIMITS.min, 'ArrowUp')).toBe(SPLIT_RATIO_LIMITS.min);
    expect(ratioAfterKey(SPLIT_RATIO_LIMITS.max, 'ArrowDown')).toBe(SPLIT_RATIO_LIMITS.max);
  });

  it('動かす鍵でなければ何も返さない', () => {
    expect(ratioAfterKey(0.6, 'ArrowLeft')).toBeNull();
    expect(ratioAfterKey(0.6, 'a')).toBeNull();
  });
});

describe('最大化', () => {
  it('最大化している間は比率を上書きする', () => {
    expect(effectiveRatio(0.6, null)).toBe(0.6);
    expect(effectiveRatio(0.6, 'diagram')).toBe(1);
    expect(effectiveRatio(0.6, 'timetable')).toBe(0);
  });

  it('**保存されている比率は動かない**（押し直せば元の分割に戻る）', () => {
    const stored = 0.35;
    expect(effectiveRatio(stored, 'diagram')).toBe(1);
    expect(effectiveRatio(stored, null)).toBe(stored);
  });

  it('同じ側をもう一度指せば 2 分割へ戻る', () => {
    expect(togglePane(null, 'diagram')).toBe('diagram');
    expect(togglePane('diagram', 'diagram')).toBeNull();
    expect(togglePane('diagram', 'timetable')).toBe('timetable');
  });

  it('隠れるのは最大化していない側だけである', () => {
    expect(isCollapsed('timetable', 'diagram')).toBe(true);
    expect(isCollapsed('diagram', 'diagram')).toBe(false);
    expect(isCollapsed('diagram', null)).toBe(false);
    expect(isCollapsed('timetable', null)).toBe(false);
  });
});

describe('読み上げに出す値', () => {
  it('百分率に直す', () => {
    expect(ratioPercent(0.6)).toBe(60);
    expect(ratioPercent(0.555)).toBe(56);
  });
});
