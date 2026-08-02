// @vitest-environment jsdom

/**
 * テーマの検証（T-39、仕様書 §6.5.3、§9.4）。
 *
 * **色の値は 1 つも確かめない。** 配色は CSS が持ち、ここがするのは「どの配色を
 * 使うか」を根の要素に立てることだけである。
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { applyTheme, resolveTheme } from './theme';

let root: HTMLElement;

beforeEach(() => {
  root = document.createElement('html');
});

describe('実際に使う配色', () => {
  it('選んだテーマが OS より優先される', () => {
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });

  it('**システムに従うときだけ OS を見る**', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
  });
});

describe('根の要素に立てる', () => {
  it('選んだテーマを属性で示す', () => {
    applyTheme('dark', root);
    expect(root.dataset.theme).toBe('dark');

    applyTheme('light', root);
    expect(root.dataset.theme).toBe('light');
  });

  it('**システムに従うときは属性を外す**（外さないと OS の変化に追随しない）', () => {
    applyTheme('dark', root);
    applyTheme('system', root);

    expect(root.hasAttribute('data-theme')).toBe(false);
  });
});
