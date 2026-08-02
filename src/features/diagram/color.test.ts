/**
 * 地色に対して読める色にする検証（T-39、仕様書 §9.4）。
 *
 * 受入条件の 1 つ「**ダークテーマでダイヤグラムが判読できる**」は、線が地色に
 * 沈まないことに掛かっている。route.json の色をそのまま出すと、直行吹田
 * （`#1a4f8a`）は暗い地色に対して明暗の比が 2.1 しかない。
 */

import { describe, expect, it } from 'vitest';
import { MIN_CONTRAST, contrastRatio, luminance, readableOn } from './color';

const LIGHT = '#ffffff';
const DARK = '#1a1a1a';

/** route.json のスジ色（付録 A.2）。 */
const PATTERN_COLORS = [
  '#1a4f8a',
  '#2e6fb5',
  '#5490cc',
  '#7fb0dd',
  '#a63a2e',
  '#c9553f',
  '#d97a63',
  '#e5a08c',
  '#8a8a8a',
];

describe('明暗の比', () => {
  it('白と黒でいちばん離れる', () => {
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 5);
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
  });

  it('順序に左右されない', () => {
    expect(contrastRatio('#1a4f8a', DARK)).toBeCloseTo(contrastRatio(DARK, '#1a4f8a'), 9);
  });

  it('読めない綴りは黒として扱う（落とさない）', () => {
    expect(luminance('まっくら')).toBe(0);
  });
});

describe('調える', () => {
  it('**足りていればそのまま返す**（データの色を勝手に動かさない）', () => {
    expect(readableOn('#1a4f8a', LIGHT)).toBe('#1a4f8a');
  });

  it('**暗い地色では明るく寄せる**', () => {
    const adjusted = readableOn('#1a4f8a', DARK);

    expect(adjusted).not.toBe('#1a4f8a');
    expect(contrastRatio(adjusted, DARK)).toBeGreaterThanOrEqual(MIN_CONTRAST);
  });

  it('明るい地色では暗く寄せる', () => {
    const adjusted = readableOn('#e5a08c', LIGHT);

    expect(contrastRatio(adjusted, LIGHT)).toBeGreaterThanOrEqual(MIN_CONTRAST);
    expect(luminance(adjusted)).toBeLessThan(luminance('#e5a08c'));
  });

  it('**route.json のどの色も、どちらの地色でも読める**（受入条件）', () => {
    for (const color of PATTERN_COLORS) {
      for (const background of [LIGHT, DARK]) {
        const adjusted = readableOn(color, background);
        expect(
          contrastRatio(adjusted, background),
          `${color} on ${background}`,
        ).toBeGreaterThanOrEqual(MIN_CONTRAST);
      }
    }
  });

  it('**寄せすぎない**（8 本が白 1 色になっては見分けられない）', () => {
    const adjusted = PATTERN_COLORS.map((color) => readableOn(color, DARK));
    expect(new Set(adjusted).size).toBe(PATTERN_COLORS.length);
  });

  it('地色そのものを渡されても止まる', () => {
    expect(contrastRatio(readableOn(DARK, DARK), DARK)).toBeGreaterThanOrEqual(MIN_CONTRAST);
    expect(readableOn('#808080', '#808080')).not.toBe('#808080');
  });
});
