/**
 * 輸送能力の検証（T-64、#162、仕様書 v1.1 §6.2）。
 *
 * 確かめるのは**何を数えて何を数えないか**である。合計そのものは掛け算で
 * しかない。
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Trip } from '@/domain/model';
import { loadNetworkDef, type NetworkIndex } from '@/domain/network';
import { fromHM } from '@/domain/time';
import {
  DEFAULT_CAPACITY,
  sectionCapacity,
  totalCapacity,
  tripCapacity,
  type PatternCapacities,
} from './capacity';

const routeJsonPath = fileURLToPath(new URL('../../../data/route.json', import.meta.url));
const loaded = loadNetworkDef(readFileSync(routeJsonPath, 'utf8'));
if (!loaded.ok) throw new Error('route.json を読み込めません');
const network: NetworkIndex = loaded.network;

const NONE: PatternCapacities = {};

let counter = 0;

function trip(patternId: string, hours: number, extra: Partial<Trip> = {}): Trip {
  const pattern = network.patternIndex(patternId);
  if (pattern === undefined) throw new Error(`パターン ${patternId} がありません`);
  counter += 1;
  return {
    tripId: `t${String(counter)}`,
    patternId,
    anchor: { stopId: pattern.originStopId, time: fromHM(hours, 0) },
    blockId: 'A',
    pullOut: false,
    pullIn: false,
    ...extra,
  };
}

describe('tripCapacity', () => {
  it('上書きが無ければ既定値', () => {
    expect(tripCapacity(trip('S1', 8), network, NONE)).toBe(DEFAULT_CAPACITY);
  });

  it('**系統ごとに上書きできる**（系統によって入る車両の型式が違う）', () => {
    expect(tripCapacity(trip('S1', 8), network, { S1: 40 })).toBe(40);
    // 上書きしていない系統は既定値のまま。
    expect(tripCapacity(trip('S3', 8), network, { S1: 40 })).toBe(DEFAULT_CAPACITY);
  });

  it('**回送は数えない**（客を乗せていない）', () => {
    expect(tripCapacity(trip('DT-out', 7), network, NONE)).toBeNull();
  });

  it('知らないパターンは数えない', () => {
    expect(tripCapacity({ ...trip('S1', 8), patternId: '無い' }, network, NONE)).toBeNull();
  });

  it('**運用番号は関わらない**（定員は系統が決める）', () => {
    // 運用番号はその文書の中だけの名前であり、定員とは無関係である。
    expect(tripCapacity(trip('S1', 8, { blockId: '' }), network, NONE)).toBe(DEFAULT_CAPACITY);
  });
});

describe('totalCapacity', () => {
  it('営業便の定員を足す', () => {
    const total = totalCapacity([trip('S1', 8), trip('T1', 9)], network, { S1: 40, T1: 60 });

    expect(total).toEqual({ seats: 100, counted: 2, skipped: 0 });
  });

  it('**回送は数にも入らない**（「数えなかった」でもない）', () => {
    const total = totalCapacity([trip('S1', 8), trip('DT-out', 7)], network, { S1: 40 });

    expect(total).toEqual({ seats: 40, counted: 1, skipped: 0 });
  });

  it('**時刻が未入力の便は数えず、件数で伝える**', () => {
    const total = totalCapacity([trip('S1', 8), trip('S1', 9, { anchor: null })], network, {
      S1: 40,
    });

    expect(total).toEqual({ seats: 40, counted: 1, skipped: 1 });
  });

  it('便が無ければ 0', () => {
    expect(totalCapacity([], network, NONE)).toEqual({ seats: 0, counted: 0, skipped: 0 });
  });
});

describe('sectionCapacity', () => {
  /** 豊中 → コンベ前（S1 が通る。S3 は箕面を挟むため通らない）。 */
  const TOYONAKA_TO_CONVE = { fromStopId: '1_0', toStopId: '3_0', range: null };

  it('その区間を続けて通る便だけを数える', () => {
    const total = sectionCapacity(
      [trip('S1', 8), trip('S3', 9)],
      network,
      { S1: 40 },
      TOYONAKA_TO_CONVE,
    );

    expect(total.counted).toBe(1);
    expect(total.seats).toBe(40);
  });

  it('**方向が違えば数えない**（区間は有向である）', () => {
    // T1 は 工学部 → 人科前 → 豊中。豊中 → コンベ前 は通らない。
    expect(sectionCapacity([trip('T1', 9)], network, NONE, TOYONAKA_TO_CONVE).counted).toBe(0);
  });

  it('**範囲に入るかはその区間を通る時刻で見る**（始発時刻ではない）', () => {
    // S3 は豊中 8:00 発、コンベ前 8:35 着。箕面 → コンベ前 を 8:20 に通る。
    const minohToConve = {
      fromStopId: '2_0',
      toStopId: '3_0',
      range: { from: fromHM(8, 15), to: fromHM(8, 25) },
    };

    expect(sectionCapacity([trip('S3', 8)], network, NONE, minohToConve).counted).toBe(1);
  });

  it('範囲の外は数えない', () => {
    const early = {
      fromStopId: '1_0',
      toStopId: '3_0',
      range: { from: fromHM(6, 0), to: fromHM(7, 0) },
    };

    expect(sectionCapacity([trip('S1', 8)], network, NONE, early).counted).toBe(0);
  });

  it('範囲が `null` なら 1 日全部', () => {
    expect(sectionCapacity([trip('S1', 8)], network, NONE, TOYONAKA_TO_CONVE).counted).toBe(1);
  });

  it('時刻が未入力の便は範囲で数えられない', () => {
    const ranged = {
      fromStopId: '1_0',
      toStopId: '3_0',
      range: { from: fromHM(7, 0), to: fromHM(22, 0) },
    };

    expect(sectionCapacity([trip('S1', 8, { anchor: null })], network, NONE, ranged).counted).toBe(
      0,
    );
  });

  it('知らないパターンは数えない', () => {
    const broken = { ...trip('S1', 8), patternId: '無い' };
    expect(sectionCapacity([broken], network, NONE, TOYONAKA_TO_CONVE).counted).toBe(0);
  });

  it('**続けて通らなければ数えない**（豊中の次はコンベ前であって工学部ではない）', () => {
    const nowhere = { fromStopId: '1_0', toStopId: '4_0', range: null };
    expect(sectionCapacity([trip('S1', 8)], network, NONE, nowhere).counted).toBe(0);
  });

  it('**そもそも通らない停留所なら数えない**（直行便は箕面を経由しない）', () => {
    const minoh = { fromStopId: '2_0', toStopId: '3_0', range: null };
    expect(sectionCapacity([trip('S1', 8)], network, NONE, minoh).counted).toBe(0);
    // 箕面を経由する S3 なら数える。
    expect(sectionCapacity([trip('S3', 8)], network, NONE, minoh).counted).toBe(1);
  });
});
