import { describe, expect, it } from 'vitest';
import {
  handlingSchema,
  networkDefSchema,
  segmentSchema,
  stopPatternSchema,
  stopSchema,
  type NetworkDef,
  type Stop,
  type StopPattern,
} from './network';
import { parseWithSchema } from './parse';

/** 仕様書 付録 A.1 に基づく停留所。 */
function makeStop(overrides: Partial<Stop> = {}): Stop {
  return {
    stopId: '1_0',
    stopName: '豊中学舎',
    shortName: '豊中',
    area: '豊中地区',
    axisPosition: 0,
    gridStyle: 'bold',
    hiddenInEditor: false,
    isDepot: false,
    ...overrides,
  };
}

/** 仕様書 付録 A.2 の S1（直行吹田）。 */
function makePattern(overrides: Partial<StopPattern> = {}): StopPattern {
  return {
    patternId: 'S1',
    patternName: '直行吹田',
    routeName: '豊中吹田線',
    directionId: 0,
    color: '#1e3a5f',
    isDefault: true,
    isDeadhead: false,
    stopSequence: [
      { stopId: '1_0', handling: 'boardOnly' },
      { stopId: '3_0', handling: 'stop' },
      { stopId: '6_0', handling: 'alightOnly' },
      { stopId: '4_0', handling: 'alightOnly' },
    ],
    ...overrides,
  };
}

describe('handlingSchema', () => {
  it('3 つの取扱区分を受け入れる（仕様書 §5.4）', () => {
    expect(handlingSchema.safeParse('stop').success).toBe(true);
    expect(handlingSchema.safeParse('boardOnly').success).toBe(true);
    expect(handlingSchema.safeParse('alightOnly').success).toBe(true);
  });

  it('「通過」は存在しない', () => {
    expect(handlingSchema.safeParse('pass').success).toBe(false);
    expect(handlingSchema.safeParse('notServiced').success).toBe(false);
  });
});

describe('stopSchema', () => {
  it('仕様書 付録 A.1 の停留所を受け入れる', () => {
    expect(stopSchema.safeParse(makeStop()).success).toBe(true);
  });

  it('千里営業所（isDepot）を受け入れる', () => {
    const depot = makeStop({
      stopId: '9_0',
      stopName: '千里営業所',
      shortName: '車庫',
      area: '',
      isDepot: true,
    });
    expect(stopSchema.safeParse(depot).success).toBe(true);
  });

  it('微生物研究所前（hiddenInEditor）を受け入れる', () => {
    const hidden = makeStop({ stopId: '6_0', stopName: '微生物研究所前', hiddenInEditor: true });
    expect(stopSchema.safeParse(hidden).success).toBe(true);
  });

  it('未知の gridStyle を拒否する', () => {
    expect(stopSchema.safeParse(makeStop({ gridStyle: 'dotted' as never })).success).toBe(false);
  });

  it('必須項目の欠落を拒否する', () => {
    const { stopName: _stopName, ...rest } = makeStop();
    expect(stopSchema.safeParse(rest).success).toBe(false);
  });

  it('空の stopName を拒否する', () => {
    expect(stopSchema.safeParse(makeStop({ stopName: '' })).success).toBe(false);
  });
});

describe('segmentSchema', () => {
  it('仕様書 付録 A.3 の区間を受け入れる', () => {
    expect(
      segmentSchema.safeParse({ fromStopId: '1_0', toStopId: '3_0', runMinutes: 25 }).success,
    ).toBe(true);
  });

  it('0 分の区間を受け入れる（微研 → 工学部前）', () => {
    expect(
      segmentSchema.safeParse({ fromStopId: '6_0', toStopId: '4_0', runMinutes: 0 }).success,
    ).toBe(true);
  });

  it('5 の倍数でない所要時間を拒否する（R-01）', () => {
    expect(
      segmentSchema.safeParse({ fromStopId: '1_0', toStopId: '3_0', runMinutes: 23 }).success,
    ).toBe(false);
  });
});

describe('stopPatternSchema', () => {
  it('仕様書 付録 A.2 の S1 を受け入れる', () => {
    expect(stopPatternSchema.safeParse(makePattern()).success).toBe(true);
  });

  it('回送パターンを受け入れる', () => {
    const deadhead = makePattern({
      patternId: 'DS-out',
      patternName: '車庫発吹田',
      routeName: '回送',
      isDefault: false,
      isDeadhead: true,
      stopSequence: [
        { stopId: '9_0', handling: 'stop' },
        { stopId: '4_0', handling: 'stop' },
      ],
    });
    expect(stopPatternSchema.safeParse(deadhead).success).toBe(true);
  });

  it('不正な色を拒否する', () => {
    expect(stopPatternSchema.safeParse(makePattern({ color: 'red' })).success).toBe(false);
  });

  it('不正な directionId を拒否する', () => {
    expect(stopPatternSchema.safeParse(makePattern({ directionId: 2 as never })).success).toBe(
      false,
    );
  });

  it('所要時間を持たない（区間表が持つ。仕様書 §5.5）', () => {
    const parsed = stopPatternSchema.parse(makePattern());
    expect(parsed.stopSequence[0]).not.toHaveProperty('runFromPrev');
    expect(parsed.stopSequence[0]).not.toHaveProperty('runMinutes');
  });
});

describe('networkDefSchema', () => {
  function makeNetwork(overrides: Partial<NetworkDef> = {}): NetworkDef {
    return {
      version: 1,
      name: '大阪大学 学内連絡バス',
      timeGrain: 300,
      stops: [makeStop()],
      segments: [{ fromStopId: '1_0', toStopId: '3_0', runMinutes: 25 }],
      patterns: [makePattern()],
      ...overrides,
    };
  }

  it('妥当なネットワーク定義を受け入れる', () => {
    expect(networkDefSchema.safeParse(makeNetwork()).success).toBe(true);
  });

  it('timeGrain が 300 以外の値を拒否する（仕様書 §2.1）', () => {
    // 型レベルでも 300 に固定されているため、実行時の検証を試すにはキャストが要る
    expect(networkDefSchema.safeParse(makeNetwork({ timeGrain: 60 as never })).success).toBe(false);
  });

  it('空の配列を受け入れる（内容の検証は T-06 が担う）', () => {
    expect(
      networkDefSchema.safeParse(makeNetwork({ stops: [], segments: [], patterns: [] })).success,
    ).toBe(true);
  });

  it('入れ子の不正箇所をパスで示す', () => {
    const broken = makeNetwork({
      segments: [
        { fromStopId: '1_0', toStopId: '3_0', runMinutes: 25 },
        { fromStopId: '1_0', toStopId: '2_0', runMinutes: 23 },
      ],
    });
    const result = parseWithSchema(networkDefSchema, broken);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.issues[0]?.path).toBe('segments[1].runMinutes');
  });
});
