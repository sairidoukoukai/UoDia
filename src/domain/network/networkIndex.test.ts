/**
 * 索引と累積所要時間の検証（T-07）。
 *
 * 合成データで索引そのものの振る舞いを確かめ、実データ（`data/route.json`）で
 * 付録 A.4 の合計時間と一致することを確かめる。合成データは検証器を通さない。
 * 索引は R-03・R-06・R-10 が満たされることを前提とする側であり、前提が破れた
 * ときの振る舞いを試すには、あえて壊したデータを渡す必要があるため。
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { NetworkDef, StopPattern } from '@/domain/model';
import { loadNetworkDef } from './load';
import { buildNetworkIndex, type NetworkIndex } from './networkIndex';

function makePattern(patternId: string, stops: readonly string[]): StopPattern {
  return {
    patternId,
    patternName: patternId,
    routeName: 'テスト線',
    directionId: 0,
    color: '#123456',
    isDefault: false,
    isDeadhead: false,
    stopSequence: stops.map((stopId, index) => ({
      stopId,
      handling: index === 0 ? 'boardOnly' : index === stops.length - 1 ? 'alightOnly' : 'stop',
    })),
  };
}

/**
 * A →(10)→ B →(0)→ C の 3 停留所。
 *
 * B → C を 0 分にしてあるのは、微生物研究所前と工学部前の関係（仕様書 §5.5.1）を
 * 最小の形で再現するため。
 */
function makeNetwork(): NetworkDef {
  return {
    version: 1,
    name: 'テスト用',
    timeGrain: 300,
    stops: ['A', 'B', 'C'].map((stopId, index) => ({
      stopId,
      stopName: `${stopId}停留所`,
      shortName: stopId,
      area: '',
      axisPosition: index * 10,
      gridStyle: 'normal' as const,
      hiddenInEditor: false,
      isDepot: false,
    })),
    segments: [
      { fromStopId: 'A', toStopId: 'B', runMinutes: 10 },
      { fromStopId: 'B', toStopId: 'C', runMinutes: 0 },
      { fromStopId: 'C', toStopId: 'A', runMinutes: 15 },
    ],
    patterns: [makePattern('P0', ['A', 'B', 'C']), makePattern('P1', ['C', 'A'])],
  };
}

describe('buildNetworkIndex — 停留所とパターンの索引', () => {
  const index = buildNetworkIndex(makeNetwork());

  it('stopId から停留所を引ける', () => {
    expect(index.findStop('B')?.stopName).toBe('B停留所');
  });

  it('存在しない停留所は undefined', () => {
    expect(index.findStop('X')).toBeUndefined();
  });

  it('patternId からパターンを引ける', () => {
    expect(index.findPattern('P0')?.patternName).toBe('P0');
  });

  it('存在しないパターンは undefined', () => {
    expect(index.findPattern('X')).toBeUndefined();
  });

  it('元の定義をそのまま保持する', () => {
    const def = makeNetwork();
    expect(buildNetworkIndex(def).def).toBe(def);
  });
});

describe('buildNetworkIndex — 区間表', () => {
  const index = buildNetworkIndex(makeNetwork());

  it('区間の所要時間を引ける', () => {
    expect(index.runMinutes('A', 'B')).toBe(10);
  });

  it('有向である（逆向きは別の区間）', () => {
    expect(index.runMinutes('B', 'A')).toBeUndefined();
  });

  it('0 分の区間と存在しない区間を区別する', () => {
    expect(index.runMinutes('B', 'C')).toBe(0);
    expect(index.runMinutes('A', 'C')).toBeUndefined();
  });
});

describe('buildNetworkIndex — 累積所要時間', () => {
  const index = buildNetworkIndex(makeNetwork());
  const p0 = index.patternIndex('P0');

  it('始発の累積時間は 0', () => {
    expect(p0?.offsetFromOrigin('A')).toBe(0);
  });

  it('途中停留所の累積時間は区間の和', () => {
    expect(p0?.offsetFromOrigin('B')).toBe(10);
  });

  it('0 分区間の先は直前の停留所と同じ値になる', () => {
    expect(p0?.offsetFromOrigin('C')).toBe(p0?.offsetFromOrigin('B'));
  });

  it('パターンに含まれない停留所は undefined', () => {
    expect(index.patternIndex('P1')?.offsetFromOrigin('B')).toBeUndefined();
  });

  it('経由するかを includes で判定できる', () => {
    expect(p0?.includes('C')).toBe(true);
    expect(index.patternIndex('P1')?.includes('B')).toBe(false);
  });

  it('始発・終着・全区間所要時間を導出する', () => {
    expect(p0?.originStopId).toBe('A');
    expect(p0?.terminalStopId).toBe('C');
    expect(p0?.totalMinutes).toBe(10);
  });

  it('元のパターンを保持する', () => {
    expect(p0?.pattern.patternId).toBe('P0');
  });

  it('存在しないパターンの索引は undefined', () => {
    expect(index.patternIndex('X')).toBeUndefined();
  });

  it('offsets は経路の順に停留所と累積時間を並べる', () => {
    expect(p0?.offsets).toEqual([
      ['A', 0],
      ['B', 10],
      ['C', 10],
    ]);
  });

  it('offsets の最後の値が totalMinutes と一致する', () => {
    expect(p0?.offsets.at(-1)?.[1]).toBe(p0?.totalMinutes);
  });
});

describe('buildNetworkIndex — 前提が破れている場合', () => {
  it('区間表に無い区間を使うパターンがあると例外を投げる（R-03 違反）', () => {
    const def = makeNetwork();
    def.patterns.push(makePattern('BAD', ['A', 'C']));
    expect(() => buildNetworkIndex(def)).toThrow('区間 A→C');
  });

  it('停留所が 0 件のパターンがあると例外を投げる（R-06 違反）', () => {
    const def = makeNetwork();
    def.patterns.push(makePattern('EMPTY', []));
    expect(() => buildNetworkIndex(def)).toThrow('停留所がありません');
  });

  it('停留所が 1 件だけのパターンは始発と終着が一致する', () => {
    // R-06 違反だが索引は作れる。検証器が弾く前提であり、ここで追加の判定はしない。
    const def = makeNetwork();
    def.patterns.push(makePattern('ONE', ['A']));
    const one = buildNetworkIndex(def).patternIndex('ONE');
    expect(one?.originStopId).toBe('A');
    expect(one?.terminalStopId).toBe('A');
    expect(one?.totalMinutes).toBe(0);
  });
});

describe('loadNetworkDef — 索引を返す', () => {
  const routeJsonPath = fileURLToPath(new URL('../../../data/route.json', import.meta.url));
  const rawJson = readFileSync(routeJsonPath, 'utf8');

  function loadIndex(): NetworkIndex {
    const result = loadNetworkDef(rawJson);
    if (!result.ok) throw new Error(`route.json を読み込めません（段階: ${result.stage}）`);
    return result.network;
  }

  const index = loadIndex();

  it('読込結果から生の定義も取り出せる', () => {
    expect(index.def.stops).toHaveLength(7);
  });

  it('同じ索引を使い回す（読込時に一度だけ計算する）', () => {
    expect(index.patternIndex('S3')).toBe(index.patternIndex('S3'));
  });

  it.each([
    ['S1', 30],
    ['T1', 30],
    ['M2', 20],
    ['T2', 20],
    ['S3', 40],
    ['T3', 45],
    ['S2', 20],
    ['M4', 25],
  ])('%s の全区間所要時間が付録 A.4 の %d 分と一致する', (patternId, expected) => {
    expect(index.patternIndex(patternId)?.totalMinutes).toBe(expected);
  });

  it('回送 6 種はすべて 20 分', () => {
    for (const p of index.def.patterns.filter((x) => x.isDeadhead)) {
      expect(index.patternIndex(p.patternId)?.totalMinutes, p.patternId).toBe(20);
    }
  });

  it('微生物研究所前の累積時間が工学部前と等しい（区間 #5 が 0 分のため）', () => {
    for (const p of index.def.patterns) {
      const pattern = index.patternIndex(p.patternId);
      const biken = pattern?.offsetFromOrigin('6_0');
      if (biken !== undefined) {
        expect(biken, p.patternId).toBe(pattern?.offsetFromOrigin('4_0'));
      }
    }
  });

  it('微生物研究所前を経由するパターンが実際に存在する', () => {
    const via = index.def.patterns.filter((p) => index.patternIndex(p.patternId)?.includes('6_0'));
    expect(via.length).toBeGreaterThan(0);
  });

  it('S3（箕面経由吹田）の各停留所の累積時間が区間表と整合する', () => {
    const s3 = index.patternIndex('S3');
    expect(s3?.originStopId).toBe('1_0');
    expect(s3?.terminalStopId).toBe('4_0');
    expect(s3?.offsetFromOrigin('1_0')).toBe(0);
    expect(s3?.offsetFromOrigin('2_0')).toBe(20);
    expect(s3?.offsetFromOrigin('3_0')).toBe(35);
    expect(s3?.offsetFromOrigin('4_0')).toBe(40);
  });

  it('経由しない停留所は undefined を返す（S1 は箕面学舎を通らない）', () => {
    expect(index.patternIndex('S1')?.offsetFromOrigin('2_0')).toBeUndefined();
  });
});
