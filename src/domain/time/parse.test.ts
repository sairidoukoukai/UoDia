import { describe, expect, it } from 'vitest';
import { parseTimeInput } from './parse';
import { fromHM } from './types';

/** 解析に成功し、指定の時刻になることを確認する。 */
function expectTime(input: string, hours: number, minutes: number, prev?: string): void {
  const prevTime = prev === undefined ? undefined : parseTimeInput(prev)?.value;
  const result = parseTimeInput(input, prevTime);
  expect(result, `"${input}" の解析に失敗した`).not.toBeNull();
  expect(result?.value).toBe(fromHM(hours, minutes));
}

describe('parseTimeInput — 仕様書 §6.1.2 の入力パターン', () => {
  it('`830` を 8:30 と解釈する', () => {
    expectTime('830', 8, 30);
  });

  it('`8:30` を 8:30 と解釈する', () => {
    expectTime('8:30', 8, 30);
  });

  it('`2530` を 25:30 と解釈する（24 時超え）', () => {
    expectTime('2530', 25, 30);
  });

  it('4 桁で 0 埋めされた `0830` を 8:30 と解釈する', () => {
    expectTime('0830', 8, 30);
  });

  it('`25:30` をコロン付きでも解釈する', () => {
    expectTime('25:30', 25, 30);
  });
});

describe('parseTimeInput — 分のみの入力', () => {
  it('直前の便より分が大きければ同じ時になる', () => {
    // 直前 8:30 → `45` は 8:45
    expectTime('45', 8, 45, '830');
  });

  it('直前の便より分が小さければ +1 時間する', () => {
    // 直前 8:30 → `15` は 9:15
    expectTime('15', 9, 15, '830');
  });

  it('直前の便と分が同じなら +1 時間する', () => {
    // 直前 8:30 → `30` は 9:30
    expectTime('30', 9, 30, '830');
  });

  it('1 桁でも解釈する', () => {
    // 直前 8:30 → `5` は 9:05
    expectTime('5', 9, 5, '830');
  });

  it('日をまたぐ補完ができる', () => {
    // 直前 23:50 → `10` は 24:10
    expectTime('10', 24, 10, '2350');
  });

  it('直前の便が無ければ解釈できない', () => {
    expect(parseTimeInput('45')).toBeNull();
  });

  it('分が 60 以上なら解釈できない', () => {
    expect(parseTimeInput('60', fromHM(8, 30))).toBeNull();
    expect(parseTimeInput('99', fromHM(8, 30))).toBeNull();
  });
});

describe('parseTimeInput — 5 分丸め', () => {
  it('8:32 は 8:30 に丸められ、rounded が立つ', () => {
    const result = parseTimeInput('832');
    expect(result?.value).toBe(fromHM(8, 30));
    expect(result?.rounded).toBe(true);
  });

  it('8:33 は 8:35 に丸められる', () => {
    const result = parseTimeInput('833');
    expect(result?.value).toBe(fromHM(8, 35));
    expect(result?.rounded).toBe(true);
  });

  it('もともと 5 分刻みなら rounded は立たない', () => {
    const result = parseTimeInput('830');
    expect(result?.value).toBe(fromHM(8, 30));
    expect(result?.rounded).toBe(false);
  });
});

describe('parseTimeInput — 全角と空白の正規化', () => {
  it('全角数字を受け付ける', () => {
    expectTime('８３０', 8, 30);
  });

  it('全角コロンを受け付ける', () => {
    expectTime('8：30', 8, 30);
  });

  it('前後の空白を無視する', () => {
    expectTime('  830  ', 8, 30);
  });

  it('全角空白を無視する', () => {
    expectTime('　8　:　30', 8, 30);
  });
});

describe('parseTimeInput — 境界値', () => {
  it('`0` は直前の便が無ければ解釈できない', () => {
    expect(parseTimeInput('0')).toBeNull();
  });

  it('`000` を 0:00 と解釈する', () => {
    expectTime('000', 0, 0);
  });

  it('`2400` を 24:00 と解釈する', () => {
    expectTime('2400', 24, 0);
  });

  it('上限の 47:55 を解釈する', () => {
    expectTime('4755', 47, 55);
  });

  it('上限を超える時は解釈できない', () => {
    expect(parseTimeInput('4800')).toBeNull();
    expect(parseTimeInput('99:00')).toBeNull();
  });
});

describe('parseTimeInput — 不正な入力', () => {
  it.each([
    ['空文字', ''],
    ['空白のみ', '   '],
    ['英字', 'abc'],
    ['記号のみ', '::'],
    ['5 桁以上', '12345'],
    ['分が 60 以上', '870'],
    ['コロンの左が空', ':30'],
    ['コロンの右が空', '8:'],
    ['コロンの右が非数字', '8:ab'],
    ['コロンの左が非数字', 'ab:30'],
    ['負号付き', '-830'],
    ['小数点付き', '8.30'],
  ])('%s (%j) は null を返す', (_label, input) => {
    expect(parseTimeInput(input, fromHM(8, 30))).toBeNull();
  });

  it('例外を投げない', () => {
    expect(() => parseTimeInput('!!!!!!!')).not.toThrow();
  });
});
