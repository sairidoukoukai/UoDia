/**
 * 選択に時刻表を追随させる検証（T-38、仕様書 §6.3.1）。
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Trip } from '@/domain/model';
import { loadNetworkDef, type NetworkIndex } from '@/domain/network';
import { fromHM } from '@/domain/time';
import { directionToShow } from './sync';

const routeJsonPath = fileURLToPath(new URL('../../../data/route.json', import.meta.url));
const loaded = loadNetworkDef(readFileSync(routeJsonPath, 'utf8'));
if (!loaded.ok) throw new Error('route.json を読み込めません');
const network: NetworkIndex = loaded.network;

function trip(tripId: string, patternId: string): Trip {
  const pattern = network.patternIndex(patternId);
  if (pattern === undefined) throw new Error(`パターン ${patternId} がありません`);
  return {
    tripId,
    patternId,
    anchor: { stopId: pattern.originStopId, time: fromHM(8, 0) },
    blockId: 'A',
    pullOut: false,
    pullIn: false,
  };
}

/** S1 は吹田方面（0）、T1 は豊中方面（1）。 */
const SUITA = trip('t1', 'S1');
const TOYONAKA = trip('t2', 'T1');

describe('開く方向', () => {
  it('選ばれた便が別の方向なら、その方向を開く', () => {
    expect(directionToShow([TOYONAKA], 0, network)).toBe(1);
    expect(directionToShow([SUITA], 1, network)).toBe(0);
  });

  it('**今の方向に 1 本でもあるなら動かさない**（見比べている画面を飛ばさない）', () => {
    expect(directionToShow([SUITA], 0, network)).toBeNull();
    expect(directionToShow([SUITA, TOYONAKA], 0, network)).toBeNull();
    expect(directionToShow([SUITA, TOYONAKA], 1, network)).toBeNull();
  });

  it('選択が空なら動かさない', () => {
    expect(directionToShow([], 0, network)).toBeNull();
  });

  it('方向の分からない便は数えない（壊れた参照で画面を飛ばさない）', () => {
    const broken: Trip = { ...SUITA, patternId: 'missing' };
    expect(directionToShow([broken], 0, network)).toBeNull();
  });

  it('**切り替えたあとは動かない**（循環しない。受入条件）', () => {
    const next = directionToShow([TOYONAKA], 0, network);
    if (next === null) throw new Error('切り替わっていません');

    expect(directionToShow([TOYONAKA], next, network)).toBeNull();
  });
});
