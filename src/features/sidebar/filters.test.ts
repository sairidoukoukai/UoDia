/**
 * 表示フィルタの持ち方の検証（T-33、仕様書 §6.2.4）。
 */

import { describe, expect, it } from 'vitest';
import { allHidden, isHidden, withHidden } from './filters';

describe('隠す一覧の出し入れ', () => {
  it('隠す・見せるで一覧が変わる', () => {
    expect(withHidden([], 'S1', false)).toEqual(['S1']);
    expect(withHidden(['S1', 'T1'], 'S1', true)).toEqual(['T1']);
  });

  it('**変わらないなら同じ参照を返す**（履歴に空の 1 段を積まない）', () => {
    const hidden = ['S1'];
    expect(withHidden(hidden, 'S1', false)).toBe(hidden);
    expect(withHidden(hidden, 'T1', true)).toBe(hidden);
  });

  it('数の一覧でも同じように働く（方向）', () => {
    expect(withHidden<number>([], 1, false)).toEqual([1]);
    expect(withHidden([0, 1], 1, true)).toEqual([0]);
  });

  it('隠れているかを見られる', () => {
    expect(isHidden(['S1'], 'S1')).toBe(true);
    expect(isHidden(['S1'], 'T1')).toBe(false);
  });

  it('まとめて隠す・まとめて見せる', () => {
    expect(allHidden(['S1', 'T1'], false)).toEqual(['S1', 'T1']);
    expect(allHidden(['S1', 'T1'], true)).toEqual([]);
  });
});
