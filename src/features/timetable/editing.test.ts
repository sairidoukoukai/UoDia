/**
 * 升目の編集の検証（T-20、仕様書 §6.1.2）。
 *
 * 受入条件のうち 3 つはここで固定できる。
 *
 * 1. `830` と入力して 8:30 になる
 * 2. 途中停留所に入力すると始発を含む全セルが更新される
 * 3. `8:32` の入力が 8:30 に丸められる（点滅そのものは描画側）
 *
 * 残る 2 つ（キーボードだけで連続入力・16ms 以内の反映）は画面の話であり、
 * `TimetableGrid.test.tsx` と実機で確かめる。
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Trip } from '@/domain/model';
import { loadNetworkDef, type NetworkIndex } from '@/domain/network';
import { fromHM, type Seconds } from '@/domain/time';
import { allTimes } from '@/domain/trip';
import {
  commitCellInput,
  initialEditText,
  movePosition,
  previousTimeInRow,
  type CellPosition,
} from './editing';
import { buildTimetable, stopsForDirection, type Timetable } from './model';

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
    tripShortName: '',
    ...extra,
  };
}

function build(trips: readonly Trip[]): Timetable {
  const times = new Map<string, ReadonlyMap<string, Seconds>>(
    trips.map((trip) => [trip.tripId, allTimes(trip, network)]),
  );
  return buildTimetable(trips, stopsForDirection(network, 0), network, times);
}

/** 吹田方面の行の並び: 豊中・箕面・コンベ・工学部・車庫。 */
const ROW = { toyonaka: 0, minoh: 1, conve: 2, engineering: 3, depot: 4 } as const;

function at(row: number, column = 0): CellPosition {
  return { row, column };
}

describe('升目の移動', () => {
  const size = { rows: 5, columns: 3 };

  it('矢印の向きへ 1 つ進む', () => {
    expect(movePosition(at(2, 1), 'up', size)).toEqual({ row: 1, column: 1 });
    expect(movePosition(at(2, 1), 'down', size)).toEqual({ row: 3, column: 1 });
    expect(movePosition(at(2, 1), 'left', size)).toEqual({ row: 2, column: 0 });
    expect(movePosition(at(2, 1), 'right', size)).toEqual({ row: 2, column: 2 });
  });

  it('**端では止まる**（折り返して別の便へ飛ばない）', () => {
    expect(movePosition(at(0, 0), 'up', size)).toEqual({ row: 0, column: 0 });
    expect(movePosition(at(0, 0), 'left', size)).toEqual({ row: 0, column: 0 });
    expect(movePosition(at(4, 2), 'down', size)).toEqual({ row: 4, column: 2 });
    expect(movePosition(at(4, 2), 'right', size)).toEqual({ row: 4, column: 2 });
  });

  it('表が空でも位置が壊れない', () => {
    expect(movePosition(at(0, 0), 'down', { rows: 0, columns: 0 })).toEqual({ row: 0, column: 0 });
  });
});

describe('直前の便の時刻', () => {
  it('同じ行の左隣を返す', () => {
    const timetable = build([makeTrip('S1', 8, 0), makeTrip('S1', 9, 0)]);
    expect(previousTimeInRow(timetable, at(ROW.toyonaka, 1))).toBe(fromHM(8, 0));
  });

  it('**経由しない便は飛ばす**（`−` は「直前の便」ではない）', () => {
    // 真ん中の S1 は箕面を経由しない。
    const timetable = build([makeTrip('S3', 8, 0), makeTrip('S1', 9, 0), makeTrip('S3', 10, 0)]);
    expect(previousTimeInRow(timetable, at(ROW.minoh, 2))).toBe(fromHM(8, 20));
  });

  it('左に何も無ければ undefined', () => {
    const timetable = build([makeTrip('S1', 8, 0)]);
    expect(previousTimeInRow(timetable, at(ROW.toyonaka, 0))).toBeUndefined();
  });
});

describe('入力の確定（受入条件）', () => {
  it('**`830` と入力して 8:30 になる**', () => {
    const timetable = build([makeTrip('S1', 7, 0)]);
    const outcome = commitCellInput(timetable, at(ROW.toyonaka), '830', network);

    expect(outcome.ok && outcome.trip.anchor).toEqual({ stopId: '1_0', time: fromHM(8, 30) });
    expect(outcome.ok && outcome.rounded).toBe(false);
  });

  it('`8:30` でも同じ', () => {
    const timetable = build([makeTrip('S1', 7, 0)]);
    const outcome = commitCellInput(timetable, at(ROW.toyonaka), '8:30', network);
    expect(outcome.ok && outcome.trip.anchor?.time).toBe(fromHM(8, 30));
  });

  it('**`8:32` は 8:30 に丸められ、丸めたことを伝える**', () => {
    const timetable = build([makeTrip('S1', 7, 0)]);
    const outcome = commitCellInput(timetable, at(ROW.toyonaka), '8:32', network);

    expect(outcome.ok && outcome.trip.anchor?.time).toBe(fromHM(8, 30));
    expect(outcome.ok && outcome.rounded).toBe(true);
  });

  it('分だけの入力を直前の便から補う', () => {
    const timetable = build([makeTrip('S1', 8, 0), makeTrip('S1', 9, 0)]);
    // 左隣は 8:00。00 以下の分は次の時と解釈する。
    const outcome = commitCellInput(timetable, at(ROW.toyonaka, 1), '45', network);
    expect(outcome.ok && outcome.trip.anchor?.time).toBe(fromHM(8, 45));
  });

  it('**途中の停留所に入れると、始発を含む全部が動く**', () => {
    const trip = makeTrip('S1', 8, 0);
    const timetable = build([trip]);

    const outcome = commitCellInput(timetable, at(ROW.engineering), '10:00', network);
    if (!outcome.ok) throw new Error('確定できるはず');

    // アンカーが工学部前へ移り、始発は逆算される（S1 は 30 分）。
    expect(outcome.trip.anchor).toEqual({ stopId: '4_0', time: fromHM(10, 0) });
    const times = allTimes(outcome.trip, network);
    expect(times.get('1_0')).toBe(fromHM(9, 30));
    expect(times.get('3_0')).toBe(fromHM(9, 55));
  });

  it('**前のアンカーは捨てられる**（基準は常に 1 つ）', () => {
    const trip = makeTrip('S1', 8, 0);
    const outcome = commitCellInput(build([trip]), at(ROW.engineering), '10:00', network);

    expect(trip.anchor?.stopId).toBe('1_0');
    expect(outcome.ok && outcome.trip.anchor?.stopId).toBe('4_0');
  });

  it('時刻が未入力の便にも入れられる', () => {
    const timetable = build([makeTrip('S1', 8, 0, { anchor: null })]);
    const outcome = commitCellInput(timetable, at(ROW.toyonaka), '830', network);
    expect(outcome.ok && outcome.trip.anchor?.time).toBe(fromHM(8, 30));
  });
});

describe('受け付けない入力', () => {
  it('経由しない升目は編集できない', () => {
    const timetable = build([makeTrip('S1', 8, 0)]);
    expect(commitCellInput(timetable, at(ROW.minoh), '830', network)).toEqual({
      ok: false,
      reason: 'notEditable',
    });
  });

  it('参照が壊れた便は編集できない', () => {
    const timetable = build([makeTrip('S1', 8, 0, { patternId: '無い' })]);
    expect(commitCellInput(timetable, at(ROW.toyonaka), '830', network)).toEqual({
      ok: false,
      reason: 'notEditable',
    });
  });

  it('表に無い位置は編集できない', () => {
    const timetable = build([makeTrip('S1', 8, 0)]);
    expect(commitCellInput(timetable, at(99, 99), '830', network)).toEqual({
      ok: false,
      reason: 'notEditable',
    });
  });

  it('時刻として読めなければ断る', () => {
    const timetable = build([makeTrip('S1', 8, 0)]);
    for (const text of ['あ', '99:99', '12345', '8:70']) {
      expect(commitCellInput(timetable, at(ROW.toyonaka), text, network)).toEqual({
        ok: false,
        reason: 'unparsable',
      });
    }
  });

  it('分だけの入力は、左隣が無ければ読めない', () => {
    const timetable = build([makeTrip('S1', 8, 0)]);
    expect(commitCellInput(timetable, at(ROW.toyonaka), '45', network)).toEqual({
      ok: false,
      reason: 'unparsable',
    });
  });

  it('**表せる範囲を外れる入力は断る**（始発が 0:00 より前になる）', () => {
    const timetable = build([makeTrip('S1', 8, 0)]);
    // 工学部前 0:10 にすると始発は前日 23:40 となり、表せない。
    expect(commitCellInput(timetable, at(ROW.engineering), '0:10', network)).toEqual({
      ok: false,
      reason: 'unrepresentable',
    });
  });

  it('終着が 47:55 を超える入力も断る', () => {
    const timetable = build([makeTrip('S1', 8, 0)]);
    expect(commitCellInput(timetable, at(ROW.toyonaka), '47:50', network)).toEqual({
      ok: false,
      reason: 'unrepresentable',
    });
  });

  it('**何も打たれていなければ取り消しとして扱う**（叱らない）', () => {
    const timetable = build([makeTrip('S1', 8, 0)]);
    expect(commitCellInput(timetable, at(ROW.toyonaka), '   ', network)).toEqual({
      ok: false,
      reason: null,
    });
  });
});

describe('編集を始めるときの文字列', () => {
  it('今の時刻を打ち直せる形で入れる', () => {
    const timetable = build([makeTrip('S1', 8, 5)]);
    expect(initialEditText(timetable, at(ROW.toyonaka))).toBe('8:05');
  });

  it('**入れた文字列はそのまま読み戻せる**', () => {
    const timetable = build([makeTrip('S1', 8, 5)]);
    const text = initialEditText(timetable, at(ROW.toyonaka));
    const outcome = commitCellInput(timetable, at(ROW.toyonaka), text, network);
    expect(outcome.ok && outcome.trip.anchor?.time).toBe(fromHM(8, 5));
  });

  it('24 時を超える時刻も読み戻せる', () => {
    const timetable = build([makeTrip('S1', 25, 30)]);
    expect(initialEditText(timetable, at(ROW.toyonaka))).toBe('25:30');
  });

  it('時刻が無ければ空から始める', () => {
    const timetable = build([makeTrip('S1', 8, 0, { anchor: null })]);
    expect(initialEditText(timetable, at(ROW.toyonaka))).toBe('');
    expect(initialEditText(timetable, at(ROW.minoh))).toBe('');
  });
});
