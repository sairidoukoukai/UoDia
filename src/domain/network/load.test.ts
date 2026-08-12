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
    expect(result.network.def.patterns).toHaveLength(16);
    expect(result.network.def.timeGrain).toBe(300);
  });
});

describe('取扱区分（#202、T-83）', () => {
  /*
   * **片方向のパターンにしか現れない停留所は、乗降のどちらかしか起きない。**
   *
   * | 停留所 | 出るパターン | 取扱区分 |
   * | --- | --- | --- |
   * | コンベンションセンター前 | S1・S2・S3（すべて吹田方面） | **降車専用** |
   * | 人間科学部前 | T1・T3・M4（すべて豊中方面） | **乗車専用** |
   *
   * ここが `stop` のままだと、**乗れない停留所が乗れるものとして GTFS に
   * 配信される**（仕様書 v2 §6.5.5）。経路検索が「コンベンションセンター前から
   * 吹田方面へ乗る」という案内を出しうる。
   */
  function handlingOf(patternId: string, stopId: string): string | undefined {
    const result = loadNetworkDef(validJson);
    if (!result.ok) throw new Error('route.json を読み込めません');
    const pattern = result.network.def.patterns.find((entry) => entry.patternId === patternId);
    return pattern?.stopSequence.find((stop) => stop.stopId === stopId)?.handling;
  }

  it('**コンベンションセンター前は降車専用**', () => {
    for (const patternId of ['S1', 'S2', 'S3']) {
      expect(handlingOf(patternId, '3_0'), patternId).toBe('alightOnly');
    }
  });

  it('**人間科学部前は乗車専用**', () => {
    for (const patternId of ['T1', 'T3', 'M4']) {
      expect(handlingOf(patternId, '5_0'), patternId).toBe('boardOnly');
    }
  });

  it('微生物研究所前は降車専用のまま（もともと正しかった）', () => {
    expect(handlingOf('S3', '6_0')).toBe('alightOnly');
  });

  it('**両方向に出る停留所は乗降とも**（直した先を広げすぎていない）', () => {
    expect(handlingOf('S3', '2_0')).toBe('stop');
    expect(handlingOf('T3', '2_0')).toBe('stop');
  });

  it('**版数 4 である**（#247 で停留所間の回送を足した）', () => {
    const result = loadNetworkDef(validJson);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 版数 3 は T-83 の値の訂正までであり、形は変わっていなかった。版数 4 は
    // 系統に `isDeadhead` を足しているため、形が変わっている。
    expect(result.network.def.version).toBe(4);
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
