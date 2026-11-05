/**
 * 運用の走行距離の検証（T-63、#161、仕様書 v1.1 §6.1.2）。
 *
 * **回送込みと回送抜きの 2 つを出す。** 片方だけでは答えられない問いがそれぞれに
 * ある——車がその日に何 km 走ったか（回送を含む）と、客を運ぶために走ったか
 * （含まない）である。
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Trip } from '@/domain/model';
import { loadNetworkDef, type NetworkIndex } from '@/domain/network';
import { fromHM } from '@/domain/time';
import { blockDistance, blockDistances, totalDistances } from './distance';
import { deriveBlocks } from './derive';

const routeJsonPath = fileURLToPath(new URL('../../../data/route.json', import.meta.url));
const loaded = loadNetworkDef(readFileSync(routeJsonPath, 'utf8'));
if (!loaded.ok) throw new Error('route.json を読み込めません');
const network: NetworkIndex = loaded.network;

let counter = 0;

function trip(patternId: string, hours: number, minutes: number, extra: Partial<Trip> = {}): Trip {
  const pattern = network.patternIndex(patternId);
  if (pattern === undefined) throw new Error(`パターン ${patternId} がありません`);
  counter += 1;
  return {
    tripId: `t${String(counter)}`,
    patternId,
    anchor: { stopId: pattern.originStopId, time: fromHM(hours, minutes) },
    blockId: 'A',
    pullOut: false,
    pullIn: false,
    ...extra,
  };
}

/** 運用 A を 1 つ組む。 */
function blockOf(trips: readonly Trip[]) {
  const [block] = deriveBlocks(trips, network).blocks;
  if (block === undefined) throw new Error('運用がありません');
  return block;
}

describe('blockDistance', () => {
  it('営業便だけなら、走行距離と営業距離は同じ', () => {
    // S1（9.8km）→ T1（11.6km）。
    const block = blockOf([trip('S1', 8, 0), trip('T1', 8, 40)]);

    expect(blockDistance(block, network)).toEqual({
      blockId: 'A',
      total: 9800 + 11600,
      revenue: 9800 + 11600,
      deadhead: 0,
    });
  });

  it('**回送は走行距離にだけ入る**（走った距離は事実だが、運べた人数ではない）', () => {
    // 出区（車庫 → 豊中 5.6km）を付ける。
    const block = blockOf([trip('S1', 8, 0, { pullOut: true }), trip('T1', 8, 40)]);
    const { total, revenue, deadhead } = blockDistance(block, network);

    expect(revenue).toBe(9800 + 11600);
    expect(total).toBe(9800 + 11600 + 5600);
    expect(deadhead).toBe(5600);
  });

  it('出区と入区の両方を数える', () => {
    const block = blockOf([
      trip('S1', 8, 0, { pullOut: true }),
      trip('T1', 8, 40, { pullIn: true }),
    ]);

    // 入区は 豊中 → 車庫（5.7km）。
    const res = blockDistance(block, network);
    expect(res.total).toBe(9800 + 11600 + 5600 + 5700);
    expect(res.deadhead).toBe(5600 + 5700);
  });

  it('**距離の分からない区間があれば合計を出さない**', () => {
    const withoutDistances = loadNetworkDef(
      JSON.stringify({
        ...network.def,
        version: 1,
        segments: network.def.segments.map(({ distanceMeters: _drop, ...rest }) => rest),
      }),
    );
    if (!withoutDistances.ok) throw new Error('組み立てられません');

    const block = blockOf([trip('S1', 8, 0)]);
    expect(blockDistance(block, withoutDistances.network)).toEqual({
      blockId: 'A',
      total: null,
      revenue: null,
      deadhead: null,
    });
  });
});

describe('blockDistances', () => {
  it('運用ごとに返す（運用番号の昇順）', () => {
    const trips = [trip('S1', 8, 0, { blockId: 'B' }), trip('S1', 9, 0, { blockId: 'A' })];
    const { blocks } = deriveBlocks(trips, network);

    expect(blockDistances(blocks, network).map((d) => d.blockId)).toEqual(['A', 'B']);
  });

  it('運用が無ければ空', () => {
    expect(blockDistances([], network)).toEqual([]);
  });
});

describe('totalDistances', () => {
  it('すべての系統の運行距離和・営業距離和・回送距離和を算出する', () => {
    // 運用 A: S1（出区あり）+ T1
    // 運用 B: S1（営業便のみ）
    const trips = [
      trip('S1', 8, 0, { blockId: 'A', pullOut: true }),
      trip('T1', 8, 40, { blockId: 'A' }),
      trip('S1', 9, 0, { blockId: 'B' }),
    ];
    const result = totalDistances(trips, network);

    const expectedRevenue = 9800 + 11600 + 9800;
    const expectedDeadhead = 5600;
    const expectedTotal = expectedRevenue + expectedDeadhead;

    expect(result).toEqual({
      total: expectedTotal,
      revenue: expectedRevenue,
      deadhead: expectedDeadhead,
    });
  });

  it('**停留所間の回送（区間回送）は回送距離にだけ入り、二重に足されない**', () => {
    // 運用 A: M2（豊中→箕面 6.4km）→ DT-M（区間回送: 豊中→箕面 6.4km）
    const trips = [
      trip('M2', 8, 0, { blockId: 'A', pullOut: true }),
      trip('DT-M', 9, 0, { blockId: 'A', pullIn: true }),
    ];
    const result = totalDistances(trips, network);

    // 営業便は M2（6400m）だけ。
    // 回送便は 出区（5600m）+ DT-M（6400m）+ 箕面入区（3300m）。
    expect(result).toEqual({
      revenue: 6400,
      deadhead: 5600 + 6400 + 3300,
      total: 6400 + 5600 + 6400 + 3300,
    });
  });

  it('**全便に運用番号が付いていれば、各運用の距離の和と全体の距離が一致する**', () => {
    // 出入庫回送・区間回送・営業便を複数運用に混ぜる。
    const trips = [
      trip('S1', 8, 0, { blockId: '1', pullOut: true }),
      trip('T1', 8, 40, { blockId: '1' }),
      trip('DT-M', 9, 30, { blockId: '1' }),
      trip('S2', 10, 0, { blockId: '1', pullIn: true }),
      trip('M2', 8, 20, { blockId: '2', pullOut: true }),
      trip('DS-T', 9, 10, { blockId: '2' }),
      trip('S1', 10, 0, { blockId: '2', pullIn: true }),
    ];
    const { blocks } = deriveBlocks(trips, network);
    const byBlock = blockDistances(blocks, network);
    const sumOfBlocks = {
      total: byBlock.reduce((acc, b) => acc + (b.total ?? 0), 0),
      revenue: byBlock.reduce((acc, b) => acc + (b.revenue ?? 0), 0),
      deadhead: byBlock.reduce((acc, b) => acc + (b.deadhead ?? 0), 0),
    };

    expect(totalDistances(trips, network)).toEqual(sumOfBlocks);
  });

  it('運用未割り当ての便もそれぞれの距離に含まれる', () => {
    const trips = [
      trip('S1', 8, 0, { blockId: 'A', pullOut: true }),
      trip('T1', 8, 40, { blockId: '' }), // 未割り当ての営業便
      trip('DT-M', 9, 20, { blockId: '' }), // 未割り当ての区間回送便
    ];
    const result = totalDistances(trips, network);

    expect(result.revenue).toBe(9800 + 11600);
    expect(result.deadhead).toBe(5600 + 6400);
    expect(result.total).toBe(9800 + 11600 + 5600 + 6400);
  });

  it('距離が分からない区間があれば null を返す', () => {
    const withoutDistances = loadNetworkDef(
      JSON.stringify({
        ...network.def,
        version: 1,
        segments: network.def.segments.map(({ distanceMeters: _drop, ...rest }) => rest),
      }),
    );
    if (!withoutDistances.ok) throw new Error('組み立てられません');

    expect(totalDistances([trip('S1', 8, 0)], withoutDistances.network)).toEqual({
      total: null,
      revenue: null,
      deadhead: null,
    });
  });
});
