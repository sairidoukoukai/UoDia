/**
 * 運用の中の前後関係の検証（T-50、仕様書 §6.1.7）。
 *
 * 時刻表の前運用・後運用の欄は、ここが返す値をそのまま映す。**一度入区して
 * から再び出区する運用**が正しく並ぶことを、実データの回送で確かめる。
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Trip } from '@/domain/model';
import { loadNetworkDef, type NetworkIndex } from '@/domain/network';
import { fromHM } from '@/domain/time';
import { blockNeighbors, neighborsOf } from './neighbors';

const routeJsonPath = fileURLToPath(new URL('../../../data/route.json', import.meta.url));
const loaded = loadNetworkDef(readFileSync(routeJsonPath, 'utf8'));
if (!loaded.ok) throw new Error('route.json を読み込めません');
const network: NetworkIndex = loaded.network;

function makeTrip(
  tripId: string,
  patternId: string,
  hm: readonly [number, number] | null,
  blockId = 'A',
): Trip {
  const pattern = network.patternIndex(patternId);
  if (pattern === undefined) throw new Error(`パターン ${patternId} がありません`);
  return {
    tripId,
    patternId,
    anchor: hm === null ? null : { stopId: pattern.originStopId, time: fromHM(hm[0], hm[1]) },
    blockId,
  };
}

/** 前後の便 ID を読みやすい形にする。 */
function around(trips: readonly Trip[], tripId: string): [string | null, string | null] {
  const { previous, next } = neighborsOf(blockNeighbors(trips, network), tripId);
  return [previous?.tripId ?? null, next?.tripId ?? null];
}

describe('運用の中の前後', () => {
  it('始発時刻の順に前後が決まる', () => {
    const trips = [
      makeTrip('t2', 'T1', [8, 40]),
      makeTrip('t1', 'S1', [8, 0]),
      makeTrip('t3', 'S1', [9, 20]),
    ];
    expect(around(trips, 't1')).toEqual([null, 't2']);
    expect(around(trips, 't2')).toEqual(['t1', 't3']);
    expect(around(trips, 't3')).toEqual(['t2', null]);
  });

  it('**運用が違えば繋がらない**', () => {
    const trips = [makeTrip('t1', 'S1', [8, 0], 'A'), makeTrip('t2', 'T1', [8, 40], 'B')];
    expect(around(trips, 't1')).toEqual([null, null]);
    expect(around(trips, 't2')).toEqual([null, null]);
  });

  it('運用番号が空欄の便は前後を持たない', () => {
    const trips = [makeTrip('t1', 'S1', [8, 0], ''), makeTrip('t2', 'T1', [8, 40], '')];
    expect(around(trips, 't1')).toEqual([null, null]);
  });

  it('時刻が未入力の便は行路に並ばない', () => {
    const trips = [makeTrip('t1', 'S1', null), makeTrip('t2', 'T1', [8, 40])];
    expect(around(trips, 't1')).toEqual([null, null]);
    expect(around(trips, 't2')).toEqual([null, null]);
  });

  it('表に無い便を尋ねても落ちない', () => {
    expect(around([], '無い')).toEqual([null, null]);
  });
});

describe('出区・入区を挟んだ運用', () => {
  /**
   * 車庫 7:40 発 → 豊中 8:00 → 工学部前 8:30 → 車庫 8:50 入区、
   * 昼に 13:40 出庫 → 豊中 14:00 → 工学部前 14:30。
   */
  const trips = [
    makeTrip('out1', 'DT-out', [7, 40]),
    makeTrip('e1', 'S1', [8, 0]),
    makeTrip('in1', 'DS-in', [8, 30]),
    makeTrip('out2', 'DT-out', [13, 40]),
    makeTrip('e2', 'S1', [14, 0]),
  ];

  it('営業便の前後に回送が並ぶ', () => {
    expect(around(trips, 'e1')).toEqual(['out1', 'in1']);
  });

  it('**一度入区してから再び出区する運用が表せる**', () => {
    expect(around(trips, 'in1')).toEqual(['e1', 'out2']);
    expect(around(trips, 'out2')).toEqual(['in1', 'e2']);
    expect(around(trips, 'e2')).toEqual(['out2', null]);
  });

  it('先頭の出区には前が無い', () => {
    expect(around(trips, 'out1')).toEqual([null, 'e1']);
  });
});
