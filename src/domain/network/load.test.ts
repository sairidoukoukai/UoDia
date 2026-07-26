import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadNetworkDef } from './load';

const routeJsonPath = fileURLToPath(new URL('../../../data/route.json', import.meta.url));
const validJson = readFileSync(routeJsonPath, 'utf8');

describe('loadNetworkDef — 正常系', () => {
  // 受入条件: 正常な route.json（T-05）が検証を通過する
  it('data/route.json を読み込める', () => {
    const result = loadNetworkDef(validJson);
    expect(result.ok, result.ok ? '' : JSON.stringify(result, null, 2)).toBe(true);
  });

  it('読み込んだ内容が仕様書 付録 A と一致する', () => {
    const result = loadNetworkDef(validJson);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.network.def.stops).toHaveLength(7);
    expect(result.network.def.segments).toHaveLength(15);
    expect(result.network.def.patterns).toHaveLength(14);
    expect(result.network.def.timeGrain).toBe(300);
  });
});

describe('loadNetworkDef — 失敗した段階を区別する', () => {
  it('JSON として壊れていれば stage: json', () => {
    const result = loadNetworkDef('{ これは JSON ではない');
    expect(result.ok).toBe(false);
    expect(!result.ok && result.stage).toBe('json');
  });

  it('JSON の構文エラーの内容を伝える', () => {
    const result = loadNetworkDef('{');
    expect(!result.ok && result.stage === 'json' && result.message.length).toBeGreaterThan(0);
  });

  it('形が違えば stage: schema', () => {
    const result = loadNetworkDef(JSON.stringify({ version: 1 }));
    expect(result.ok).toBe(false);
    expect(!result.ok && result.stage).toBe('schema');
  });

  it('スキーマ違反の箇所をパスで示す', () => {
    const broken = JSON.parse(validJson) as { segments: { runMinutes: number }[] };
    const segment = broken.segments[0];
    if (!segment) throw new Error('テストデータが壊れています');
    segment.runMinutes = 23;
    const result = loadNetworkDef(JSON.stringify(broken));
    expect(!result.ok && result.stage).toBe('schema');
    expect(!result.ok && result.stage === 'schema' && result.issues[0]?.path).toBe(
      'segments[0].runMinutes',
    );
  });

  it('内容が矛盾していれば stage: rules', () => {
    const broken = JSON.parse(validJson) as { segments: unknown[] };
    // 区間を 1 つ消すと、それを使うパターンが R-03 に違反する
    broken.segments = broken.segments.slice(1);
    const result = loadNetworkDef(JSON.stringify(broken));
    expect(result.ok).toBe(false);
    expect(!result.ok && result.stage).toBe('rules');
    expect(
      !result.ok && result.stage === 'rules' && result.issues.some((i) => i.rule === 'R-03'),
    ).toBe(true);
  });

  it('スキーマ違反があれば規則の検証まで進まない', () => {
    // 形が違ううえに内容も矛盾しているデータ
    const result = loadNetworkDef(JSON.stringify({ version: 'いち' }));
    expect(!result.ok && result.stage).toBe('schema');
  });
});

describe('loadNetworkDef — 例外を投げない', () => {
  it.each([
    ['空文字', ''],
    ['null', 'null'],
    ['配列', '[]'],
    ['数値', '42'],
    ['文字列', '"route"'],
    ['途中で切れた JSON', '{"version": 1, "stops": ['],
  ])('%s を渡しても例外にならない', (_label, input) => {
    expect(() => loadNetworkDef(input)).not.toThrow();
    expect(loadNetworkDef(input).ok).toBe(false);
  });
});
