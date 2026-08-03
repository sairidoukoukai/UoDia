/**
 * 回送便の展開の検証（T-51、仕様書 §6.1.7）。
 *
 * 0 分折返しの制約により、展開される回送便には決めるものが残らない。
 * **接する停留所と時刻が一致すること**と、**アンカーが接点に置かれること**を
 * 確かめる。後者が破れると、区間所要時間を改定したときに継ぎ目がずれる。
 *
 * あわせて、営業便を動かしたときに回送が**ひとりでに追随する**ことを見る。
 * これが導出値に改めた理由そのものである。
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Trip } from '@/domain/model';
import { buildNetworkIndex, loadNetworkDef, type NetworkIndex } from '@/domain/network';
import { fromHM } from '@/domain/time';
import {
  createPullIn,
  createPullOut,
  expandDeadheads,
  pullInPatternFor,
  pullOutPatternFor,
  sourceTripId,
} from './deadhead';
import { originTime, terminalTime } from './times';

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
    pullOut: false,
    pullIn: false,
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
    // 回送パターンをすべて外した定義。R-11 に反するため `loadNetworkDef` は
    // 通らない（それがこの規則の役目である）。索引だけを直接組んで確かめる。
    const withoutDeadheads = buildNetworkIndex({
      ...network.def,
      patterns: network.def.patterns.filter((p) => !p.isDeadhead),
    });

    expect(pullOutPatternFor(makeTrip('S1'), withoutDeadheads)).toBeNull();
    expect(pullInPatternFor(makeTrip('S1'), withoutDeadheads)).toBeNull();
  });
});

describe('出区の回送便を作る', () => {
  it('**接する停留所と時刻でアンカーを置く**（0 分折返し）', () => {
    const pullOut = createPullOut(makeTrip('S1', [8, 0]), network);

    expect(pullOut).toEqual({
      tripId: 't1#out',
      patternId: 'DT-out',
      anchor: { stopId: TOYONAKA, time: fromHM(8, 0) },
      blockId: 'A',
      pullOut: false,
      pullIn: false,
    });
  });

  it('**車庫を出る時刻は所要時間から導出される**（20 分前）', () => {
    const pullOut = createPullOut(makeTrip('S1', [8, 0]), network);
    if (pullOut === null) throw new Error('作れるはず');

    expect(originTime(pullOut, network)).toBe(fromHM(7, 40));
    expect(terminalTime(pullOut, network)).toBe(fromHM(8, 0));
  });

  it('運用番号を引き継ぐ', () => {
    const trip: Trip = { ...makeTrip('S1'), blockId: 'B' };
    expect(createPullOut(trip, network)?.blockId).toBe('B');
  });

  it('箕面学舎発の便には車庫発箕面が付く', () => {
    const pullOut = createPullOut(makeTrip('S2', [8, 10]), network);
    expect(pullOut?.patternId).toBe('DM-out');
    expect(pullOut?.anchor).toEqual({ stopId: MINOH, time: fromHM(8, 10) });
  });

  it('時刻が未入力の便には作れない', () => {
    expect(createPullOut(makeTrip('S1', null), network)).toBeNull();
  });

  it('**車庫発が 0:00 より前になる便には作れない**', () => {
    // 0:10 発の便の出区は前日 23:50 となり、表せない。
    expect(createPullOut(makeTrip('S1', [0, 10]), network)).toBeNull();
  });

  it('参照が壊れた便には作れない', () => {
    const broken: Trip = { ...makeTrip('S1'), patternId: '無い' };
    expect(createPullOut(broken, network)).toBeNull();
  });
});

describe('入区の回送便を作る', () => {
  it('**終着の停留所と時刻でアンカーを置く**（0 分発車）', () => {
    // S1 は豊中学舎 8:00 発、工学部前 8:30 着。
    const pullIn = createPullIn(makeTrip('S1', [8, 0]), network);

    expect(pullIn?.tripId).toBe('t1#in');
    expect(pullIn?.patternId).toBe('DS-in');
    expect(pullIn?.anchor).toEqual({ stopId: ENGINEERING, time: fromHM(8, 30) });
  });

  it('車庫に着く時刻は所要時間から導出される（20 分後）', () => {
    const pullIn = createPullIn(makeTrip('S1', [8, 0]), network);
    if (pullIn === null) throw new Error('作れるはず');

    expect(originTime(pullIn, network)).toBe(fromHM(8, 30));
    expect(terminalTime(pullIn, network)).toBe(fromHM(8, 50));
  });

  it('**車庫着が 47:55 を超える便には作れない**', () => {
    expect(createPullIn(makeTrip('S1', [47, 20]), network)).toBeNull();
  });

  it('時刻が未入力の便には作れない', () => {
    expect(createPullIn(makeTrip('S1', null), network)).toBeNull();
  });

  it('参照が壊れた便には作れない', () => {
    const broken: Trip = { ...makeTrip('S1'), patternId: '無い' };
    expect(createPullIn(broken, network)).toBeNull();
  });
});

describe('出区と入区が繋がる', () => {
  it('**出区の終着・入区の始発が営業便と一致する**（V-01 を満たす）', () => {
    const trip = makeTrip('S1', [8, 0]);
    const pullOut = createPullOut(trip, network);
    const pullIn = createPullIn(trip, network);
    if (pullOut === null || pullIn === null) throw new Error('作れるはず');

    expect(terminalTime(pullOut, network)).toBe(originTime(trip, network));
    expect(originTime(pullIn, network)).toBe(terminalTime(trip, network));
  });

  it('車庫側の停留所は営業所である', () => {
    const pullOut = createPullOut(makeTrip('S1'), network);
    expect(network.patternIndex(pullOut?.patternId ?? '')?.originStopId).toBe(DEPOT);
  });
});

describe('便の並びに展開する', () => {
  /** 展開した並びを「パターン:始発時刻」で表す。 */
  function expanded(trips: readonly Trip[]): string[] {
    return expandDeadheads(trips, network).map(
      (trip) => `${trip.patternId}:${String(originTime(trip, network) ?? -1)}`,
    );
  }

  it('**フラグが立っていなければ何も増えない**', () => {
    const trips = [makeTrip('S1', [8, 0])];
    expect(expandDeadheads(trips, network)).toEqual(trips);
  });

  it('出区は前に、入区は後ろに並ぶ', () => {
    const trip: Trip = { ...makeTrip('S1', [8, 0]), pullOut: true, pullIn: true };

    expect(expanded([trip])).toEqual([
      `DT-out:${String(fromHM(7, 40))}`,
      `S1:${String(fromHM(8, 0))}`,
      `DS-in:${String(fromHM(8, 30))}`,
    ]);
  });

  it('**展開した回送は出区も入区も持たない**（回送の回送は無い）', () => {
    const trip: Trip = { ...makeTrip('S1', [8, 0]), pullOut: true, pullIn: true };
    for (const expandedTrip of expandDeadheads([trip], network)) {
      if (expandedTrip.tripId === trip.tripId) continue;
      expect(expandedTrip.pullOut).toBe(false);
      expect(expandedTrip.pullIn).toBe(false);
    }
  });

  it('作れない回送は落ちる（V-04 が拾う）', () => {
    const trip: Trip = { ...makeTrip('S1', null), pullOut: true, pullIn: true };
    expect(expandDeadheads([trip], network)).toEqual([trip]);
  });
});

describe('**営業便を動かすと回送も動く**', () => {
  /** その便の出区が車庫を出る時刻。 */
  function departure(trip: Trip): number | null {
    const pullOut = createPullOut(trip, network);
    return pullOut === null ? null : originTime(pullOut, network);
  }

  it('時刻をずらすと同じだけ動く', () => {
    expect(departure(makeTrip('S1', [8, 0]))).toBe(fromHM(7, 40));
    expect(departure(makeTrip('S1', [9, 0]))).toBe(fromHM(8, 40));
  });

  it('**パターンを変えると繋がる回送も変わる**', () => {
    // S1 は豊中学舎発、S2 は箕面学舎発。
    expect(createPullOut(makeTrip('S1'), network)?.patternId).toBe('DT-out');
    expect(createPullOut(makeTrip('S2'), network)?.patternId).toBe('DM-out');
  });
});

describe('展開した便の指し先', () => {
  it('**展開元の営業便に戻せる**', () => {
    const trip: Trip = { ...makeTrip('S1', [8, 0]), pullOut: true, pullIn: true };
    for (const expandedTrip of expandDeadheads([trip], network)) {
      expect(sourceTripId(expandedTrip.tripId)).toBe('t1');
    }
  });

  it('営業便の ID はそのまま返る', () => {
    expect(sourceTripId('t1')).toBe('t1');
  });
});
