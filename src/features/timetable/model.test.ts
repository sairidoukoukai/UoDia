/**
 * 時刻表の中身の検証（T-19、仕様書 §6.1.1）。
 *
 * 受入条件のうち 2 つはここで固定できる。
 *
 * 1. 直行便（S1）の箕面学舎セルが `−` になり、箕面経由便（S3）と区別できる
 * 2. アンカーのセルが判別できる
 *
 * 3 つ目（100 便でのスクロール）は描画側の話であり、実機で確かめる。
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Trip } from '@/domain/model';
import { loadNetworkDef, type NetworkIndex } from '@/domain/network';
import { fromHM, type Seconds } from '@/domain/time';
import { allTimes } from '@/domain/trip';
import { blockColorsOf, buildTimetable, stopsForDirection, type TimetableCell } from './model';

const routeJsonPath = fileURLToPath(new URL('../../../data/route.json', import.meta.url));
const loaded = loadNetworkDef(readFileSync(routeJsonPath, 'utf8'));
if (!loaded.ok) throw new Error('route.json を読み込めません');
const network: NetworkIndex = loaded.network;

let counter = 0;

function makeTrip(
  patternId: string,
  hours: number,
  minutes: number,
  extra: Partial<Trip> = {},
): Trip {
  const pattern = network.patternIndex(patternId);
  if (pattern === undefined) throw new Error(`パターン ${patternId} がありません`);
  counter += 1;
  return {
    tripId: `t${String(counter)}`,
    patternId,
    anchor: { stopId: pattern.originStopId, time: fromHM(hours, minutes) },
    blockId: '',
    pullOut: false,
    pullIn: false,
    ...extra,
  };
}

/** 便の時刻。ストアが渡してくるものと同じ形で用意する。 */
function timesOf(trips: readonly Trip[]): Map<string, ReadonlyMap<string, Seconds>> {
  return new Map(trips.map((trip) => [trip.tripId, allTimes(trip, network)]));
}

function build(trips: readonly Trip[], directionId: 0 | 1 = 0) {
  return buildTimetable(trips, stopsForDirection(network, directionId), network, timesOf(trips));
}

/** 停留所 1 つぶんの升目を取り出す。 */
function cellAt(
  timetable: ReturnType<typeof build>,
  column: number,
  stopId: string,
): TimetableCell {
  const row = timetable.stops.findIndex((stop) => stop.stopId === stopId);
  if (row < 0) throw new Error(`停留所 ${stopId} は表に出ていません`);
  const cell = timetable.columns[column]?.cells[row];
  if (cell === undefined) throw new Error('升目がありません');
  return cell;
}

describe('表に出す停留所', () => {
  it('その方向のパターンに含まれる停留所の和集合を、縦軸の順に出す', () => {
    expect(stopsForDirection(network, 0).map((s) => s.stopId)).toEqual([
      '1_0',
      '2_0',
      '3_0',
      '4_0',
    ]);
  });

  it('**豊中方面は上下が逆になる**（時刻が上から下へ進む。T-48）', () => {
    // 工学部前（4_0）始発 → 人間科学部前（5_0）→ 箕面（2_0）→ 豊中（1_0）。
    expect(stopsForDirection(network, 1).map((s) => s.stopId)).toEqual([
      '4_0',
      '5_0',
      '2_0',
      '1_0',
    ]);
  });

  it('吹田方面の並びは変わらない', () => {
    expect(stopsForDirection(network, 0).map((s) => s.stopId)).toEqual([
      '1_0',
      '2_0',
      '3_0',
      '4_0',
    ]);
  });

  it('**微生物研究所前は出さない**（hiddenInEditor）', () => {
    for (const directionId of [0, 1] as const) {
      expect(stopsForDirection(network, directionId).map((s) => s.stopId)).not.toContain('6_0');
    }
  });
});

describe('経由しない停留所（受入条件）', () => {
  it('**直行便の箕面学舎は `−`、箕面経由便は時刻**', () => {
    const timetable = build([makeTrip('S1', 8, 0), makeTrip('S3', 8, 30)]);

    expect(cellAt(timetable, 0, '2_0')).toEqual({ kind: 'notServed' });
    expect(cellAt(timetable, 1, '2_0')).toMatchObject({ kind: 'time', time: fromHM(8, 50) });
  });

  it('どちらも吹田には着く（経由の違いだけが出る）', () => {
    const timetable = build([makeTrip('S1', 8, 0), makeTrip('S3', 8, 30)]);

    expect(cellAt(timetable, 0, '4_0')).toMatchObject({ kind: 'time', time: fromHM(8, 30) });
    expect(cellAt(timetable, 1, '4_0')).toMatchObject({ kind: 'time', time: fromHM(9, 10) });
  });

  it('営業所の行そのものが無い', () => {
    const timetable = build([makeTrip('S1', 8, 0)]);
    expect(timetable.stops.map((s) => s.stopId)).not.toContain('9_0');
  });
});

/*
 * アンカー（T-60、#164、仕様書 v1.1 §5.1）。
 *
 * **どの升目が基準かは表に出さない。** アンカー 1 点方式は便の中で時刻が
 * 食い違わないようにするための設計であって、利用者が意識する概念ではない。
 * 基準を移しても**時刻の出方は変わらない**ことを、ここで固定する。
 */
describe('アンカー', () => {
  it('**升目は基準かどうかを持たない**', () => {
    const timetable = build([makeTrip('S1', 8, 0)]);

    expect(cellAt(timetable, 0, '1_0')).not.toHaveProperty('isAnchor');
  });

  it('基準をどの停留所に置いても、出る時刻は同じである', () => {
    const fromOrigin = build([makeTrip('S1', 8, 0)]);
    // S1 は豊中から工学部前まで 30 分（25 + 5 + 0）。同じ便を工学部前 8:30
    // 基準で表しても、豊中 8:00 発は変わらない。
    const fromTerminal = build([
      makeTrip('S1', 8, 0, { anchor: { stopId: '4_0', time: fromHM(8, 30) } }),
    ]);

    expect(cellAt(fromTerminal, 0, '1_0')).toEqual(cellAt(fromOrigin, 0, '1_0'));
    expect(cellAt(fromTerminal, 0, '4_0')).toEqual(cellAt(fromOrigin, 0, '4_0'));
  });
});

describe('取扱区分の記号', () => {
  it('升目ごとに持つ（同じ停留所でも便によって違う）', () => {
    // 箕面学舎は S2 では始発（乗車のみ）、M2 では終着（降車のみ）、S3 では乗降。
    const timetable = build([makeTrip('S2', 8, 0), makeTrip('M2', 8, 0), makeTrip('S3', 8, 0)]);

    expect(cellAt(timetable, 0, '2_0')).toMatchObject({ handling: 'boardOnly' });
    expect(cellAt(timetable, 1, '2_0')).toMatchObject({ handling: 'alightOnly' });
    expect(cellAt(timetable, 2, '2_0')).toMatchObject({ handling: 'stop' });
  });
});

describe('時刻が出せない便', () => {
  it('時刻が未入力なら空欄にし、理由を残す（V-08）', () => {
    const timetable = build([makeTrip('S1', 8, 0, { anchor: null })]);

    expect(cellAt(timetable, 0, '1_0')).toEqual({
      kind: 'empty',
      handling: 'boardOnly',
      reason: 'unset',
    });
    // 経由しない停留所は空欄ではなく `−` のまま。
    expect(cellAt(timetable, 0, '2_0')).toEqual({ kind: 'notServed' });
  });

  it('参照が壊れていれば、経路が分からないので全部 `−`', () => {
    const timetable = build([makeTrip('S1', 8, 0, { patternId: '無いパターン' })]);

    expect(timetable.columns[0]?.pattern).toBeNull();
    expect(timetable.columns[0]?.cells.every((cell) => cell.kind === 'notServed')).toBe(true);
  });

  it('**表せる範囲を外れた升目だけが空欄になる**（未入力と区別する。V-04）', () => {
    // 基準は 47:50 で範囲内。そこから 25 分先の吹田は 48:15 となり出せない。
    const trip = makeTrip('S1', 8, 0, { anchor: { stopId: '1_0', time: fromHM(47, 50) } });
    const timetable = build([trip]);

    expect(cellAt(timetable, 0, '1_0')).toMatchObject({ kind: 'time', time: fromHM(47, 50) });
    expect(cellAt(timetable, 0, '3_0')).toEqual({
      kind: 'empty',
      handling: 'stop',
      reason: 'unresolvable',
    });
  });
});

describe('列', () => {
  it('便の並びを変えない（利用者が並べ替えた結果である）', () => {
    const trips = [makeTrip('S3', 9, 0), makeTrip('S1', 8, 0)];
    expect(build(trips).columns.map((c) => c.trip.tripId)).toEqual([
      trips[0]?.tripId,
      trips[1]?.tripId,
    ]);
  });

  it('便が無ければ列も無い', () => {
    expect(build([]).columns).toEqual([]);
  });

  it('停車パターンを引いて回送かどうかを示す', () => {
    const timetable = build([makeTrip('S1', 8, 0), makeTrip('DT-in', 8, 0)]);
    expect(timetable.columns[0]?.pattern?.isDeadhead).toBe(false);
    expect(timetable.columns[1]?.pattern?.isDeadhead).toBe(true);
  });
});

describe('運用番号の色（T-22、仕様書 §6.1.3）', () => {
  it('同じ運用番号には同じ色を割り当てる', () => {
    const colors = blockColorsOf([
      makeTrip('S1', 8, 0, { blockId: 'A' }),
      makeTrip('S1', 9, 0, { blockId: 'B' }),
      makeTrip('S1', 10, 0, { blockId: 'A' }),
    ]);

    expect(colors.size).toBe(2);
    expect(colors.get('A')).not.toBe(colors.get('B'));
  });

  it('**空欄は未割当であり、色を持たない**', () => {
    const colors = blockColorsOf([makeTrip('S1', 8, 0), makeTrip('S1', 9, 0, { blockId: 'A' })]);

    expect(colors.has('')).toBe(false);
    expect(colors.size).toBe(1);
  });

  it('便の並び順で色が変わらない', () => {
    const a = makeTrip('S1', 8, 0, { blockId: 'A' });
    const b = makeTrip('S1', 9, 0, { blockId: 'B' });
    expect([...blockColorsOf([a, b])]).toEqual([...blockColorsOf([b, a])]);
  });
});
