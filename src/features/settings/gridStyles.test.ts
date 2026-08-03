/**
 * 停留所の線種の上書きの検証（#133、仕様書 §6.5.3）。
 *
 * 確かめたいのは 3 つ。**上書きしていない停留所には触れない**こと、**やめられる**
 * こと、そして**変わらないときに新しい表を作らない**ことである。最後の 1 つは
 * 設定ファイルへの書き込みが走るかどうかを決める（`watchSettings`）。
 */

import { describe, expect, it } from 'vitest';
import { NO_GRID_STYLE_OVERRIDES } from '@/store';
import {
  clearedGridStyles,
  overrideCount,
  withGridStyleOverride,
  type GridStyleOverrides,
} from './gridStyles';

const NONE: GridStyleOverrides = NO_GRID_STYLE_OVERRIDES;

describe('上書きを足す', () => {
  it('選んだ停留所だけが入る', () => {
    const next = withGridStyleOverride(NONE, '1_0', 'dashed');

    expect(next).toEqual({ '1_0': 'dashed' });
  });

  it('**ほかの停留所は残る**（1 つ選んで他が消えては使えない）', () => {
    const next = withGridStyleOverride({ '1_0': 'dashed' }, '2_0', 'bold');

    expect(next).toEqual({ '1_0': 'dashed', '2_0': 'bold' });
  });

  it('選び直すと置き換わる', () => {
    const next = withGridStyleOverride({ '1_0': 'dashed' }, '1_0', 'bold');

    expect(next).toEqual({ '1_0': 'bold' });
  });
});

describe('上書きをやめる', () => {
  it('`null` で表から落ちる（route.json の値に戻る）', () => {
    const next = withGridStyleOverride({ '1_0': 'dashed', '2_0': 'bold' }, '1_0', null);

    expect(next).toEqual({ '2_0': 'bold' });
  });

  it('**最後の 1 つを外すと空の表の同じ参照に戻る**（記憶化の鍵になる）', () => {
    const next = withGridStyleOverride({ '1_0': 'dashed' }, '1_0', null);

    expect(next).toBe(NO_GRID_STYLE_OVERRIDES);
  });

  it('全部やめる', () => {
    expect(clearedGridStyles({ '1_0': 'dashed', '2_0': 'bold' })).toBe(NO_GRID_STYLE_OVERRIDES);
  });
});

describe('変わらないとき', () => {
  it('**同じ線種を選び直しても同じ参照を返す**（書き込みを起こさない）', () => {
    const overrides: GridStyleOverrides = { '1_0': 'dashed' };

    expect(withGridStyleOverride(overrides, '1_0', 'dashed')).toBe(overrides);
  });

  it('上書きの無い停留所に「路線図のまま」を選んでも同じ参照を返す', () => {
    const overrides: GridStyleOverrides = { '1_0': 'dashed' };

    expect(withGridStyleOverride(overrides, '2_0', null)).toBe(overrides);
  });

  it('何も無いところを全部やめても同じ参照を返す', () => {
    expect(clearedGridStyles(NONE)).toBe(NONE);
  });
});

describe('数える', () => {
  it('上書きしている停留所の数を返す', () => {
    expect(overrideCount(NONE)).toBe(0);
    expect(overrideCount({ '1_0': 'dashed', '2_0': 'bold' })).toBe(2);
  });
});
