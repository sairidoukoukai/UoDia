import { describe, expect, it } from 'vitest';
import type { NetworkDef, Segment, StopPattern } from '@/domain/model';
import { formatNetworkIssues, segmentKey, validateNetwork, type NetworkRule } from './validate';

/**
 * 検証を通過する最小のネットワーク。
 *
 * 停留所 A → B（営業・両方向）と、その 4 つの端すべてに繋がる入出庫を持つ
 * （R-11）。各規則の違反テストは
 * これを 1 箇所だけ壊して行う。壊す前が通ることを最初に確かめておくことで、
 * 「別の理由で失敗した」という誤検出を避ける。
 */
function makeValidNetwork(): NetworkDef {
  return {
    version: 1,
    name: 'テスト用',
    timeGrain: 300,
    stops: [
      {
        stopId: 'A',
        stopName: 'A停留所',
        shortName: 'A',
        area: '',
        axisPosition: 0,
        gridStyle: 'normal',
        hiddenInEditor: false,
        isDepot: false,
      },
      {
        stopId: 'B',
        stopName: 'B停留所',
        shortName: 'B',
        area: '',
        axisPosition: 10,
        gridStyle: 'normal',
        hiddenInEditor: false,
        isDepot: false,
      },
      {
        stopId: 'D',
        stopName: '営業所',
        shortName: '車庫',
        area: '',
        axisPosition: 20,
        gridStyle: 'dashed',
        hiddenInEditor: false,
        isDepot: true,
      },
    ],
    segments: [
      { fromStopId: 'A', toStopId: 'B', runMinutes: 10 },
      { fromStopId: 'B', toStopId: 'A', runMinutes: 10 },
      { fromStopId: 'D', toStopId: 'A', runMinutes: 5 },
      { fromStopId: 'B', toStopId: 'D', runMinutes: 5 },
      { fromStopId: 'D', toStopId: 'B', runMinutes: 5 },
      { fromStopId: 'A', toStopId: 'D', runMinutes: 5 },
    ],
    patterns: [
      makePattern({ patternId: 'P0', directionId: 0, isDefault: true, stops: ['A', 'B'] }),
      makePattern({ patternId: 'P1', directionId: 1, isDefault: true, stops: ['B', 'A'] }),
      makePattern({
        patternId: 'OUT',
        directionId: 0,
        isDefault: false,
        isDeadhead: true,
        stops: ['D', 'A'],
      }),
      makePattern({
        patternId: 'IN',
        directionId: 1,
        isDefault: false,
        isDeadhead: true,
        stops: ['B', 'D'],
      }),
      // 逆方向（P1）の出入庫。R-11 はどちらの向きにも回送を要求する。
      makePattern({
        patternId: 'OUT-B',
        directionId: 1,
        isDefault: false,
        isDeadhead: true,
        stops: ['D', 'B'],
      }),
      makePattern({
        patternId: 'IN-A',
        directionId: 0,
        isDefault: false,
        isDeadhead: true,
        stops: ['A', 'D'],
      }),
    ],
  };
}

function makePattern(options: {
  patternId: string;
  directionId: 0 | 1;
  isDefault: boolean;
  isDeadhead?: boolean;
  stops: readonly string[];
}): StopPattern {
  const isDeadhead = options.isDeadhead ?? false;

  return {
    patternId: options.patternId,
    patternName: options.patternId,
    routeName: 'テスト線',
    directionId: options.directionId,
    color: '#123456',
    isDefault: options.isDefault,
    isDeadhead,
    // 営業パターンは各駅・通過の別を持つ（R-12）。回送は持たない。
    ...(isDeadhead ? {} : { serviceType: 'local' as const }),
    stopSequence: options.stops.map((stopId, index) => ({
      stopId,
      handling:
        index === 0 ? 'boardOnly' : index === options.stops.length - 1 ? 'alightOnly' : 'stop',
    })),
  };
}

/** 検出された規則の一覧。 */
function rulesOf(network: NetworkDef): NetworkRule[] {
  return validateNetwork(network).map((i) => i.rule);
}

describe('validateNetwork — 正常系', () => {
  it('妥当なネットワークでは問題を返さない', () => {
    expect(validateNetwork(makeValidNetwork())).toEqual([]);
  });
});

describe('validateNetwork — R-01: 所要時間が 5 の倍数', () => {
  it('5 の倍数でない区間を検出する', () => {
    const network = makeValidNetwork();
    network.segments[0] = { fromStopId: 'A', toStopId: 'B', runMinutes: 7 };
    expect(rulesOf(network)).toContain('R-01');
  });

  it('対象として区間を指す', () => {
    const network = makeValidNetwork();
    network.segments[0] = { fromStopId: 'A', toStopId: 'B', runMinutes: 7 };
    const issue = validateNetwork(network).find((i) => i.rule === 'R-01');
    expect(issue?.target).toEqual({ kind: 'segment', fromStopId: 'A', toStopId: 'B' });
  });

  it('0 分は 5 の倍数として扱う（微研 → 工学部前）', () => {
    const network = makeValidNetwork();
    network.segments[0] = { fromStopId: 'A', toStopId: 'B', runMinutes: 0 };
    expect(rulesOf(network)).not.toContain('R-01');
  });
});

describe('validateNetwork — R-02: 停留所参照の実在', () => {
  it('パターンが存在しない停留所を参照していると検出する', () => {
    const network = makeValidNetwork();
    network.patterns[0] = makePattern({
      patternId: 'P0',
      directionId: 0,
      isDefault: true,
      stops: ['A', 'X'],
    });
    expect(rulesOf(network)).toContain('R-02');
  });

  it('区間が存在しない停留所を参照していると検出する', () => {
    const network = makeValidNetwork();
    network.segments.push({ fromStopId: 'A', toStopId: 'X', runMinutes: 5 });
    const issue = validateNetwork(network).find((i) => i.rule === 'R-02');
    expect(issue?.message).toContain('X');
  });

  it('対象としてパターン内の位置を指す', () => {
    const network = makeValidNetwork();
    network.patterns[0] = makePattern({
      patternId: 'P0',
      directionId: 0,
      isDefault: true,
      stops: ['A', 'X'],
    });
    const issue = validateNetwork(network).find((i) => i.rule === 'R-02');
    expect(issue?.target).toEqual({ kind: 'patternStop', patternId: 'P0', index: 1 });
  });
});

describe('validateNetwork — R-03: 区間表がパターンを網羅', () => {
  it('パターンが使う区間が区間表に無いと検出する', () => {
    const network = makeValidNetwork();
    network.segments = network.segments.filter(
      (s) => segmentKey(s.fromStopId, s.toStopId) !== 'A→B',
    );
    expect(rulesOf(network)).toContain('R-03');
  });

  it('どの区間が足りないかをメッセージに含める（T-36 の受入条件）', () => {
    const network = makeValidNetwork();
    network.segments = network.segments.filter(
      (s) => segmentKey(s.fromStopId, s.toStopId) !== 'A→B',
    );
    const issue = validateNetwork(network).find((i) => i.rule === 'R-03');
    expect(issue?.message).toContain('A→B');
  });

  it('逆向きの区間があっても代用しない（区間は有向）', () => {
    const network = makeValidNetwork();
    // A→B を消し、B→A だけ残す
    network.segments = network.segments.filter(
      (s) => segmentKey(s.fromStopId, s.toStopId) !== 'A→B',
    );
    expect(rulesOf(network)).toContain('R-03');
  });
});

describe('validateNetwork — R-04: 区間の重複', () => {
  it('同じ (from, to) が 2 つあると検出する', () => {
    const network = makeValidNetwork();
    network.segments.push({ fromStopId: 'A', toStopId: 'B', runMinutes: 15 });
    expect(rulesOf(network)).toContain('R-04');
  });

  it('逆向きの区間は重複ではない', () => {
    const network = makeValidNetwork();
    expect(rulesOf(network)).not.toContain('R-04');
    expect(
      network.segments.filter((s: Segment) => s.fromStopId === 'A' || s.toStopId === 'A').length,
    ).toBeGreaterThan(1);
  });
});

describe('validateNetwork — R-05: 各方向に既定パターンが 1 つ', () => {
  it('既定が 0 件だと検出する', () => {
    const network = makeValidNetwork();
    network.patterns = network.patterns.map((p) =>
      p.patternId === 'P0' ? { ...p, isDefault: false } : p,
    );
    expect(rulesOf(network)).toContain('R-05');
  });

  it('既定が 2 件だと検出する', () => {
    const network = makeValidNetwork();
    network.patterns.push(
      makePattern({ patternId: 'P0b', directionId: 0, isDefault: true, stops: ['A', 'B'] }),
    );
    expect(rulesOf(network)).toContain('R-05');
  });

  it('回送は既定パターンとして数えない', () => {
    const network = makeValidNetwork();
    network.patterns = network.patterns.map((p) =>
      p.patternId === 'OUT' ? { ...p, isDefault: true } : p,
    );
    expect(rulesOf(network)).not.toContain('R-05');
  });

  it('対象として方向を指す', () => {
    const network = makeValidNetwork();
    network.patterns = network.patterns.map((p) =>
      p.patternId === 'P1' ? { ...p, isDefault: false } : p,
    );
    const issue = validateNetwork(network).find((i) => i.rule === 'R-05');
    expect(issue?.target).toEqual({ kind: 'direction', directionId: 1 });
  });
});

describe('validateNetwork — R-06: 停留所が 2 件以上', () => {
  it('停留所が 1 件のパターンを検出する', () => {
    const network = makeValidNetwork();
    network.patterns[0] = makePattern({
      patternId: 'P0',
      directionId: 0,
      isDefault: true,
      stops: ['A'],
    });
    expect(rulesOf(network)).toContain('R-06');
  });

  it('停留所が 0 件のパターンを検出する', () => {
    const network = makeValidNetwork();
    network.patterns[0] = makePattern({
      patternId: 'P0',
      directionId: 0,
      isDefault: true,
      stops: [],
    });
    expect(rulesOf(network)).toContain('R-06');
  });
});

describe('validateNetwork — R-07: 営業所と回送の対応', () => {
  it('営業所を含む営業パターンを検出する', () => {
    const network = makeValidNetwork();
    network.patterns[0] = makePattern({
      patternId: 'P0',
      directionId: 0,
      isDefault: true,
      stops: ['A', 'D'],
    });
    network.segments.push({ fromStopId: 'A', toStopId: 'D', runMinutes: 5 });
    expect(rulesOf(network)).toContain('R-07');
  });

  /** `OUT` を、営業所を含まない回送に差し替える（停留所間の回送）。 */
  function withBetweenStopsDeadhead(): ReturnType<typeof makeValidNetwork> {
    const network = makeValidNetwork();
    network.patterns = network.patterns.map((p) =>
      p.patternId === 'OUT'
        ? makePattern({
            patternId: 'OUT',
            directionId: 0,
            isDefault: false,
            isDeadhead: true,
            stops: ['A', 'B'],
          })
        : p,
    );
    return network;
  }

  it('**営業所を含まない回送を咎めない**（#247、T-97。かつては咎めていた）', () => {
    // 停留所間の回送（`箕面 → 豊中` など）を表せるようにするため、回送側の
    // 縛りを営業所から系統へ移した。
    expect(rulesOf(withBetweenStopsDeadhead())).not.toContain('R-07');
  });

  it('**系統の宣言が無ければ回送側を見ない**（`routes` は任意の項目）', () => {
    const network = withBetweenStopsDeadhead();
    expect(network.routes).toBeUndefined();
    expect(rulesOf(network)).not.toContain('R-07');
  });

  it('**回送が営業の系統に属していれば検出する**', () => {
    const network = withBetweenStopsDeadhead();
    network.routes = [{ routeName: 'R', color: '000000', textColor: 'ffffff', isDeadhead: false }];
    network.patterns = network.patterns.map((p) => ({ ...p, routeName: 'R' }));

    expect(rulesOf(network)).toContain('R-07');
    expect(validateNetwork(network).find((i) => i.rule === 'R-07')?.message).toContain(
      '回送の系統ではありません',
    );
  });

  it('**営業が回送の系統に属していれば検出する**（逆向きも見る）', () => {
    const network = makeValidNetwork();
    network.routes = [{ routeName: 'R', color: '000000', textColor: 'ffffff', isDeadhead: true }];
    network.patterns = network.patterns.map((p) => ({ ...p, routeName: 'R' }));

    expect(validateNetwork(network).find((i) => i.rule === 'R-07')?.message).toContain(
      '回送の系統',
    );
  });

  it('回送の系統に属していれば咎めない', () => {
    const network = withBetweenStopsDeadhead();
    network.routes = [
      { routeName: 'R', color: '000000', textColor: 'ffffff', isDeadhead: false },
      { routeName: 'D', color: '888888', textColor: '000000', isDeadhead: true },
    ];
    network.patterns = network.patterns.map((p) => ({
      ...p,
      routeName: p.isDeadhead ? 'D' : 'R',
    }));

    expect(rulesOf(network)).not.toContain('R-07');
  });
});

describe('validateNetwork — R-08: 停留所 ID の重複', () => {
  it('同じ stopId が 2 つあると検出する', () => {
    const network = makeValidNetwork();
    const first = network.stops[0];
    if (!first) throw new Error('テストデータが壊れています');
    network.stops.push({ ...first, stopName: '別名' });
    expect(rulesOf(network)).toContain('R-08');
  });
});

describe('validateNetwork — R-09: パターン ID の重複', () => {
  it('同じ patternId が 2 つあると検出する', () => {
    const network = makeValidNetwork();
    network.patterns.push(
      makePattern({ patternId: 'P0', directionId: 0, isDefault: false, stops: ['A', 'B'] }),
    );
    expect(rulesOf(network)).toContain('R-09');
  });
});

describe('validateNetwork — R-10: パターン内の停留所の重複', () => {
  it('同じ停留所が 2 回現れると検出する', () => {
    const network = makeValidNetwork();
    network.segments.push({ fromStopId: 'A', toStopId: 'A', runMinutes: 5 });
    network.patterns[0] = makePattern({
      patternId: 'P0',
      directionId: 0,
      isDefault: true,
      stops: ['A', 'A', 'B'],
    });
    expect(rulesOf(network)).toContain('R-10');
  });

  it('始発に戻る循環経路を禁じる（アンカーが一意に定まらないため）', () => {
    const network = makeValidNetwork();
    network.patterns[0] = makePattern({
      patternId: 'P0',
      directionId: 0,
      isDefault: true,
      stops: ['A', 'B', 'A'],
    });
    expect(rulesOf(network)).toContain('R-10');
  });

  it('2 回目の出現を指し、1 回目の位置をメッセージに含める', () => {
    const network = makeValidNetwork();
    network.patterns[0] = makePattern({
      patternId: 'P0',
      directionId: 0,
      isDefault: true,
      stops: ['A', 'B', 'A'],
    });
    const issue = validateNetwork(network).find((i) => i.rule === 'R-10');
    expect(issue?.target).toEqual({ kind: 'patternStop', patternId: 'P0', index: 2 });
    expect(issue?.message).toContain('1 番目');
  });

  it('別のパターンに同じ停留所が現れるのは問題ない', () => {
    expect(rulesOf(makeValidNetwork())).not.toContain('R-10');
  });
});

describe('validateNetwork — 複数の問題', () => {
  it('1 つ目の違反で打ち切らず、すべて集めて返す', () => {
    const network = makeValidNetwork();
    network.segments[0] = { fromStopId: 'A', toStopId: 'B', runMinutes: 7 };
    network.patterns.push(
      makePattern({ patternId: 'P0', directionId: 0, isDefault: true, stops: ['A'] }),
    );
    const rules = new Set(rulesOf(network));
    expect(rules.has('R-01')).toBe(true);
    expect(rules.has('R-06')).toBe(true);
    expect(rules.has('R-09')).toBe(true);
  });
});

describe('segmentKey', () => {
  it('有向であることが分かる形にする', () => {
    expect(segmentKey('A', 'B')).toBe('A→B');
    expect(segmentKey('A', 'B')).not.toBe(segmentKey('B', 'A'));
  });
});

describe('R-13: 区間距離（#161）', () => {
  /** 全区間に距離を入れた版数 2 の定義。 */
  function withDistances(): NetworkDef {
    const network = makeValidNetwork();
    return {
      ...network,
      version: 2,
      segments: network.segments.map((segment) => ({ ...segment, distanceMeters: 1000 })),
    };
  }

  it('版数 2 で全区間に距離があれば報告しない', () => {
    expect(rulesOf(withDistances())).not.toContain('R-13');
  });

  it('**版数 2 で距離が欠けていれば報告する**（入力漏れが「短い運用」に化ける）', () => {
    const network = withDistances();
    const [first, ...rest] = network.segments;
    if (first === undefined) throw new Error('区間がありません');
    network.segments = [{ ...first, distanceMeters: undefined }, ...rest];

    expect(rulesOf(network)).toContain('R-13');
  });

  it('**版数 1 には適用しない**（距離を持たないことが正しい状態である）', () => {
    // 弾くと古い定義が読めなくなる（仕様書 v1.1 §8.1）。
    expect(rulesOf(makeValidNetwork())).not.toContain('R-13');
  });

  it('欠けている区間を名指しする', () => {
    const network = withDistances();
    const [first, ...rest] = network.segments;
    if (first === undefined) throw new Error('区間がありません');
    network.segments = [{ ...first, distanceMeters: undefined }, ...rest];

    const issue = validateNetwork(network).find((i) => i.rule === 'R-13');
    expect(issue?.target).toEqual({
      kind: 'segment',
      fromStopId: first.fromStopId,
      toStopId: first.toStopId,
    });
  });
});

describe('R-12: 各駅・通過の別（#114）', () => {
  it('営業パターンに serviceType が無ければ報告する', () => {
    const network = makeValidNetwork();
    const pattern = network.patterns[0];
    if (pattern === undefined) throw new Error('パターンがありません');
    network.patterns[0] = { ...pattern, serviceType: undefined };

    expect(rulesOf(network)).toContain('R-12');
  });

  it('**回送に serviceType があれば報告する**（客を乗せない便に各駅・通過は無い）', () => {
    const network = makeValidNetwork();
    const deadhead = network.patterns.find((p) => p.isDeadhead);
    if (deadhead === undefined) throw new Error('回送パターンがありません');
    network.patterns = network.patterns.map((p) =>
      p === deadhead ? { ...p, serviceType: 'local' as const } : p,
    );

    expect(rulesOf(network)).toContain('R-12');
  });
});

describe('formatNetworkIssues', () => {
  it('規則 ID 付きで 1 行 1 件に整形する', () => {
    expect(
      formatNetworkIssues([
        {
          rule: 'R-03',
          message: '区間 A→B がありません',
          target: { kind: 'pattern', patternId: 'P0' },
        },
      ]),
    ).toBe('[R-03] 区間 A→B がありません');
  });

  it('空の一覧は空文字になる', () => {
    expect(formatNetworkIssues([])).toBe('');
  });
});

describe('R-14・R-15: GTFS に要る静的データ（#198）', () => {
  /** 事業者と全停留所の緯度経度を入れた版数 3 の定義。 */
  function withGtfsData(): NetworkDef {
    const network = makeValidNetwork();
    return {
      ...network,
      version: 3,
      agency: {
        agencyId: '4120905002554',
        agencyName: '国立大学法人大阪大学',
        agencyUrl: 'https://example.invalid/',
        agencyTimezone: 'Asia/Tokyo',
        agencyLang: 'ja',
      },
      segments: network.segments.map((segment) => ({ ...segment, distanceMeters: 1000 })),
      stops: network.stops.map((stop) => ({ ...stop, lat: 34.8, lon: 135.5 })),
    };
  }

  it('版数 3 で揃っていれば報告しない', () => {
    const rules = rulesOf(withGtfsData());
    expect(rules).not.toContain('R-14');
    expect(rules).not.toContain('R-15');
  });

  it('**版数 2 以前には適用しない**（持たないことが正しい状態である）', () => {
    // 弾くと古い定義が読めなくなる（距離を足したときと同じ扱い。仕様書 v2 §7.1）。
    const rules = rulesOf(makeValidNetwork());
    expect(rules).not.toContain('R-14');
    expect(rules).not.toContain('R-15');
  });

  it('版数 3 で agency が無ければ R-14 を報告する', () => {
    const network = { ...withGtfsData(), agency: undefined };
    expect(rulesOf(network)).toContain('R-14');
  });

  it('R-14 は指す先を持たない対象として報告する', () => {
    const network = { ...withGtfsData(), agency: undefined };
    const issue = validateNetwork(network).find((i) => i.rule === 'R-14');
    expect(issue?.target).toEqual({ kind: 'agency' });
  });

  it('版数 3 で緯度が欠けていれば R-15 を報告する', () => {
    const network = withGtfsData();
    const [first, ...rest] = network.stops;
    if (first === undefined) throw new Error('停留所がありません');
    network.stops = [{ ...first, lat: undefined }, ...rest];

    expect(rulesOf(network)).toContain('R-15');
  });

  it('経度だけが欠けていても報告する', () => {
    const network = withGtfsData();
    const [first, ...rest] = network.stops;
    if (first === undefined) throw new Error('停留所がありません');
    network.stops = [{ ...first, lon: undefined }, ...rest];

    expect(rulesOf(network)).toContain('R-15');
  });

  it('**車庫も対象にする**（stops.txt に出すため、座標が要る）', () => {
    // 回送便の stop_times が車庫を指す（仕様書 v2 §6.5.2）。出す以上は座標が要る。
    const network = withGtfsData();
    const depot = network.stops.find((stop) => stop.isDepot);
    if (depot === undefined) throw new Error('車庫がありません');
    network.stops = network.stops.map((stop) =>
      stop.isDepot ? { ...stop, lat: undefined, lon: undefined } : stop,
    );

    const issue = validateNetwork(network).find((i) => i.rule === 'R-15');
    expect(issue?.target).toEqual({ kind: 'stop', stopId: depot.stopId });
  });

  it('欠けている停留所を名指しする', () => {
    const network = withGtfsData();
    const [first, ...rest] = network.stops;
    if (first === undefined) throw new Error('停留所がありません');
    network.stops = [{ ...first, lat: undefined }, ...rest];

    const issue = validateNetwork(network).find((i) => i.rule === 'R-15');
    expect(issue?.message).toContain(first.stopId);
    expect(issue?.target).toEqual({ kind: 'stop', stopId: first.stopId });
  });
});
