import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { formatIssues, formatPath, parseWithSchema } from './parse';

describe('formatPath', () => {
  it('オブジェクトのキーをドットで繋ぐ', () => {
    expect(formatPath(['meta', 'format'])).toBe('meta.format');
  });

  it('配列の添字を角括弧にする', () => {
    expect(formatPath(['services', 0, 'trips', 3, 'anchor', 'time'])).toBe(
      'services[0].trips[3].anchor.time',
    );
  });

  it('先頭が配列の添字でも壊れない', () => {
    expect(formatPath([0, 'stopId'])).toBe('[0].stopId');
  });

  it('空のパスをルートとして表す', () => {
    expect(formatPath([])).toBe('(ルート)');
  });

  it('symbol キーを文字列化する', () => {
    expect(formatPath([Symbol('x')])).toContain('Symbol');
  });
});

describe('parseWithSchema', () => {
  const schema = z.object({
    name: z.string().min(1),
    items: z.array(z.object({ value: z.number().int() })),
  });

  it('成功時は値を返す', () => {
    const result = parseWithSchema(schema, { name: 'a', items: [{ value: 1 }] });
    expect(result.ok).toBe(true);
    expect(result.ok && result.value.name).toBe('a');
  });

  it('失敗時は例外を投げずに問題の一覧を返す', () => {
    expect(() => parseWithSchema(schema, { name: '', items: 'x' })).not.toThrow();
    const result = parseWithSchema(schema, { name: '', items: 'x' });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.issues.length).toBeGreaterThan(0);
  });

  it('問題にパスとメッセージを含める', () => {
    const result = parseWithSchema(schema, { name: 'a', items: [{ value: 1.5 }] });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues[0]?.path).toBe('items[0].value');
      expect(result.issues[0]?.message).toBeTruthy();
    }
  });

  it('複数の問題をすべて返す', () => {
    const result = parseWithSchema(schema, { name: '', items: [{ value: 1.5 }] });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.issues.length).toBe(2);
  });
});

describe('formatIssues', () => {
  it('1 行 1 件で整形する', () => {
    expect(
      formatIssues([
        { path: 'meta.format', message: '不正です' },
        { path: 'services[0].trips[1].anchor.time', message: '5 分の倍数ではありません' },
      ]),
    ).toBe('meta.format: 不正です\nservices[0].trips[1].anchor.time: 5 分の倍数ではありません');
  });

  it('空の一覧は空文字になる', () => {
    expect(formatIssues([])).toBe('');
  });
});
