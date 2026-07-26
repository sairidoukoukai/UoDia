/**
 * 便番号の採番の検証（T-44、仕様書 §6.1.6）。
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Trip } from '@/domain/model';
import { loadNetworkDef, type NetworkIndex } from '@/domain/network';
import { fromHM } from '@/domain/time';
import { applyTripNumbers, numberTrips } from './numbering';

const routeJsonPath = fileURLToPath(new URL('../../../data/route.json', import.meta.url));
const loaded = loadNetworkDef(readFileSync(routeJsonPath, 'utf8'));
if (!loaded.ok) throw new Error('route.json を読み込めません');
const network: NetworkIndex = loaded.network;

let counter = 0;

function trip(patternId: string, hours: number, minutes: number): Trip {
  const pattern = network.patternIndex(patternId);
  if (pattern === undefined) throw new Error(`パターン ${patternId} がありません`);
  counter += 1;
  return {
    tripId: `t${String(counter)}`,
    patternId,
    anchor: { stopId: pattern.originStopId, time: fromHM(hours, minutes) },
    blockId: '',
    tripShortName: '',
  };
}

/** 便 ID ではなく採番結果だけを見る。 */
function numbersOf(trips: readonly Trip[]): string[] {
  return applyTripNumbers(trips, network).map((t) => t.tripShortName);
}

describe('numberTrips — 方向ごとの連番', () => {
  it('吹田方面は始発時刻の昇順に E1 から振る', () => {
    const trips = [trip('S1', 8, 0), trip('S1', 9, 0), trip('S1', 10, 0)];
    expect(numbersOf(trips)).toEqual(['E1', 'E2', 'E3']);
  });

  it('豊中方面は W1 から振る', () => {
    const trips = [trip('T1', 8, 0), trip('T1', 9, 0), trip('T1', 10, 0)];
    expect(numbersOf(trips)).toEqual(['W1', 'W2', 'W3']);
  });

  it('方向ごとに独立して採番する', () => {
    const trips = [trip('S1', 8, 0), trip('T1', 8, 30), trip('S1', 9, 0), trip('T1', 9, 30)];
    expect(numbersOf(trips)).toEqual(['E1', 'W1', 'E2', 'W2']);
  });

  it('入力の並びに依存せず時刻順に振る', () => {
    const late = trip('S1', 10, 0);
    const early = trip('S1', 8, 0);
    const middle = trip('S1', 9, 0);
    const numbers = numberTrips([late, early, middle], network);
    expect(numbers.get(early.tripId)).toBe('E1');
    expect(numbers.get(middle.tripId)).toBe('E2');
    expect(numbers.get(late.tripId)).toBe('E3');
  });

  it('始発停留所が違う便も始発時刻で並べる', () => {
    // S2 は箕面学舎 8:10 発、S3 は豊中学舎 8:00 発
    const fromMinoh = trip('S2', 8, 10);
    const fromToyonaka = trip('S3', 8, 0);
    const numbers = numberTrips([fromMinoh, fromToyonaka], network);
    expect(numbers.get(fromToyonaka.tripId)).toBe('E1');
    expect(numbers.get(fromMinoh.tripId)).toBe('E2');
  });

  it('同時刻の便があっても採番が決定的である', () => {
    const a = { ...trip('S1', 8, 0), tripId: 'a' };
    const b = { ...trip('S1', 8, 0), tripId: 'b' };
    expect(numberTrips([b, a], network).get('a')).toBe('E1');
    expect(numberTrips([a, b], network).get('a')).toBe('E1');
  });

  it('便が無ければ何も返さない', () => {
    expect(numberTrips([], network).size).toBe(0);
  });
});

describe('numberTrips — 採番しない便', () => {
  it('**回送便には番号を振らない**（利用者向けの番号であるため）', () => {
    const trips = [trip('DT-out', 7, 0), trip('S1', 8, 0), trip('DT-in', 9, 0)];
    expect(numbersOf(trips)).toEqual(['', 'E1', '']);
  });

  it('回送便は営業便の連番に影響しない', () => {
    const trips = [trip('S1', 8, 0), trip('DS-out', 8, 30), trip('S1', 9, 0)];
    expect(numbersOf(trips)).toEqual(['E1', '', 'E2']);
  });

  it('時刻が未入力の便には番号を振らない', () => {
    const empty: Trip = { ...trip('S1', 8, 0), anchor: null };
    expect(numbersOf([empty])).toEqual(['']);
  });

  it('未入力の便は連番を飛ばさない', () => {
    const empty: Trip = { ...trip('S1', 8, 30), anchor: null };
    expect(numbersOf([trip('S1', 8, 0), empty, trip('S1', 9, 0)])).toEqual(['E1', '', 'E2']);
  });

  it('パターンが解決できない便には番号を振らない', () => {
    const broken = { ...trip('S1', 8, 0), patternId: 'なにこれ' };
    expect(numbersOf([broken])).toEqual(['']);
  });

  it('時刻が範囲を外れる便には番号を振らない', () => {
    const broken: Trip = { ...trip('T3', 8, 0), anchor: { stopId: '1_0', time: fromHM(0, 0) } };
    expect(numbersOf([broken])).toEqual(['']);
  });
});

describe('applyTripNumbers — 振り直し', () => {
  it('便を追加すると番号が時刻順に詰め直される', () => {
    const first = trip('S1', 8, 0);
    const third = trip('S1', 10, 0);
    expect(numbersOf([first, third])).toEqual(['E1', 'E2']);

    // あとから間に便を挟むと、後ろの便の番号が繰り下がる
    const second = trip('S1', 9, 0);
    expect(numbersOf([first, third, second])).toEqual(['E1', 'E3', 'E2']);
  });

  it('便を削除すると番号が詰まる', () => {
    const a = trip('S1', 8, 0);
    const b = trip('S1', 9, 0);
    const c = trip('S1', 10, 0);
    expect(numbersOf([a, c])).toEqual(['E1', 'E2']);
    expect(numbersOf([a, b, c])).toEqual(['E1', 'E2', 'E3']);
  });

  it('**既存の番号を見ない**（採番は導出であり履歴に依存しない）', () => {
    const withOldNumbers = [
      { ...trip('S1', 8, 0), tripShortName: 'E99' },
      { ...trip('S1', 9, 0), tripShortName: 'まちがい' },
    ];
    expect(numbersOf(withOldNumbers)).toEqual(['E1', 'E2']);
  });

  it('番号が付かなくなった便の番号は空文字に戻す', () => {
    // 時刻を消した便に、前回の番号が残ってはならない
    const stale: Trip = { ...trip('S1', 8, 0), anchor: null, tripShortName: 'E1' };
    expect(numbersOf([stale])).toEqual(['']);
  });

  it('元の便を書き換えない', () => {
    const original = trip('S1', 8, 0);
    applyTripNumbers([original], network);
    expect(original.tripShortName).toBe('');
  });

  it('便番号以外は変えない', () => {
    const original = trip('S1', 8, 0);
    const [applied] = applyTripNumbers([original], network);
    expect(applied).toEqual({ ...original, tripShortName: 'E1' });
  });
});
