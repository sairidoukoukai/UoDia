import { describe, expect, it } from 'vitest';
import { assignBlockColors, BLOCK_COLORS, blockColorAt } from './colors';

describe('blockColorAt', () => {
  it('位置に対応する色を返す', () => {
    expect(blockColorAt(0)).toBe(BLOCK_COLORS[0]);
    expect(blockColorAt(3)).toBe(BLOCK_COLORS[3]);
  });

  it('色数を超えると先頭から巡回する', () => {
    expect(blockColorAt(BLOCK_COLORS.length)).toBe(blockColorAt(0));
    expect(blockColorAt(BLOCK_COLORS.length + 2)).toBe(blockColorAt(2));
  });

  it('負の位置は受け付けない', () => {
    expect(() => blockColorAt(-1)).toThrow(RangeError);
  });

  it('整数でない位置は受け付けない', () => {
    expect(() => blockColorAt(1.5)).toThrow(RangeError);
  });

  it('配色を差し替えられる', () => {
    expect(blockColorAt(1, ['#111111', '#222222'])).toBe('#222222');
  });

  it('空の配色には黒を返す', () => {
    expect(blockColorAt(0, [])).toBe('#000000');
  });
});

describe('BLOCK_COLORS', () => {
  it('重複が無い', () => {
    expect(new Set(BLOCK_COLORS).size).toBe(BLOCK_COLORS.length);
  });

  it('すべて #rrggbb 形式', () => {
    for (const color of BLOCK_COLORS) {
      expect(color).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});

describe('assignBlockColors', () => {
  it('運用番号の昇順に色を割り当てる', () => {
    const colors = assignBlockColors(['2', '1', '3']);
    expect(colors.get('1')).toBe(blockColorAt(0));
    expect(colors.get('2')).toBe(blockColorAt(1));
    expect(colors.get('3')).toBe(blockColorAt(2));
  });

  it('渡す順序を変えても同じ色になる', () => {
    expect([...assignBlockColors(['A', 'B'])]).toEqual([...assignBlockColors(['B', 'A'])]);
  });

  it('重複した運用番号はまとめる', () => {
    expect(assignBlockColors(['1', '1', '2']).size).toBe(2);
  });

  it('運用が無ければ空', () => {
    expect(assignBlockColors([]).size).toBe(0);
  });

  it('配色を差し替えられる', () => {
    expect(assignBlockColors(['1'], ['#abcdef']).get('1')).toBe('#abcdef');
  });
});
