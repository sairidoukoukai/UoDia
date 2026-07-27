/**
 * 便の操作の検証（T-21、仕様書 §6.1.4）。
 *
 * 受入条件は 2 つ。
 *
 * 1. 各操作が Undo で戻る — 履歴に載せる側（`store/store.ts`）の話であるため、
 *    ここでは**引数を書き換えない**ことと、**何も変わらなければ同じ参照を返す**
 *    ことを確かめる。前者が破れると undo が効かず、後者が破れると「押しても
 *    何も起きない undo」が積み上がる。
 * 2. パターン変更でアンカー停留所が失われるケースが正しく処理される。
 *
 * 実データ（`data/route.json`）で試す。合成データだと「箕面を通らない
 * パターンへ変える」のような、失われ方の実例を作れない。
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { NetworkDef, Trip } from '@/domain/model';
import { buildNetworkIndex, loadNetworkDef, type NetworkIndex } from '@/domain/network';
import { fromHM } from '@/domain/time';
import { originTime, timeAt } from '@/domain/trip';
import {
  addTrip,
  changeTripsPattern,
  copyTripsToService,
  defaultPatternId,
  duplicateTrips,
  removeTrips,
  shiftTrips,
  sortTripsByOrigin,
  tripIdMinter,
} from './operations';

const routeJsonPath = fileURLToPath(new URL('../../../data/route.json', import.meta.url));
const loaded = loadNetworkDef(readFileSync(routeJsonPath, 'utf8'));
if (!loaded.ok) throw new Error('route.json を読み込めません');
const network: NetworkIndex = loaded.network;

const TOYONAKA = '1_0';
const MINOH = '2_0';
const ENGINEERING = '4_0';

function makeTrip(
  tripId: string,
  patternId: string,
  hm: readonly [number, number] | null = null,
  extra: Partial<Trip> = {},
): Trip {
  const pattern = network.patternIndex(patternId);
  if (pattern === undefined) throw new Error(`パターン ${patternId} がありません`);
  return {
    tripId,
    patternId,
    anchor: hm === null ? null : { stopId: pattern.originStopId, time: fromHM(hm[0], hm[1]) },
    blockId: '',
    tripShortName: '',
    ...extra,
  };
}

/** 便の並びを ID で表す。 */
const ids = (trips: readonly Trip[]): string[] => trips.map((trip) => trip.tripId);

describe('便 ID の採番', () => {
  it('何も無ければ t1 から始まる', () => {
    const mint = tripIdMinter([]);
    expect([mint(), mint(), mint()]).toEqual(['t1', 't2', 't3']);
  });

  it('**既存の番号の次から配る**（同じ ID を 2 度作らない）', () => {
    const mint = tripIdMinter([makeTrip('t1', 'S1'), makeTrip('t7', 'S1'), makeTrip('t3', 'S1')]);
    expect([mint(), mint()]).toEqual(['t8', 't9']);
  });

  it('形の違う ID は番号として数えないが、避けられる', () => {
    const mint = tripIdMinter([makeTrip('sample-9', 'S1'), makeTrip('toyonaka', 'S1')]);
    expect(mint()).toBe('t1');
  });
});

describe('既定パターン', () => {
  it('定義が指した既定を使う（R-05）', () => {
    expect(defaultPatternId(network, 0)).toBe('S3');
    expect(defaultPatternId(network, 1)).toBe('T3');
  });

  it('既定が無ければ null（R-05 を満たさない定義）', () => {
    const def: NetworkDef = {
      ...network.def,
      patterns: network.def.patterns.map((pattern) => ({ ...pattern, isDefault: false })),
    };
    expect(defaultPatternId(buildNetworkIndex(def), 0)).toBeNull();
  });
});

describe('便の追加', () => {
  it('**時刻の入っていない便が末尾に加わる**', () => {
    const trips = [makeTrip('t1', 'S1', [8, 0])];
    const result = addTrip(trips, 'S3', network);
    if (result === null) throw new Error('追加できるはず');

    expect(ids(result.trips)).toEqual(['t1', 't2']);
    expect(result.added).toEqual([
      { tripId: 't2', patternId: 'S3', anchor: null, blockId: '', tripShortName: '' },
    ]);
  });

  it('元の配列を書き換えない', () => {
    const trips = [makeTrip('t1', 'S1', [8, 0])];
    addTrip(trips, 'S3', network);
    expect(trips).toHaveLength(1);
  });

  it('知らないパターンでは作らない', () => {
    expect(addTrip([], '無い', network)).toBeNull();
  });

  it('**別のダイヤの便とも ID がぶつからない**', () => {
    const other = [makeTrip('t5', 'S1', [8, 0])];
    const result = addTrip([], 'S1', network, other);
    expect(result?.added[0]?.tripId).toBe('t6');
  });
});

describe('便の複製', () => {
  it('**元のすぐ後ろに入る**（末尾へ飛ばさない）', () => {
    const trips = [makeTrip('t1', 'S1', [8, 0]), makeTrip('t2', 'S1', [9, 0])];
    const result = duplicateTrips(trips, ['t1'], 5, network);
    expect(ids(result?.trips ?? [])).toEqual(['t1', 't3', 't2']);
  });

  it('指定した分だけずれる', () => {
    const trips = [makeTrip('t1', 'S1', [8, 0])];
    const result = duplicateTrips(trips, ['t1'], 15, network);
    const copy = result?.added[0];
    expect(copy?.anchor).toEqual({ stopId: TOYONAKA, time: fromHM(8, 15) });
  });

  it('**運用番号は引き継ぎ、便番号は捨てる**', () => {
    const trips = [makeTrip('t1', 'S1', [8, 0], { blockId: 'A', tripShortName: 'E1' })];
    const copy = duplicateTrips(trips, ['t1'], 5, network)?.added[0];

    expect(copy?.blockId).toBe('A');
    expect(copy?.tripShortName).toBe('');
  });

  it('複数選ぶと、それぞれの隣に入る', () => {
    const trips = [
      makeTrip('t1', 'S1', [8, 0]),
      makeTrip('t2', 'S1', [9, 0]),
      makeTrip('t3', 'S1', [10, 0]),
    ];
    const result = duplicateTrips(trips, ['t1', 't3'], 5, network);
    expect(ids(result?.trips ?? [])).toEqual(['t1', 't4', 't2', 't3', 't5']);
  });

  it('時刻が未入力の便は、未入力のまま複製する', () => {
    const trips = [makeTrip('t1', 'S1')];
    const copy = duplicateTrips(trips, ['t1'], 5, network)?.added[0];
    expect(copy?.anchor).toBeNull();
  });

  it('**5 分の倍数でないシフトは断る**（5 分格子を壊さない）', () => {
    const trips = [makeTrip('t1', 'S1', [8, 0])];
    expect(duplicateTrips(trips, ['t1'], 3, network)).toBeNull();
    expect(duplicateTrips(trips, ['t1'], 2.5, network)).toBeNull();
  });

  it('表せる範囲を外れる複製は断る', () => {
    const trips = [makeTrip('t1', 'S1', [47, 20])];
    expect(duplicateTrips(trips, ['t1'], 10, network)).toBeNull();
  });

  it('選ばれていなければ何もしない', () => {
    expect(duplicateTrips([makeTrip('t1', 'S1', [8, 0])], [], 5, network)).toBeNull();
  });

  it('別のダイヤの便とも ID がぶつからない', () => {
    const trips = [makeTrip('t1', 'S1', [8, 0])];
    const result = duplicateTrips(trips, ['t1'], 5, network, [...trips, makeTrip('t9', 'S1')]);
    expect(result?.added[0]?.tripId).toBe('t10');
  });
});

describe('ダイヤ間コピー', () => {
  const source = [makeTrip('t1', 'S1', [8, 0], { blockId: 'A', tripShortName: 'E1' })];

  it('**時刻はそのまま写し先の末尾に付く**', () => {
    const target = [makeTrip('t2', 'S3', [7, 0])];
    const result = copyTripsToService(source, target, ['t1']);

    expect(ids(result?.trips ?? [])).toEqual(['t2', 't3']);
    expect(result?.added[0]?.anchor).toEqual({ stopId: TOYONAKA, time: fromHM(8, 0) });
    expect(result?.added[0]?.blockId).toBe('A');
    expect(result?.added[0]?.tripShortName).toBe('');
  });

  it('**ID は写し元とも写し先ともぶつからない**（GTFS の trip_id は全体で一意）', () => {
    const target = [makeTrip('t9', 'S3', [7, 0])];
    expect(copyTripsToService(source, target, ['t1'])?.added[0]?.tripId).toBe('t10');
  });

  it('写し元は変わらない', () => {
    copyTripsToService(source, [], ['t1']);
    expect(source).toHaveLength(1);
  });

  it('選ばれていなければ何もしない', () => {
    expect(copyTripsToService(source, [], [])).toBeNull();
  });
});

describe('便の削除', () => {
  it('選んだ便が消える', () => {
    const trips = [makeTrip('t1', 'S1'), makeTrip('t2', 'S1'), makeTrip('t3', 'S1')];
    expect(ids(removeTrips(trips, ['t1', 't3']))).toEqual(['t2']);
  });

  it('**消すものが無ければ同じ配列を返す**（空の undo を積まない）', () => {
    const trips = [makeTrip('t1', 'S1')];
    expect(removeTrips(trips, ['無い'])).toBe(trips);
    expect(removeTrips(trips, [])).toBe(trips);
  });
});

describe('パターンの変更', () => {
  it('アンカー停留所が新しいパターンにもあれば、そのまま引き継ぐ', () => {
    const trips = [makeTrip('t1', 'S1', [8, 0])];
    const next = changeTripsPattern(trips, ['t1'], 'S3', network);

    expect(next?.[0]?.patternId).toBe('S3');
    expect(next?.[0]?.anchor).toEqual({ stopId: TOYONAKA, time: fromHM(8, 0) });
  });

  it('**アンカー停留所が失われる場合は、新パターンの始発へ移り、始発時刻を引き継ぐ**', () => {
    // 箕面学舎を基準にした S3（箕面経由）の便を、箕面を通らない S1 へ変える。
    const trip = makeTrip('t1', 'S3', [8, 0], { anchor: { stopId: MINOH, time: fromHM(8, 20) } });
    const before = originTime(trip, network);

    const next = changeTripsPattern([trip], ['t1'], 'S1', network);
    const changed = next?.[0];
    if (changed === undefined) throw new Error('変更できるはず');

    expect(changed.anchor?.stopId).toBe(TOYONAKA);
    expect(changed.anchor?.time).toBe(before);
    expect(timeAt(changed, MINOH, network)).toBeNull();
  });

  it('時刻が未入力の便は、経路だけが変わる', () => {
    const next = changeTripsPattern([makeTrip('t1', 'S1')], ['t1'], 'S3', network);
    expect(next?.[0]?.patternId).toBe('S3');
    expect(next?.[0]?.anchor).toBeNull();
  });

  it('選んだ便だけを変える', () => {
    const trips = [makeTrip('t1', 'S1', [8, 0]), makeTrip('t2', 'S1', [9, 0])];
    const next = changeTripsPattern(trips, ['t2'], 'S3', network);

    expect(next?.[0]).toBe(trips[0]);
    expect(next?.[1]?.patternId).toBe('S3');
  });

  it('知らないパターンには変えない', () => {
    expect(changeTripsPattern([makeTrip('t1', 'S1')], ['t1'], '無い', network)).toBeNull();
  });

  it('**1 つでも変えられなければ、どれも変えない**', () => {
    // t2 は参照が壊れており、引き継ぐべき始発時刻を出せない。M2（豊中→箕面）は
    // 工学部前を通らないため、アンカーの置き場所も決められない。
    const trips = [
      makeTrip('t1', 'S1', [8, 0]),
      {
        ...makeTrip('t2', 'S1', [9, 0]),
        patternId: '壊',
        anchor: { stopId: ENGINEERING, time: fromHM(9, 30) },
      },
    ];
    expect(changeTripsPattern(trips, ['t1', 't2'], 'M2', network)).toBeNull();
  });

  it('既に同じパターンなら同じ配列を返す', () => {
    const trips = [makeTrip('t1', 'S1', [8, 0])];
    expect(changeTripsPattern(trips, ['t1'], 'S1', network)).toBe(trips);
    expect(changeTripsPattern(trips, [], 'S3', network)).toBe(trips);
  });
});

describe('一括シフト', () => {
  it('選んだ便だけがずれる', () => {
    const trips = [makeTrip('t1', 'S1', [8, 0]), makeTrip('t2', 'S1', [9, 0])];
    const next = shiftTrips(trips, ['t1'], 10, network);

    expect(next?.[0]?.anchor?.time).toBe(fromHM(8, 10));
    expect(next?.[1]).toBe(trips[1]);
  });

  it('負の分だけ戻せる', () => {
    const trips = [makeTrip('t1', 'S1', [8, 0])];
    expect(shiftTrips(trips, ['t1'], -15, network)?.[0]?.anchor?.time).toBe(fromHM(7, 45));
  });

  it('**アンカーだけが動く**（スジの傾きは変わらない）', () => {
    const trip = makeTrip('t1', 'S1', [8, 0], {
      anchor: { stopId: ENGINEERING, time: fromHM(9, 0) },
    });
    const next = shiftTrips([trip], ['t1'], 5, network)?.[0];

    expect(next?.anchor?.stopId).toBe(ENGINEERING);
    expect(timeAt(next ?? trip, TOYONAKA, network)).toBe(fromHM(8, 35));
  });

  it('**1 つでも範囲を外れれば、どれも動かない**', () => {
    const trips = [makeTrip('t1', 'S1', [8, 0]), makeTrip('t2', 'S1', [47, 20])];
    expect(shiftTrips(trips, ['t1', 't2'], 10, network)).toBeNull();
  });

  it('5 分の倍数でないシフトは断る', () => {
    const trips = [makeTrip('t1', 'S1', [8, 0])];
    expect(shiftTrips(trips, ['t1'], 1, network)).toBeNull();
  });

  it('時刻が未入力の便は、選ばれていても動かない', () => {
    const trips = [makeTrip('t1', 'S1')];
    expect(shiftTrips(trips, ['t1'], 5, network)).toBe(trips);
  });

  it('0 分と空の選択は同じ配列を返す', () => {
    const trips = [makeTrip('t1', 'S1', [8, 0])];
    expect(shiftTrips(trips, ['t1'], 0, network)).toBe(trips);
    expect(shiftTrips(trips, [], 5, network)).toBe(trips);
  });
});

describe('始発時刻順の並べ替え', () => {
  it('昇順に並ぶ', () => {
    const trips = [
      makeTrip('t1', 'S1', [10, 0]),
      makeTrip('t2', 'S1', [8, 0]),
      makeTrip('t3', 'S1', [9, 0]),
    ];
    expect(ids(sortTripsByOrigin(trips, network))).toEqual(['t2', 't3', 't1']);
  });

  it('**時刻を出せない便は末尾へ回し、元の並びを保つ**', () => {
    const trips = [
      makeTrip('t1', 'S1'),
      makeTrip('t2', 'S1', [9, 0]),
      { ...makeTrip('t3', 'S1'), patternId: '壊' },
      makeTrip('t4', 'S1', [8, 0]),
    ];
    expect(ids(sortTripsByOrigin(trips, network))).toEqual(['t4', 't2', 't1', 't3']);
  });

  it('同時刻の便は元の並びのまま', () => {
    const trips = [makeTrip('t1', 'S1', [8, 0]), makeTrip('t2', 'S1', [8, 0])];
    expect(ids(sortTripsByOrigin(trips, network))).toEqual(['t1', 't2']);
  });

  it('方向をまたいで始発時刻だけで並べる', () => {
    // T1 は工学部前 8:00 発、S1 は豊中学舎 9:00 発。
    const trips = [makeTrip('t1', 'S1', [9, 0]), makeTrip('t2', 'T1', [8, 0])];
    expect(ids(sortTripsByOrigin(trips, network))).toEqual(['t2', 't1']);
  });

  it('**既に整列していれば同じ配列を返す**', () => {
    const trips = [makeTrip('t1', 'S1', [8, 0]), makeTrip('t2', 'S1', [9, 0])];
    expect(sortTripsByOrigin(trips, network)).toBe(trips);
  });
});
