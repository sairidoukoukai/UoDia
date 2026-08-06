/**
 * 区間所要時間の編集の検証（T-35、仕様書 §6.5.1）。
 *
 * 受入条件のうち 3 つ——**その区間を通る便の時刻だけが変わる**、**アンカーの
 * 時刻は変わらない**、**5 の倍数でない値は受け取らない**——をここで確かめる。
 * 取り消しで戻ることは `settingsService.test.ts` が見る。
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import { createProject } from '@/domain/io';
import type { Trip } from '@/domain/model';
import { buildNetworkIndex, loadNetworkDef, segmentKey, type NetworkIndex } from '@/domain/network';
import { fromHM } from '@/domain/time';
import { allTimes } from '@/domain/trip';
import { createAppStore, selectNetwork, selectTrips, type AppStoreHook } from '@/store';
import {
  affectedTripCount,
  changedDistances,
  changedEdits,
  parseDistanceKm,
  parseRunMinutes,
  segmentRows,
  withDistances,
  withRunMinutes,
} from './segments';
import { applySegmentEdits } from './settingsService';

const routeJsonPath = fileURLToPath(new URL('../../../data/route.json', import.meta.url));
const loaded = loadNetworkDef(readFileSync(routeJsonPath, 'utf8'));
if (!loaded.ok) throw new Error('route.json を読み込めません');
const network: NetworkIndex = loaded.network;

/** 豊中学舎 → 箕面学舎。 */
const TOYONAKA_TO_MINOH = '1_0→2_0';
/** 工学部前 → 人間科学部前（豊中方面だけが通る）。 */
const ENGINEERING_TO_HUMAN = '4_0→5_0';

let store: AppStoreHook;

function makeTrip(
  tripId: string,
  patternId: string,
  hours: number,
  extra: Partial<Trip> = {},
): Trip {
  const pattern = network.patternIndex(patternId);
  if (pattern === undefined) throw new Error(`パターン ${patternId} がありません`);
  return {
    tripId,
    patternId,
    anchor: { stopId: pattern.originStopId, time: fromHM(hours, 0) },
    blockId: 'A',
    pullOut: false,
    pullIn: false,
    ...extra,
  };
}

function setTrips(trips: readonly Trip[]): void {
  store.getState().editProject('便を置く', (project) => {
    const [service] = project.services;
    if (service !== undefined) service.trips = [...trips];
  });
}

/** 今の路線図で引いた、その便の全時刻。 */
function timesOf(tripId: string): ReadonlyMap<string, number> {
  const current = selectNetwork(store.getState());
  const trip = selectTrips(store.getState()).find((item) => item.tripId === tripId);
  if (current === null || trip === undefined) throw new Error('便がありません');
  return allTimes(trip, current);
}

beforeEach(() => {
  store = createAppStore();
  store.getState().setNetworkDef(network.def);
  store.getState().setProject(createProject(network, { now: new Date('2026-01-01T00:00:00Z') }));
});

describe('一覧', () => {
  it('区間表を定義の順に出す（route.json と突き合わせられる）', () => {
    const rows = segmentRows(network);

    expect(rows).toHaveLength(network.def.segments.length);
    expect(rows[0]?.label).toBe('豊中 → コンベ前');
  });

  it('**回送の区間が分かる**（営業所を含む区間）', () => {
    const rows = segmentRows(network);
    const depot = rows.filter((row) => row.isDeadhead);

    expect(depot).toHaveLength(6);
    for (const row of depot) expect(row.label).toContain('車庫');
  });
});

describe('打たれた値（受入条件）', () => {
  it('**5 の倍数でない値は受け取らない**', () => {
    expect(parseRunMinutes('20')).toBe(20);
    expect(parseRunMinutes('0')).toBe(0);
    expect(parseRunMinutes('21')).toBeNull();
    expect(parseRunMinutes('2.5')).toBeNull();
    expect(parseRunMinutes('-5')).toBeNull();
    expect(parseRunMinutes('')).toBeNull();
    expect(parseRunMinutes('二十')).toBeNull();
  });

  it('全角の数字も受け取る（日本語入力のまま打たれる）', () => {
    expect(parseRunMinutes('２０')).toBe(20);
  });

  it('今の値と同じなら「変更」に数えない', () => {
    const same = changedEdits(network, new Map([[TOYONAKA_TO_MINOH, 20]]));
    expect(same.size).toBe(0);

    const changed = changedEdits(network, new Map([[TOYONAKA_TO_MINOH, 25]]));
    expect(changed.get(TOYONAKA_TO_MINOH)).toBe(25);
  });
});

describe('影響を受ける便の数（仕様書 §6.5.1）', () => {
  beforeEach(() => {
    setTrips([
      makeTrip('t1', 'S3', 8), // 豊中 → 箕面 → コンベ前 → 工学部
      makeTrip('t2', 'S1', 9), // 直行（箕面を通らない）
      makeTrip('t3', 'T1', 10), // 工学部 → 人科前 → 豊中
    ]);
  });

  const count = (edits: readonly [string, number][]): number =>
    affectedTripCount(selectTrips(store.getState()), network, new Map(edits));

  it('**その区間を通る便だけを数える**', () => {
    // 豊中 → 箕面 を通るのは S3 だけ。
    expect(count([[TOYONAKA_TO_MINOH, 25]])).toBe(1);
    // 工学部 → 人科前 を通るのは T1 だけ。
    expect(count([[ENGINEERING_TO_HUMAN, 10]])).toBe(1);
  });

  it('変わっていなければ 0 便', () => {
    expect(count([[TOYONAKA_TO_MINOH, 20]])).toBe(0);
  });

  it('**回送の区間は出入庫を付けた便に効く**（§6.1.7）', () => {
    setTrips([makeTrip('t1', 'S3', 8, { pullOut: true }), makeTrip('t2', 'S1', 9)]);

    // 車庫 → 豊中学舎。出区を付けた t1 だけが影響を受ける。
    expect(count([['9_0→1_0', 25]])).toBe(1);
  });
});

describe('当てた定義（純関数）', () => {
  it('元の定義を変えない', () => {
    const next = withRunMinutes(network.def, new Map([[TOYONAKA_TO_MINOH, 25]]));

    expect(
      next.segments.find((s) => s.fromStopId === '1_0' && s.toStopId === '2_0')?.runMinutes,
    ).toBe(25);
    expect(
      network.def.segments.find((s) => s.fromStopId === '1_0' && s.toStopId === '2_0')?.runMinutes,
    ).toBe(20);
  });

  it('変わらない区間は同じ参照のまま返す（描き直しを起こさない）', () => {
    const next = withRunMinutes(network.def, new Map([[TOYONAKA_TO_MINOH, 25]]));
    const index = network.def.segments.findIndex((s) => s.fromStopId === '2_0');

    expect(next.segments[index]).toBe(network.def.segments[index]);
  });
});

describe('適用したあとの時刻（受入条件）', () => {
  beforeEach(() => {
    setTrips([
      makeTrip('t1', 'S3', 8), // 豊中 8:00 発
      makeTrip('t2', 'T1', 10), // 工学部 10:00 発
    ]);
  });

  it('**その区間を通る便の時刻だけが変わる**', () => {
    const before = { t1: timesOf('t1'), t2: timesOf('t2') };
    applySegmentEdits(store, new Map([[TOYONAKA_TO_MINOH, 30]]));
    const after = { t1: timesOf('t1'), t2: timesOf('t2') };

    // S3 は豊中 → 箕面 を通る。箕面から先が 10 分ずれる。
    expect(after.t1.get('2_0')! - before.t1.get('2_0')!).toBe(10 * 60);
    expect(after.t1.get('4_0')! - before.t1.get('4_0')!).toBe(10 * 60);
    // T1（工学部 → 人科前 → 豊中）はその区間を通らない。
    expect([...after.t2.entries()]).toEqual([...before.t2.entries()]);
  });

  it('**アンカー停留所の時刻は変わらない**', () => {
    const before = timesOf('t1').get('1_0');
    applySegmentEdits(store, new Map([[TOYONAKA_TO_MINOH, 30]]));

    expect(timesOf('t1').get('1_0')).toBe(before);
    expect(selectTrips(store.getState())[0]?.anchor?.time).toBe(fromHM(8, 0));
  });

  it('索引も新しい所要時間で引ける（画面が古い値を持ち続けない）', () => {
    applySegmentEdits(store, new Map([[TOYONAKA_TO_MINOH, 30]]));
    const current = selectNetwork(store.getState());

    expect(current?.runMinutes('1_0', '2_0')).toBe(30);
    expect(buildNetworkIndex(current!.def).runMinutes('1_0', '2_0')).toBe(30);
  });
});

describe('parseDistanceKm（#161）', () => {
  it('km を打つとメートルで返る', () => {
    expect(parseDistanceKm('8.5')).toBe(8500);
    expect(parseDistanceKm('0')).toBe(0);
  });

  it('全角も受け取る', () => {
    expect(parseDistanceKm('６．４')).toBe(6400);
  });

  it('**5 の倍数の縛りは掛けない**（5 分刻みはダイヤの側の決まりである）', () => {
    expect(parseDistanceKm('1.3')).toBe(1300);
    expect(parseDistanceKm('7')).toBe(7000);
  });

  it('100m 未満は近いほうへ丸める', () => {
    expect(parseDistanceKm('1.25')).toBe(1250);
  });

  it('数でなければ受け取らない', () => {
    for (const text of ['', 'あ', '-1', '1.2.3', '1 km']) {
      expect(parseDistanceKm(text)).toBeNull();
    }
  });
});

describe('changedDistances / withDistances（#161）', () => {
  it('今の値と違うものだけを残す', () => {
    const same = new Map([[TOYONAKA_TO_MINOH, 6400]]);
    expect(changedDistances(network, same).size).toBe(0);

    const changed = new Map([[TOYONAKA_TO_MINOH, 6500]]);
    expect(changedDistances(network, changed).get(TOYONAKA_TO_MINOH)).toBe(6500);
  });

  it('**距離を変えても所要時間は動かない**（時刻を決めるのは所要時間だけ）', () => {
    const next = withDistances(network.def, new Map([[TOYONAKA_TO_MINOH, 9999]]));
    const segment = next.segments.find(
      (s) => segmentKey(s.fromStopId, s.toStopId) === TOYONAKA_TO_MINOH,
    );

    expect(segment?.distanceMeters).toBe(9999);
    expect(segment?.runMinutes).toBe(20);
  });

  it('元の定義は変えない', () => {
    const before = network.def.segments.map((s) => s.distanceMeters);
    withDistances(network.def, new Map([[TOYONAKA_TO_MINOH, 1]]));

    expect(network.def.segments.map((s) => s.distanceMeters)).toEqual(before);
  });
});
