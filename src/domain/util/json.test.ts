import { describe, expect, it } from 'vitest';
import { parseJson } from './json';

describe('parseJson', () => {
  it('解釈できた値を返す', () => {
    expect(parseJson('{"a":1}')).toEqual({ ok: true, value: { a: 1 } });
  });

  it('オブジェクト以外も解釈する', () => {
    // 形の検査はスキーマの仕事であり、ここでは通す。
    expect(parseJson('42')).toEqual({ ok: true, value: 42 });
    expect(parseJson('null')).toEqual({ ok: true, value: null });
  });

  it('**壊れていても例外を投げない**', () => {
    const result = parseJson('{壊れている');
    expect(result.ok).toBe(false);
  });

  it('失敗の理由をそのまま伝える', () => {
    const result = parseJson('');
    expect(result.ok).toBe(false);
    // 読めない位置や想定した字はブラウザが付ける。書き換えると情報が減る。
    if (!result.ok) expect(result.message).toContain('JSON');
  });
});
