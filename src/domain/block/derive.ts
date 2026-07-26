/**
 * 運用の導出（仕様書 §5.8）。
 *
 * 便が持つ運用の情報は `blockId`（運用番号）という**文字列 1 つだけ**である。
 * 同じ運用番号を持つ便を始発時刻の昇順に並べたものが、その車両の 1 日の行路で
 * あり、折返し時分・出入庫・営業所待機はすべてそこから導出される。専用の
 * データ構造を持たないため、便を書き換えたあとに運用側の情報が古いまま残る、
 * という状態が起こらない。
 *
 * 営業所待機も同様に導出される。「入庫回送の便」と「次の出庫回送の便」の間の
 * 隙間がそれであり、待機を表すデータは存在しない（仕様書 §1.2、UC-4）。
 *
 * 本モジュールは検証を行わない。折返し時分が負であることも、運用が途中で
 * 途切れていることも、ここでは値として素直に返す。それを問題として報告するのは
 * ダイヤ検証（T-10）の責務である。
 */

import type { Trip } from '@/domain/model';
import type { NetworkIndex } from '@/domain/network';
import { compareTime, diffMinutes, type Seconds } from '@/domain/time';
import { originTime, terminalTime } from '@/domain/trip';

/** 運用の中の 1 便と、そこから導出される値。 */
export interface BlockTrip {
  readonly trip: Trip;
  readonly originStopId: string;
  readonly terminalStopId: string;
  readonly originTime: Seconds;
  readonly terminalTime: Seconds;
  readonly isDeadhead: boolean;
  /**
   * 直前の便の終着からこの便の始発までの分（仕様書 §2.2）。先頭の便は `null`。
   *
   * **0 分は正常値**である（折返し時分の下限は 0 分）。負の値は運用が破綻して
   * いることを意味するが、ここでは判定せずそのまま返す（T-10 の V-02）。
   */
  readonly layoverMinutes: number | null;
}

/** 営業所待機（仕様書 §5.8）。入庫回送の終着から次の出庫回送の始発まで。 */
export interface DepotStandby {
  /** 待機に入る便（入庫回送）。 */
  readonly inboundTripId: string;
  /** 待機から出る便（出庫回送）。 */
  readonly outboundTripId: string;
  readonly startTime: Seconds;
  readonly endTime: Seconds;
  readonly minutes: number;
}

/** 1 つの運用番号に属する便の行路。 */
export interface Block {
  readonly blockId: string;
  /** 始発時刻の昇順。 */
  readonly trips: readonly BlockTrip[];
  /** 出庫時刻。先頭の便が営業所を出る回送であればその始発時刻、でなければ `null`。 */
  readonly pullOutTime: Seconds | null;
  /** 入庫時刻。末尾の便が営業所へ入る回送であればその終着時刻、でなければ `null`。 */
  readonly pullInTime: Seconds | null;
  readonly standbys: readonly DepotStandby[];
}

/** 便の集合を運用に分解した結果。 */
export interface BlockDerivation {
  /** 運用番号の昇順。 */
  readonly blocks: readonly Block[];
  /**
   * 運用番号が空欄の便。どの運用にも属さない。
   *
   * 捨てずに返すのは、これが検証の情報項目（T-10 の V-07）になるためである。
   */
  readonly unassigned: readonly Trip[];
  /**
   * 時刻を導出できなかった便。`patternId` が解決できないか、時刻が表現できる
   * 範囲を外れている（T-11 の参照整合性検査が拾う）。
   */
  readonly unresolved: readonly Trip[];
}

/** 便を運用に分解する。 */
export function deriveBlocks(trips: readonly Trip[], network: NetworkIndex): BlockDerivation {
  const unassigned: Trip[] = [];
  const unresolved: Trip[] = [];
  const byBlockId = new Map<string, NonEmptyTrips>();

  for (const trip of trips) {
    if (trip.blockId === '') {
      unassigned.push(trip);
      continue;
    }
    const resolved = resolveTrip(trip, network);
    if (resolved === null) {
      unresolved.push(trip);
      continue;
    }
    const group = byBlockId.get(trip.blockId);
    if (group === undefined) {
      byBlockId.set(trip.blockId, [resolved]);
    } else {
      group.push(resolved);
    }
  }

  const depotIds = new Set(network.def.stops.filter((s) => s.isDepot).map((s) => s.stopId));
  const blocks = [...byBlockId]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([blockId, group]) => buildBlock(blockId, group, depotIds));

  return { blocks, unassigned, unresolved };
}

/** 時刻を導出できた便。折返し時分はまだ求めていない。 */
type ResolvedTrip = Omit<BlockTrip, 'layoverMinutes'>;

/**
 * 1 件以上の便。
 *
 * 運用は必ず 1 便以上を含む（0 便の運用番号は存在しようがない）。それを型で
 * 表しておくことで、先頭要素を取り出すたびに「無いかもしれない」場合を書かずに
 * 済ませる。
 */
type NonEmptyTrips = [ResolvedTrip, ...ResolvedTrip[]];

function resolveTrip(trip: Trip, network: NetworkIndex): ResolvedTrip | null {
  const pattern = network.patternIndex(trip.patternId);
  if (pattern === undefined) return null;

  const origin = originTime(trip, network);
  if (origin === null) return null;
  const terminal = terminalTime(trip, network);
  if (terminal === null) return null;

  return {
    trip,
    originStopId: pattern.originStopId,
    terminalStopId: pattern.terminalStopId,
    originTime: origin,
    terminalTime: terminal,
    isDeadhead: pattern.pattern.isDeadhead,
  };
}

function buildBlock(blockId: string, group: NonEmptyTrips, depotIds: ReadonlySet<string>): Block {
  // 始発時刻が同じ便は運用として成立しないが（T-10 の V-03）、導出の順序は
  // 入力の並びに左右されてはならない。終着時刻・便 ID の順で決着させる。
  const [head, ...tail] = group;
  const sorted: NonEmptyTrips = [head, ...tail];
  sorted.sort(
    (a, b) =>
      compareTime(a.originTime, b.originTime) ||
      compareTime(a.terminalTime, b.terminalTime) ||
      a.trip.tripId.localeCompare(b.trip.tripId),
  );

  const first = sorted[0];
  let previous: ResolvedTrip | undefined;
  let last: ResolvedTrip = first;
  const trips: BlockTrip[] = [];
  for (const current of sorted) {
    trips.push({
      ...current,
      layoverMinutes:
        previous === undefined ? null : diffMinutes(current.originTime, previous.terminalTime),
    });
    previous = current;
    last = current;
  }

  const isDepot = (stopId: string): boolean => depotIds.has(stopId);

  // 回送かどうかは見ない。R-07 により営業パターンは営業所を含まないため、
  // 営業所に居ることと回送であることは同値である。
  return {
    blockId,
    trips,
    pullOutTime: isDepot(first.originStopId) ? first.originTime : null,
    pullInTime: isDepot(last.terminalStopId) ? last.terminalTime : null,
    standbys: findStandbys(trips, isDepot),
  };
}

/**
 * 営業所待機を見つける。
 *
 * 連続する 2 便が営業所で繋がっていれば、その間が待機である。待機を表すデータは
 * 存在せず、便と便の隙間として現れる（仕様書 §1.2、UC-4）。
 */
function findStandbys(
  trips: readonly BlockTrip[],
  isDepot: (stopId: string) => boolean,
): DepotStandby[] {
  const standbys: DepotStandby[] = [];
  let previous: BlockTrip | undefined;

  for (const current of trips) {
    if (
      previous !== undefined &&
      isDepot(previous.terminalStopId) &&
      isDepot(current.originStopId)
    ) {
      standbys.push({
        inboundTripId: previous.trip.tripId,
        outboundTripId: current.trip.tripId,
        startTime: previous.terminalTime,
        endTime: current.originTime,
        minutes: diffMinutes(current.originTime, previous.terminalTime),
      });
    }
    previous = current;
  }

  return standbys;
}
