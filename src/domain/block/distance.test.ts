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
import { blockDistance, blockDistances } from './distance';
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
    });
  });

  it('**回送は走行距離にだけ入る**（走った距離は事実だが、運べた人数ではない）', () => {
    // 出区（車庫 → 豊中 5.6km）を付ける。
    const block = blockOf([trip('S1', 8, 0, { pullOut: true }), trip('T1', 8, 40)]);
    const { total, revenue } = blockDistance(block, network);

    expect(revenue).toBe(9800 + 11600);
    expect(total).toBe(9800 + 11600 + 5600);
  });

  it('出区と入区の両方を数える', () => {
    const block = blockOf([
      trip('S1', 8, 0, { pullOut: true }),
      trip('T1', 8, 40, { pullIn: true }),
    ]);

    // 入区は 豊中 → 車庫（5.7km）。
    expect(blockDistance(block, network).total).toBe(9800 + 11600 + 5600 + 5700);
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
