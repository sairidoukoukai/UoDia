/**
 * 飛び先の検証（T-34、仕様書 §6.6）。
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Trip } from '@/domain/model';
import { loadNetworkDef, type NetworkIndex } from '@/domain/network';
import { fromHM, SECONDS_PER_MINUTE } from '@/domain/time';
import type { ValidationIssue } from '@/domain/validation';
import { JUMP_LEAD_MINUTES, jumpTargetOf, scrollTimeFor } from './jump';

const routeJsonPath = fileURLToPath(new URL('../../../data/route.json', import.meta.url));
const loaded = loadNetworkDef(readFileSync(routeJsonPath, 'utf8'));
if (!loaded.ok) throw new Error('route.json を読み込めません');
const network: NetworkIndex = loaded.network;

function makeTrip(tripId: string, patternId: string, hours: number, blockId: string): Trip {
  const pattern = network.patternIndex(patternId);
  if (pattern === undefined) throw new Error(`パターン ${patternId} がありません`);
  return {
    tripId,
    patternId,
    anchor: { stopId: pattern.originStopId, time: fromHM(hours, 0) },
    blockId,
    pullOut: false,
    pullIn: false,
  };
}

const TRIPS: readonly Trip[] = [
  makeTrip('t1', 'S1', 8, 'A'),
  makeTrip('t2', 'T1', 9, 'A'),
  makeTrip('t3', 'S1', 10, 'B'),
];

function issue(target: ValidationIssue['target']): ValidationIssue {
  return { id: 'V-02', severity: 'error', message: '折返し時分が負', target };
}

describe('便を指す指摘', () => {
  it('その便を選び、その方向を開き、その時刻へ送る', () => {
    const target = jumpTargetOf(issue({ tripId: 't2' }), TRIPS, network);

    expect(target.tripIds).toEqual(['t2']);
    expect(target.directionId).toBe(1);
    expect(target.time).toBe(fromHM(9, 0));
  });
});

describe('運用を指す指摘', () => {
  it('**その運用の便をすべて選ぶ**（2 便の関係が問題であるため）', () => {
    const target = jumpTargetOf(issue({ blockId: 'A' }), TRIPS, network);
    expect(target.tripIds).toEqual(['t1', 't2']);
  });

  it('送り先は一番早い便に合わせる', () => {
    expect(jumpTargetOf(issue({ blockId: 'A' }), TRIPS, network).time).toBe(fromHM(8, 0));
  });
});

describe('飛べない指摘', () => {
  it('指す先が無ければ何も選ばない', () => {
    expect(jumpTargetOf(issue({}), TRIPS, network).tripIds).toEqual([]);
  });

  it('消えた便を指していても壊れない', () => {
    const target = jumpTargetOf(issue({ tripId: 'missing' }), TRIPS, network);
    expect(target).toEqual({ tripIds: [], directionId: null, time: null });
  });

  it('時刻がまだ入っていない便は送り先を持たない（V-08 が指すのはこれ）', () => {
    const unanchored: Trip = { ...makeTrip('t9', 'S1', 8, 'C'), anchor: null };
    const target = jumpTargetOf(issue({ tripId: 't9' }), [unanchored], network);

    expect(target.tripIds).toEqual(['t9']);
    expect(target.time).toBeNull();
    // 方向は分かる。時刻表のタブは切り替えられる。
    expect(target.directionId).toBe(0);
  });
});

describe('送り先', () => {
  it('**少し手前から見せる**（前の便や回送が画面に入る）', () => {
    expect(scrollTimeFor(fromHM(9, 0))).toBe(fromHM(9, 0) - JUMP_LEAD_MINUTES * SECONDS_PER_MINUTE);
  });

  it('0:00 より前へは送らない', () => {
    expect(scrollTimeFor(fromHM(0, 5))).toBe(0);
  });
});
