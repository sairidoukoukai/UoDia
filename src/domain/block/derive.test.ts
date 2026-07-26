/**
 * 運用の導出の検証（T-09、仕様書 §5.8）。
 *
 * 実データ（`data/route.json`）の回送パターンを使う。営業所待機は「入庫回送と
 * 出庫回送の隙間」として現れるため、実際の回送パターンが無いと再現できない。
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Trip } from '@/domain/model';
import { loadNetworkDef, type NetworkIndex } from '@/domain/network';
import { formatTime, fromHM, MAX_SECONDS, seconds } from '@/domain/time';
import { deriveBlocks, type Block } from './derive';

const routeJsonPath = fileURLToPath(new URL('../../../data/route.json', import.meta.url));
const loaded = loadNetworkDef(readFileSync(routeJsonPath, 'utf8'));
if (!loaded.ok) throw new Error('route.json を読み込めません');
const network: NetworkIndex = loaded.network;

const TOYONAKA = '1_0';
const SUITA = '4_0';
const DEPOT = '9_0';

let counter = 0;

/** 便を組み立てる。始発停留所を基準時刻とする。 */
function trip(patternId: string, hours: number, minutes: number, blockId: string): Trip {
  const pattern = network.patternIndex(patternId);
  if (pattern === undefined) throw new Error(`パターン ${patternId} がありません`);
  counter += 1;
  return {
    tripId: `t${String(counter)}`,
    patternId,
    anchor: { stopId: pattern.originStopId, time: fromHM(hours, minutes) },
    blockId,
    tripShortName: '',
  };
}

/** 運用の中身を読める形にする。 */
function summarize(block: Block): string[] {
  return block.trips.map(
    (t) =>
      `${t.trip.patternId} ${formatTime(t.originTime)}→${formatTime(t.terminalTime)}` +
      (t.layoverMinutes === null ? '' : ` (折返し ${String(t.layoverMinutes)} 分)`),
  );
}

/**
 * 1 日 2 回出庫する運用。
 *
 * 7:00 出庫 → 豊中 7:20 → 直行吹田 7:50 → 豊中 8:30 → 8:50 入庫
 *   → 営業所で 190 分待機 → 12:00 出庫 → 豊中 12:20 → 12:40 入庫
 */
function makeTwoShiftBlock(): Trip[] {
  return [
    trip('DT-out', 7, 0, '1'), // 車庫 → 豊中
    trip('S1', 7, 20, '1'), // 豊中 → 吹田（直行・30 分）
    trip('T1', 8, 0, '1'), // 吹田 → 豊中（30 分）
    trip('DT-in', 8, 30, '1'), // 豊中 → 車庫
    trip('DT-out', 12, 0, '1'), // 車庫 → 豊中
    trip('DT-in', 12, 20, '1'), // 豊中 → 車庫
  ];
}

function onlyBlock(trips: readonly Trip[]): Block {
  const { blocks } = deriveBlocks(trips, network);
  expect(blocks).toHaveLength(1);
  const block = blocks[0];
  if (block === undefined) throw new Error('運用がありません');
  return block;
}

describe('deriveBlocks — グルーピングと整列', () => {
  it('運用番号ごとにまとめる', () => {
    const trips = [trip('S1', 8, 0, '1'), trip('S1', 8, 30, '2'), trip('T1', 9, 0, '1')];
    const { blocks } = deriveBlocks(trips, network);
    expect(blocks.map((b) => b.blockId)).toEqual(['1', '2']);
    expect(blocks[0]?.trips).toHaveLength(2);
  });

  it('始発時刻の昇順に並べる（入力の順序に依存しない）', () => {
    const late = trip('S1', 10, 0, '1');
    const early = trip('S1', 8, 0, '1');
    expect(onlyBlock([late, early]).trips.map((t) => formatTime(t.originTime))).toEqual([
      '8:00',
      '10:00',
    ]);
  });

  it('始発時刻が同じ便も決定的に並ぶ', () => {
    // T1（30 分）と T2（20 分）はどちらも豊中行き。終着時刻で決着する。
    const long = trip('T1', 9, 0, '1');
    const short = trip('T2', 9, 0, '1');
    expect(onlyBlock([long, short]).trips.map((t) => t.trip.patternId)).toEqual(['T2', 'T1']);
    expect(onlyBlock([short, long]).trips.map((t) => t.trip.patternId)).toEqual(['T2', 'T1']);
  });

  it('始発も終着も同じ便は便 ID で決着する', () => {
    // 完全に重なる 2 便は運用として成立しないが（T-10 の V-03）、導出が入力の
    // 並びで変わってはならない。
    const a = { ...trip('S1', 9, 0, '1'), tripId: 'a' };
    const b = { ...trip('S1', 9, 0, '1'), tripId: 'b' };
    expect(onlyBlock([b, a]).trips.map((t) => t.trip.tripId)).toEqual(['a', 'b']);
    expect(onlyBlock([a, b]).trips.map((t) => t.trip.tripId)).toEqual(['a', 'b']);
  });

  it('運用番号の昇順に並べる', () => {
    const { blocks } = deriveBlocks(
      [trip('S1', 8, 0, '3'), trip('S1', 8, 30, '1'), trip('S1', 9, 0, '2')],
      network,
    );
    expect(blocks.map((b) => b.blockId)).toEqual(['1', '2', '3']);
  });

  it('便が 1 つも無ければ運用も無い', () => {
    expect(deriveBlocks([], network)).toEqual({
      blocks: [],
      unassigned: [],
      unanchored: [],
      unresolved: [],
    });
  });
});

describe('deriveBlocks — 運用に属さない便', () => {
  it('運用番号が空欄の便はグルーピングから除外する', () => {
    const assigned = trip('S1', 8, 0, '1');
    const blank = trip('S1', 9, 0, '');
    const { blocks, unassigned } = deriveBlocks([assigned, blank], network);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.trips).toHaveLength(1);
    expect(unassigned.map((t) => t.tripId)).toEqual([blank.tripId]);
  });

  it('パターンが解決できない便は unresolved に入れる', () => {
    const broken = { ...trip('S1', 8, 0, '1'), patternId: 'なにこれ' };
    const { blocks, unresolved } = deriveBlocks([broken], network);
    expect(blocks).toEqual([]);
    expect(unresolved.map((t) => t.tripId)).toEqual([broken.tripId]);
  });

  it('始発時刻が範囲を外れる便は unresolved に入れる', () => {
    // T3（45 分）の終着を 0:00 とすると、始発は負になる
    const broken: Trip = {
      ...trip('T3', 8, 0, '1'),
      anchor: { stopId: TOYONAKA, time: seconds(0) },
    };
    expect(deriveBlocks([broken], network).unresolved).toHaveLength(1);
  });

  it('終着時刻だけが範囲を外れる便も unresolved に入れる', () => {
    const broken: Trip = {
      ...trip('S3', 8, 0, '1'),
      anchor: { stopId: TOYONAKA, time: seconds(MAX_SECONDS) },
    };
    expect(deriveBlocks([broken], network).unresolved).toHaveLength(1);
  });

  it('運用番号が空欄で参照も壊れていれば、両方に現れる', () => {
    // どちらも別々に直す必要がある事実であり、片方だけ報告すると二度手間になる
    const broken = { ...trip('S1', 8, 0, ''), patternId: 'なにこれ' };
    const { unassigned, unresolved } = deriveBlocks([broken], network);
    expect(unassigned).toHaveLength(1);
    expect(unresolved).toHaveLength(1);
  });

  it('アンカー未設定の便は unanchored に入れる', () => {
    const empty: Trip = { ...trip('S1', 8, 0, '1'), anchor: null };
    const { blocks, unanchored, unresolved } = deriveBlocks([empty], network);
    expect(blocks).toEqual([]);
    expect(unanchored.map((t) => t.tripId)).toEqual([empty.tripId]);
    // 「まだ入力していない」は「壊れている」ではない
    expect(unresolved).toHaveLength(0);
  });

  it('運用番号が空欄でアンカーも未設定なら、両方に現れる', () => {
    const empty: Trip = { ...trip('S1', 8, 0, ''), anchor: null };
    const { unassigned, unanchored } = deriveBlocks([empty], network);
    expect(unassigned).toHaveLength(1);
    expect(unanchored).toHaveLength(1);
  });
});

describe('deriveBlocks — 折返し時分（仕様書 §2.2）', () => {
  it('先頭の便は null', () => {
    expect(onlyBlock([trip('S1', 8, 0, '1')]).trips[0]?.layoverMinutes).toBeNull();
  });

  it('次便の始発 − 当便の終着で求める', () => {
    // S1 は 8:00 豊中発 → 8:30 吹田着。次の T1 が 8:45 吹田発なら 15 分。
    const block = onlyBlock([trip('S1', 8, 0, '1'), trip('T1', 8, 45, '1')]);
    expect(block.trips[1]?.layoverMinutes).toBe(15);
  });

  it('**0 分は正常値**として扱う（折返し時分の下限は 0 分）', () => {
    const block = onlyBlock([trip('S1', 8, 0, '1'), trip('T1', 8, 30, '1')]);
    expect(block.trips[1]?.layoverMinutes).toBe(0);
  });

  it('負の折返しもそのまま返す（判定はダイヤ検証の責務）', () => {
    const block = onlyBlock([trip('S1', 8, 0, '1'), trip('T1', 8, 20, '1')]);
    expect(block.trips[1]?.layoverMinutes).toBe(-10);
  });

  it('停留所が繋がっていなくても値は返す', () => {
    // 吹田着の次に豊中発が来る破綻した運用。検出は T-10（V-01）の責務。
    const block = onlyBlock([trip('S1', 8, 0, '1'), trip('S1', 9, 0, '1')]);
    expect(block.trips[1]?.layoverMinutes).toBe(30);
    expect(block.trips[0]?.terminalStopId).toBe(SUITA);
    expect(block.trips[1]?.originStopId).toBe(TOYONAKA);
  });
});

describe('deriveBlocks — 出庫・入庫', () => {
  it('先頭が営業所発なら出庫時刻、末尾が営業所着なら入庫時刻を持つ', () => {
    const block = onlyBlock(makeTwoShiftBlock());
    expect(block.pullOutTime).toBe(fromHM(7, 0));
    expect(block.pullInTime).toBe(fromHM(12, 40));
  });

  it('先頭が営業所発でなければ出庫時刻は null', () => {
    const block = onlyBlock([trip('S1', 8, 0, '1'), trip('DS-in', 8, 30, '1')]);
    expect(block.pullOutTime).toBeNull();
    expect(block.pullInTime).toBe(fromHM(8, 50));
  });

  it('末尾が営業所着でなければ入庫時刻は null', () => {
    const block = onlyBlock([trip('DT-out', 7, 0, '1'), trip('S1', 7, 20, '1')]);
    expect(block.pullOutTime).toBe(fromHM(7, 0));
    expect(block.pullInTime).toBeNull();
  });

  it('回送を含まない運用は出庫も入庫も null', () => {
    const block = onlyBlock([trip('S1', 8, 0, '1')]);
    expect(block.pullOutTime).toBeNull();
    expect(block.pullInTime).toBeNull();
  });
});

describe('deriveBlocks — 営業所待機（仕様書 §5.8、UC-4）', () => {
  it('入庫 → 待機 → 出庫を待機として解釈する', () => {
    const block = onlyBlock(makeTwoShiftBlock());
    expect(block.standbys).toHaveLength(1);
    expect(block.standbys[0]?.startTime).toBe(fromHM(8, 50));
    expect(block.standbys[0]?.endTime).toBe(fromHM(12, 0));
    expect(block.standbys[0]?.minutes).toBe(190);
  });

  it('待機の前後の便を指す', () => {
    const trips = makeTwoShiftBlock();
    const block = onlyBlock(trips);
    expect(block.standbys[0]?.inboundTripId).toBe(trips[3]?.tripId);
    expect(block.standbys[0]?.outboundTripId).toBe(trips[4]?.tripId);
  });

  it('運用の行路全体が期待どおりに導出される', () => {
    expect(summarize(onlyBlock(makeTwoShiftBlock()))).toEqual([
      'DT-out 7:00→7:20',
      'S1 7:20→7:50 (折返し 0 分)',
      'T1 8:00→8:30 (折返し 10 分)',
      'DT-in 8:30→8:50 (折返し 0 分)',
      'DT-out 12:00→12:20 (折返し 190 分)',
      'DT-in 12:20→12:40 (折返し 0 分)',
    ]);
  });

  it('待機を挟まない運用には待機が無い', () => {
    const block = onlyBlock([
      trip('DT-out', 7, 0, '1'),
      trip('S1', 7, 20, '1'),
      trip('DS-in', 8, 0, '1'),
    ]);
    expect(block.standbys).toEqual([]);
  });

  it('入庫の次が営業所発でなければ待機ではない', () => {
    // 車庫に入ったのに次が豊中発という破綻した運用。検出は T-10 の責務。
    const block = onlyBlock([trip('DT-in', 8, 0, '1'), trip('S1', 9, 0, '1')]);
    expect(block.standbys).toEqual([]);
  });

  it('待機が 0 分でも待機として数える', () => {
    const block = onlyBlock([trip('DT-in', 8, 0, '1'), trip('DT-out', 8, 20, '1')]);
    expect(block.standbys).toHaveLength(1);
    expect(block.standbys[0]?.minutes).toBe(0);
  });

  it('待機が 2 回あれば 2 件返す', () => {
    const block = onlyBlock([
      trip('DT-in', 8, 0, '1'),
      trip('DT-out', 9, 0, '1'),
      trip('DT-in', 9, 20, '1'),
      trip('DT-out', 11, 0, '1'),
    ]);
    // 8:20 着 → 9:00 発で 40 分、9:40 着 → 11:00 発で 80 分
    expect(block.standbys.map((s) => s.minutes)).toEqual([40, 80]);
  });
});

describe('deriveBlocks — 導出される値の内訳', () => {
  it('各便の始発・終着の停留所と時刻を持つ', () => {
    const block = onlyBlock([trip('DT-out', 7, 0, '1')]);
    expect(block.trips[0]).toMatchObject({
      originStopId: DEPOT,
      terminalStopId: TOYONAKA,
      originTime: fromHM(7, 0),
      terminalTime: fromHM(7, 20),
      isDeadhead: true,
    });
  });

  it('営業便は isDeadhead が false', () => {
    expect(onlyBlock([trip('S1', 8, 0, '1')]).trips[0]?.isDeadhead).toBe(false);
  });

  it('元の便をそのまま保持する', () => {
    const original = trip('S1', 8, 0, '1');
    expect(onlyBlock([original]).trips[0]?.trip).toBe(original);
  });
});
