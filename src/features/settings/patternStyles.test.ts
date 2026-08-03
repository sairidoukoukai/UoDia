/**
 * パターンの色と線種の上書きの検証（#147）。
 *
 * 確かめたいのは 3 つ。**色と線種が独立に動く**こと、**やめられる**こと、
 * そして**変わらないときに新しい表を作らない**ことである。最後の 1 つは設定
 * ファイルへの書き込みが走るかどうかを決める（`watchSettings`）。
 */

import { describe, expect, it } from 'vitest';
import { NO_PATTERN_STYLES } from '@/store';
import {
  clearedPatternStyles,
  patternStyleCount,
  withPatternStyle,
  withoutPatternStyle,
  type PatternStyleChoices,
} from './patternStyles';

const NONE: PatternStyleChoices = NO_PATTERN_STYLES;

describe('色と線種は独立している', () => {
  it('色だけ選べる', () => {
    expect(withPatternStyle(NONE, 'S1', { color: '#ff0000' })).toEqual({
      S1: { color: '#ff0000' },
    });
  });

  it('線種だけ選べる', () => {
    expect(withPatternStyle(NONE, 'S1', { dash: 'dashDot' })).toEqual({
      S1: { dash: 'dashDot' },
    });
  });

  it('**片方を変えても、もう片方は残る**', () => {
    const withColor = withPatternStyle(NONE, 'S1', { color: '#ff0000' });
    const both = withPatternStyle(withColor, 'S1', { dash: 'solid' });

    expect(both).toEqual({ S1: { color: '#ff0000', dash: 'solid' } });
  });

  it('**片方だけやめられる**（色を戻しても線種は残る）', () => {
    const both = withPatternStyle(withPatternStyle(NONE, 'S1', { color: '#ff0000' }), 'S1', {
      dash: 'solid',
    });

    expect(withPatternStyle(both, 'S1', { color: null })).toEqual({ S1: { dash: 'solid' } });
  });

  it('ほかのパターンは残る', () => {
    const first = withPatternStyle(NONE, 'S1', { color: '#ff0000' });

    expect(withPatternStyle(first, 'T1', { dash: 'dashed' })).toEqual({
      S1: { color: '#ff0000' },
      T1: { dash: 'dashed' },
    });
  });
});

describe('やめる', () => {
  it('**両方やめると行ごと落ちる**（「選んでいない」と「選んで既定と同じ」を混ぜない）', () => {
    const both = withPatternStyle(withPatternStyle(NONE, 'S1', { color: '#ff0000' }), 'S1', {
      dash: 'solid',
    });

    expect(withoutPatternStyle(both, 'S1')).toBe(NO_PATTERN_STYLES);
  });

  it('そのパターンだけやめる', () => {
    const two = withPatternStyle(withPatternStyle(NONE, 'S1', { color: '#f00' }), 'T1', {
      dash: 'dashed',
    });

    expect(withoutPatternStyle(two, 'S1')).toEqual({ T1: { dash: 'dashed' } });
  });

  it('全部やめる', () => {
    expect(clearedPatternStyles({ S1: { color: '#f00' } })).toBe(NO_PATTERN_STYLES);
  });
});

describe('変わらないとき', () => {
  it('**同じ色を選び直しても同じ参照を返す**（書き込みを起こさない）', () => {
    const choices: PatternStyleChoices = { S1: { color: '#ff0000' } };

    expect(withPatternStyle(choices, 'S1', { color: '#ff0000' })).toBe(choices);
  });

  it('上書きの無いパターンをやめても同じ参照を返す', () => {
    const choices: PatternStyleChoices = { S1: { color: '#ff0000' } };

    expect(withoutPatternStyle(choices, 'T1')).toBe(choices);
  });

  it('何も無いところを全部やめても同じ参照を返す', () => {
    expect(clearedPatternStyles(NONE)).toBe(NONE);
  });
});

describe('数える', () => {
  it('上書きしているパターンの数を返す', () => {
    expect(patternStyleCount(NONE)).toBe(0);
    expect(patternStyleCount({ S1: { color: '#f00' }, T1: { dash: 'dashed' } })).toBe(2);
  });
});
