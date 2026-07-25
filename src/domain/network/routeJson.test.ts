/**
 * `data/route.json` そのものの検証（T-05）。
 *
 * 仕様書 §5.5.2 の R-01〜R-07 と、付録 A.4 の全区間所要時間が実データと
 * 一致することを確認する。R-01〜R-07 を再利用可能な検証器として切り出すのは
 * T-06 の担当であり、本テストはそれまでの間 `route.json` の正しさを保証する。
 *
 * ファイルは `fs` で読む。アプリ本体も `PlatformAdapter` 経由で文字列として
 * 読み込むため（実装計画書 §3.3）、バンドラの JSON import に依存しない形を
 * とることで実際の読込経路に近づけている。
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { networkDefSchema, parseWithSchema, type NetworkDef } from '@/domain/model';

const routeJsonPath = fileURLToPath(new URL('../../../data/route.json', import.meta.url));
const rawJson = readFileSync(routeJsonPath, 'utf8');

function loadNetwork(): NetworkDef {
  const result = parseWithSchema(networkDefSchema, JSON.parse(rawJson));
  if (!result.ok) {
    throw new Error(
      `route.json がスキーマに適合しません:\n${JSON.stringify(result.issues, null, 2)}`,
    );
  }
  return result.value;
}

const network = loadNetwork();
const segmentKey = (from: string, to: string): string => `${from}→${to}`;
const segmentMap = new Map(network.segments.map((s) => [segmentKey(s.fromStopId, s.toStopId), s]));
const stopIds = new Set(network.stops.map((s) => s.stopId));

describe('route.json — スキーマ適合', () => {
  it('networkDefSchema で読み込める', () => {
    expect(parseWithSchema(networkDefSchema, JSON.parse(rawJson)).ok).toBe(true);
  });

  it('仕様書 付録 A のとおり停留所 7 件・区間 15 件・パターン 14 件を持つ', () => {
    expect(network.stops).toHaveLength(7);
    expect(network.segments).toHaveLength(15);
    expect(network.patterns).toHaveLength(14);
  });

  it('営業パターン 8 件・回送パターン 6 件', () => {
    expect(network.patterns.filter((p) => !p.isDeadhead)).toHaveLength(8);
    expect(network.patterns.filter((p) => p.isDeadhead)).toHaveLength(6);
  });
});

describe('route.json — 停留所（仕様書 付録 A.1）', () => {
  it('千里営業所が isDepot である', () => {
    expect(network.stops.find((s) => s.stopId === '9_0')?.isDepot).toBe(true);
  });

  it('千里営業所だけが営業所である', () => {
    expect(network.stops.filter((s) => s.isDepot).map((s) => s.stopId)).toEqual(['9_0']);
  });

  it('微生物研究所前が hiddenInEditor である', () => {
    expect(network.stops.find((s) => s.stopId === '6_0')?.hiddenInEditor).toBe(true);
  });

  it('微生物研究所前だけが非表示である', () => {
    expect(network.stops.filter((s) => s.hiddenInEditor).map((s) => s.stopId)).toEqual(['6_0']);
  });

  it('豊中学舎の axisPosition が 0 である', () => {
    expect(network.stops.find((s) => s.stopId === '1_0')?.axisPosition).toBe(0);
  });

  it('axisPosition が方向 0（吹田方面＝下向き）の順に並んでいる', () => {
    const order = ['1_0', '2_0', '3_0', '5_0', '6_0', '4_0'];
    const positions = order.map(
      (id) => network.stops.find((s) => s.stopId === id)?.axisPosition ?? Number.NaN,
    );
    for (let i = 1; i < positions.length; i++) {
      expect(positions[i]).toBeGreaterThan(positions[i - 1] ?? Number.NaN);
    }
  });

  it('コンベンションセンター前と人間科学部前が別位置にある', () => {
    const conv = network.stops.find((s) => s.stopId === '3_0')?.axisPosition;
    const human = network.stops.find((s) => s.stopId === '5_0')?.axisPosition;
    expect(conv).not.toBe(human);
  });

  it('営業所が営業区間の外側に配置されている（仕様書 §6.2.1）', () => {
    const depot = network.stops.find((s) => s.isDepot)?.axisPosition ?? Number.NaN;
    const serviceMax = Math.max(
      ...network.stops.filter((s) => !s.isDepot).map((s) => s.axisPosition),
    );
    expect(depot).toBeGreaterThan(serviceMax);
  });

  it('stopId が重複しない', () => {
    expect(stopIds.size).toBe(network.stops.length);
  });
});

describe('route.json — ネットワーク定義の検証（仕様書 §5.5.2 R-01〜R-07）', () => {
  it('R-01: すべての runMinutes が 5 の倍数', () => {
    for (const s of network.segments) {
      expect(s.runMinutes % 5, segmentKey(s.fromStopId, s.toStopId)).toBe(0);
    }
  });

  it('R-02: すべての stopSequence の stopId が実在する', () => {
    for (const p of network.patterns) {
      for (const ps of p.stopSequence) {
        expect(stopIds.has(ps.stopId), `${p.patternId} の ${ps.stopId}`).toBe(true);
      }
    }
    for (const s of network.segments) {
      expect(stopIds.has(s.fromStopId), s.fromStopId).toBe(true);
      expect(stopIds.has(s.toStopId), s.toStopId).toBe(true);
    }
  });

  it('R-03: すべてのパターンの隣接停留所対が segments に存在する', () => {
    for (const p of network.patterns) {
      for (let i = 1; i < p.stopSequence.length; i++) {
        const from = p.stopSequence[i - 1]?.stopId ?? '';
        const to = p.stopSequence[i]?.stopId ?? '';
        expect(segmentMap.has(segmentKey(from, to)), `${p.patternId}: ${from}→${to}`).toBe(true);
      }
    }
  });

  it('R-04: segments に (from, to) の重複がない', () => {
    expect(segmentMap.size).toBe(network.segments.length);
  });

  it('R-05: 各方向に既定の営業パターンがちょうど 1 つある', () => {
    for (const direction of [0, 1] as const) {
      const defaults = network.patterns.filter(
        (p) => p.directionId === direction && p.isDefault && !p.isDeadhead,
      );
      expect(defaults, `方向 ${String(direction)}`).toHaveLength(1);
    }
  });

  it('R-06: すべてのパターンの stopSequence が 2 要素以上', () => {
    for (const p of network.patterns) {
      expect(p.stopSequence.length, p.patternId).toBeGreaterThanOrEqual(2);
    }
  });

  it('R-07: 営業所を含むパターンは回送であり、回送は営業所を含む', () => {
    for (const p of network.patterns) {
      const hasDepot = p.stopSequence.some((ps) => ps.stopId === '9_0');
      expect(hasDepot, `${p.patternId} の営業所有無と isDeadhead が一致しない`).toBe(p.isDeadhead);
    }
  });

  it('使われていない区間が存在しない', () => {
    const used = new Set<string>();
    for (const p of network.patterns) {
      for (let i = 1; i < p.stopSequence.length; i++) {
        used.add(segmentKey(p.stopSequence[i - 1]?.stopId ?? '', p.stopSequence[i]?.stopId ?? ''));
      }
    }
    for (const key of segmentMap.keys()) {
      expect(used.has(key), `区間 ${key} はどのパターンからも使われていない`).toBe(true);
    }
  });
});

describe('route.json — 全区間所要時間（仕様書 付録 A.4）', () => {
  /** パターンの停留所列に沿って区間表を引き、始発から終着までの所要時間を求める。 */
  function totalMinutes(patternId: string): number {
    const pattern = network.patterns.find((p) => p.patternId === patternId);
    if (!pattern) throw new Error(`パターン ${patternId} が見つかりません`);
    let total = 0;
    for (let i = 1; i < pattern.stopSequence.length; i++) {
      const key = segmentKey(
        pattern.stopSequence[i - 1]?.stopId ?? '',
        pattern.stopSequence[i]?.stopId ?? '',
      );
      const segment = segmentMap.get(key);
      if (!segment) throw new Error(`区間 ${key} が見つかりません`);
      total += segment.runMinutes;
    }
    return total;
  }

  it.each([
    ['S1', '直行吹田', 30],
    ['T1', '直行豊中', 30],
    ['M2', '箕面（豊中発）', 20],
    ['T2', '豊中（箕面発）', 20],
    ['S3', '箕面経由吹田', 40],
    ['T3', '箕面経由豊中', 45],
    ['S2', '吹田（箕面発）', 20],
    ['M4', '箕面（吹田発）', 25],
  ])('%s（%s）は %d 分', (patternId, _name, expected) => {
    expect(totalMinutes(patternId)).toBe(expected);
  });

  it('回送 6 種はすべて 20 分', () => {
    for (const p of network.patterns.filter((x) => x.isDeadhead)) {
      expect(totalMinutes(p.patternId), p.patternId).toBe(20);
    }
  });

  it('箕面〜吹田間は往復で 5 分非対称（経路が異なるため。仕様書 付録 A.4）', () => {
    expect(totalMinutes('S2')).toBe(20); // 箕面 → コンベ経由 → 吹田
    expect(totalMinutes('M4')).toBe(25); // 吹田 → 人科経由 → 箕面
  });

  it('豊中〜吹田（直行）と豊中〜箕面は往復対称', () => {
    expect(totalMinutes('S1')).toBe(totalMinutes('T1'));
    expect(totalMinutes('M2')).toBe(totalMinutes('T2'));
  });
});

describe('route.json — 停車パターンの取扱区分', () => {
  it('始発は boardOnly、終着は alightOnly', () => {
    for (const p of network.patterns) {
      expect(p.stopSequence.at(0)?.handling, `${p.patternId} の始発`).toBe('boardOnly');
      expect(p.stopSequence.at(-1)?.handling, `${p.patternId} の終着`).toBe('alightOnly');
    }
  });

  it('微生物研究所前は常に降車専用（仕様書 付録 A.1）', () => {
    for (const p of network.patterns) {
      const biken = p.stopSequence.find((ps) => ps.stopId === '6_0');
      if (biken) {
        expect(biken.handling, p.patternId).toBe('alightOnly');
      }
    }
  });

  it('微生物研究所前はコンベンションセンター前から工学部前へ向かうパターンにのみ現れる', () => {
    for (const p of network.patterns) {
      const index = p.stopSequence.findIndex((ps) => ps.stopId === '6_0');
      if (index >= 0) {
        expect(p.stopSequence[index - 1]?.stopId, p.patternId).toBe('3_0');
        expect(p.stopSequence[index + 1]?.stopId, p.patternId).toBe('4_0');
      }
    }
  });

  it('微生物研究所前から工学部前までが 0 分である（仕様書 §5.5.1）', () => {
    expect(segmentMap.get(segmentKey('6_0', '4_0'))?.runMinutes).toBe(0);
  });
});

describe('route.json — 方向と経路の整合', () => {
  it('方向 0 のパターンは axisPosition が増加する向きに進む', () => {
    const posOf = (id: string): number =>
      network.stops.find((s) => s.stopId === id)?.axisPosition ?? Number.NaN;
    for (const p of network.patterns.filter((x) => x.directionId === 0 && !x.isDeadhead)) {
      for (let i = 1; i < p.stopSequence.length; i++) {
        const prev = posOf(p.stopSequence[i - 1]?.stopId ?? '');
        const curr = posOf(p.stopSequence[i]?.stopId ?? '');
        expect(curr, p.patternId).toBeGreaterThan(prev);
      }
    }
  });

  it('方向 1 のパターンは axisPosition が減少する向きに進む', () => {
    const posOf = (id: string): number =>
      network.stops.find((s) => s.stopId === id)?.axisPosition ?? Number.NaN;
    for (const p of network.patterns.filter((x) => x.directionId === 1 && !x.isDeadhead)) {
      for (let i = 1; i < p.stopSequence.length; i++) {
        const prev = posOf(p.stopSequence[i - 1]?.stopId ?? '');
        const curr = posOf(p.stopSequence[i]?.stopId ?? '');
        expect(curr, p.patternId).toBeLessThan(prev);
      }
    }
  });

  it('直行便（S1）は箕面学舎を経由しない', () => {
    const s1 = network.patterns.find((p) => p.patternId === 'S1');
    expect(s1?.stopSequence.some((ps) => ps.stopId === '2_0')).toBe(false);
  });

  it('吹田発のパターンは人間科学部前を、吹田行きはコンベンションセンター前を経由する', () => {
    for (const p of network.patterns.filter((x) => !x.isDeadhead)) {
      const ids = p.stopSequence.map((ps) => ps.stopId);
      expect(ids.includes('3_0') && ids.includes('5_0'), p.patternId).toBe(false);
    }
  });

  it('パターン ID の接頭辞が行先と一致する（S=吹田 / T=豊中 / M=箕面）', () => {
    const terminalOf: Record<string, string> = { S: '4_0', T: '1_0', M: '2_0' };
    for (const p of network.patterns.filter((x) => !x.isDeadhead)) {
      const prefix = p.patternId.charAt(0);
      expect(p.stopSequence.at(-1)?.stopId, p.patternId).toBe(terminalOf[prefix]);
    }
  });
});
