/**
 * フォーカス範囲での数え方の検証（T-65、#166、仕様書 v1.1 §6.4.2）。
 *
 * 確かめるのは**按分しないこと**である。区間の途中で切ると、その区間の何割を
 * 走ったかを時刻から按分することになり、**バスが等速で走っている前提を持ち込む
 * ことになる。**
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Trip } from '@/domain/model';
import { loadNetworkDef, type NetworkIndex } from '@/domain/network';
import { fromHM } from '@/domain/time';
import { distanceInRange, tripDistanceInRange } from './focus';

const routeJsonPath = fileURLToPath(new URL('../../../data/route.json', import.meta.url));
const loaded = loadNetworkDef(readFileSync(routeJsonPath, 'utf8'));
if (!loaded.ok) throw new Error('route.json を読み込めません');
const network: NetworkIndex = loaded.network;

let counter = 0;

/** S1（豊中 8:00 → コンベ前 8:25 → 微研 8:30 → 工学部 8:30）。 */
function trip(patternId: string, hours: number, minutes = 0, extra: Partial<Trip> = {}): Trip {
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

describe('tripDistanceInRange', () => {
  it('範囲が `null` なら丸ごと数える', () => {
    // S1 = 8.5 + 1.3 + 0.0 = 9.8km。
    expect(tripDistanceInRange(trip('S1', 8), network, null)).toBe(9800);
  });

  it('範囲に丸ごと入れば全部数える', () => {
    const range = { from: fromHM(7, 0), to: fromHM(9, 0) };
    expect(tripDistanceInRange(trip('S1', 8), network, range)).toBe(9800);
  });

  it('**区間単位で切る**（区間の途中で按分しない）', () => {
    // 豊中 8:00 発（8.5km の区間に入る）、コンベ前 8:25 発（1.3km）、微研 8:30 発（0km）。
    // 8:00〜8:10 なら最初の区間だけが入る。
    const range = { from: fromHM(8, 0), to: fromHM(8, 10) };
    expect(tripDistanceInRange(trip('S1', 8), network, range)).toBe(8500);
  });

  it('**その区間を通り始める時刻で判定する**（便の始発時刻ではない）', () => {
    // 8:20〜8:40 は、豊中 8:00 発の区間を外し、コンベ前 8:25 発以降を拾う。
    const range = { from: fromHM(8, 20), to: fromHM(8, 40) };
    expect(tripDistanceInRange(trip('S1', 8), network, range)).toBe(1300);
  });

  it('範囲から外れきれば 0', () => {
    const range = { from: fromHM(10, 0), to: fromHM(11, 0) };
    expect(tripDistanceInRange(trip('S1', 8), network, range)).toBe(0);
  });

  it('**24 時をまたぐ範囲も扱える**（時刻は 24 時を超える）', () => {
    const late = trip('S1', 23, 30);
    const range = { from: fromHM(22, 0), to: fromHM(25, 0) };

    expect(tripDistanceInRange(late, network, range)).toBe(9800);
  });

  it('知らないパターンは分からない', () => {
    expect(tripDistanceInRange({ ...trip('S1', 8), patternId: '無い' }, network, null)).toBeNull();
  });

  it('時刻が未入力の便は範囲で数えられない', () => {
    const range = { from: fromHM(7, 0), to: fromHM(22, 0) };
    expect(tripDistanceInRange(trip('S1', 8, 0, { anchor: null }), network, range)).toBe(0);
  });

  it('**距離の分からない区間があれば分からない**（0 として足さない）', () => {
    const withoutDistances = loadNetworkDef(
      JSON.stringify({
        ...network.def,
        version: 1,
        segments: network.def.segments.map(({ distanceMeters: _drop, ...rest }) => rest),
      }),
    );
    if (!withoutDistances.ok) throw new Error('組み立てられません');

    expect(tripDistanceInRange(trip('S1', 8), withoutDistances.network, null)).toBeNull();
  });
});

describe('distanceInRange', () => {
  it('便の並びを足す', () => {
    expect(distanceInRange([trip('S1', 8), trip('T1', 9)], network, null)).toBe(9800 + 11600);
  });

  it('**1 つでも分からなければ分からない**', () => {
    const broken = { ...trip('S1', 8), patternId: '無い' };
    expect(distanceInRange([trip('S1', 8), broken], network, null)).toBeNull();
  });

  it('便が無ければ 0', () => {
    expect(distanceInRange([], network, null)).toBe(0);
  });
});
