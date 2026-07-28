/**
 * 出区・入区の検証（T-50、仕様書 §6.1.7）。
 *
 * 0 分折返しの制約により、作られる回送便には決めるものが残らない。
 * **接する停留所と時刻が一致すること**と、**アンカーが接点に置かれること**を
 * 確かめる。後者が破れると、区間所要時間を改定したときに継ぎ目がずれる。
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Trip } from '@/domain/model';
import { loadNetworkDef, type NetworkIndex } from '@/domain/network';
import { fromHM } from '@/domain/time';
import { originTime, terminalTime } from '@/domain/trip';
import { createPullIn, createPullOut, pullInPatternFor, pullOutPatternFor } from './deadhead';

const routeJsonPath = fileURLToPath(new URL('../../../data/route.json', import.meta.url));
const loaded = loadNetworkDef(readFileSync(routeJsonPath, 'utf8'));
if (!loaded.ok) throw new Error('route.json を読み込めません');
const network: NetworkIndex = loaded.network;

const TOYONAKA = '1_0';
const MINOH = '2_0';
const ENGINEERING = '4_0';
const DEPOT = '9_0';

function makeTrip(patternId: string, hm: readonly [number, number] | null = [8, 0]): Trip {
  const pattern = network.patternIndex(patternId);
  if (pattern === undefined) throw new Error(`パターン ${patternId} がありません`);
  return {
    tripId: 't1',
    patternId,
    anchor: hm === null ? null : { stopId: pattern.originStopId, time: fromHM(hm[0], hm[1]) },
    blockId: 'A',
  };
}

describe('繋がる回送パターン', () => {
  it('**始発停留所から出区のパターンが一意に決まる**', () => {
    expect(pullOutPatternFor(makeTrip('S1'), network)?.patternId).toBe('DT-out'); // 豊中学舎発
    expect(pullOutPatternFor(makeTrip('S2'), network)?.patternId).toBe('DM-out'); // 箕面学舎発
    expect(pullOutPatternFor(makeTrip('T1'), network)?.patternId).toBe('DS-out'); // 工学部前発
  });

  it('**終着停留所から入区のパターンが一意に決まる**', () => {
    expect(pullInPatternFor(makeTrip('S1'), network)?.patternId).toBe('DS-in'); // 工学部前着
    expect(pullInPatternFor(makeTrip('M2'), network)?.patternId).toBe('DM-in'); // 箕面学舎着
    expect(pullInPatternFor(makeTrip('T1'), network)?.patternId).toBe('DT-in'); // 豊中学舎着
  });

  it('参照が壊れた便には決められない', () => {
    const broken: Trip = { ...makeTrip('S1'), patternId: '無い' };
    expect(pullOutPatternFor(broken, network)).toBeNull();
    expect(pullInPatternFor(broken, network)).toBeNull();
  });

  it('繋がる回送が定義に無ければ決められない', () => {
    // 回送パターンをすべて外した定義を作る。
    const withoutDeadheads = loadNetworkDef(
      JSON.stringify({
        ...network.def,
        patterns: network.def.patterns.filter((p) => !p.isDeadhead),
      }),
    );
    if (!withoutDeadheads.ok) throw new Error('読み込めるはず');

    expect(pullOutPatternFor(makeTrip('S1'), withoutDeadheads.network)).toBeNull();
    expect(pullInPatternFor(makeTrip('S1'), withoutDeadheads.network)).toBeNull();
  });
});

describe('出区の回送便を作る', () => {
  it('**接する停留所と時刻でアンカーを置く**（0 分折返し）', () => {
    const trip = makeTrip('S1', [8, 0]);
    const pullOut = createPullOut(trip, network, 'd1');

    expect(pullOut).toEqual({
      tripId: 'd1',
      patternId: 'DT-out',
      anchor: { stopId: TOYONAKA, time: fromHM(8, 0) },
      blockId: 'A',
    });
  });

  it('**車庫を出る時刻は所要時間から導出される**（20 分前）', () => {
    const pullOut = createPullOut(makeTrip('S1', [8, 0]), network, 'd1');
    if (pullOut === null) throw new Error('作れるはず');

    expect(originTime(pullOut, network)).toBe(fromHM(7, 40));
    expect(terminalTime(pullOut, network)).toBe(fromHM(8, 0));
  });

  it('運用番号を引き継ぐ', () => {
    const trip: Trip = { ...makeTrip('S1'), blockId: 'B' };
    expect(createPullOut(trip, network, 'd1')?.blockId).toBe('B');
  });

  it('箕面学舎発の便には車庫発箕面が付く', () => {
    const pullOut = createPullOut(makeTrip('S2', [8, 10]), network, 'd1');
    expect(pullOut?.patternId).toBe('DM-out');
    expect(pullOut?.anchor).toEqual({ stopId: MINOH, time: fromHM(8, 10) });
  });

  it('時刻が未入力の便には作れない', () => {
    expect(createPullOut(makeTrip('S1', null), network, 'd1')).toBeNull();
  });

  it('**車庫発が 0:00 より前になる便には作れない**', () => {
    // 0:10 発の便の出区は前日 23:50 となり、表せない。
    expect(createPullOut(makeTrip('S1', [0, 10]), network, 'd1')).toBeNull();
  });

  it('参照が壊れた便には作れない', () => {
    const broken: Trip = { ...makeTrip('S1'), patternId: '無い' };
    expect(createPullOut(broken, network, 'd1')).toBeNull();
  });
});

describe('入区の回送便を作る', () => {
  it('**終着の停留所と時刻でアンカーを置く**（0 分発車）', () => {
    // S1 は豊中学舎 8:00 発、工学部前 8:30 着。
    const pullIn = createPullIn(makeTrip('S1', [8, 0]), network, 'd2');

    expect(pullIn).toEqual({
      tripId: 'd2',
      patternId: 'DS-in',
      anchor: { stopId: ENGINEERING, time: fromHM(8, 30) },
      blockId: 'A',
    });
  });

  it('車庫に着く時刻は所要時間から導出される（20 分後）', () => {
    const pullIn = createPullIn(makeTrip('S1', [8, 0]), network, 'd2');
    if (pullIn === null) throw new Error('作れるはず');

    expect(originTime(pullIn, network)).toBe(fromHM(8, 30));
    expect(terminalTime(pullIn, network)).toBe(fromHM(8, 50));
  });

  it('**車庫着が 47:55 を超える便には作れない**', () => {
    expect(createPullIn(makeTrip('S1', [47, 20]), network, 'd2')).toBeNull();
  });

  it('時刻が未入力の便には作れない', () => {
    expect(createPullIn(makeTrip('S1', null), network, 'd2')).toBeNull();
  });

  it('参照が壊れた便には作れない', () => {
    const broken: Trip = { ...makeTrip('S1'), patternId: '無い' };
    expect(createPullIn(broken, network, 'd2')).toBeNull();
  });
});

describe('出区と入区が繋がる', () => {
  it('**出区の終着・入区の始発が営業便と一致する**（V-01 を満たす）', () => {
    const trip = makeTrip('S1', [8, 0]);
    const pullOut = createPullOut(trip, network, 'd1');
    const pullIn = createPullIn(trip, network, 'd2');
    if (pullOut === null || pullIn === null) throw new Error('作れるはず');

    expect(terminalTime(pullOut, network)).toBe(originTime(trip, network));
    expect(originTime(pullIn, network)).toBe(terminalTime(trip, network));
    expect(pullOut.anchor?.stopId).toBe(TOYONAKA);
    expect(pullIn.anchor?.stopId).toBe(ENGINEERING);
  });

  it('車庫側の停留所は営業所である', () => {
    const pullOut = createPullOut(makeTrip('S1'), network, 'd1');
    const pattern = network.patternIndex(pullOut?.patternId ?? '');
    expect(pattern?.originStopId).toBe(DEPOT);
  });
});
