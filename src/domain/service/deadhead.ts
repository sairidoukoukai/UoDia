/**
 * 出区・入区（仕様書 §6.1.7、T-50）。
 *
 * 出区した車はその場で折り返して営業を始め、入区する車は営業を終えた場所から
 * そのまま車庫へ向かう。待ち合わせは車庫で行う（§5.8 の営業所待機）。
 *
 * ## 0 分折返しが決めるもの
 *
 * この制約により、回送便に決めるものが残らない。
 *
 * | 決めるもの | 決まり方 |
 * | --- | --- |
 * | 停車パターン | 接する停留所から一意（豊中学舎発の便の出区は「車庫発豊中」） |
 * | 時刻 | 営業便の始発・終着と同じ。車庫側は区間所要時間から導出される |
 * | 運用番号 | 営業便と同じ |
 *
 * したがって出区・入区は**有無を切り替えるだけ**で作れる。
 *
 * ## アンカーは接点に置く
 *
 * 作る回送便のアンカーは、車庫側ではなく**営業便と接する停留所**に置く。
 * 区間所要時間を改定したとき、動いてほしくないのは接点だからである
 * （仕様書 §5.6、UC-5）。車庫側の時刻はそこから導出され、ひとりでに追随する。
 */

import type { StopPattern, Trip } from '@/domain/model';
import type { NetworkIndex, PatternIndex } from '@/domain/network';
import type { Seconds } from '@/domain/time';
import { originStopId, originTime, setTimeAt, terminalStopId, terminalTime } from '@/domain/trip';

/** 車庫を出てその便に繋がる回送のパターン。無ければ `null`。 */
export function pullOutPatternFor(trip: Trip, network: NetworkIndex): StopPattern | null {
  const stopId = originStopId(trip, network);
  if (stopId === null) return null;

  const depots = depotIds(network);
  return findDeadhead(
    network,
    (index) => depots.has(index.originStopId) && index.terminalStopId === stopId,
  );
}

/** その便のあとに車庫へ入る回送のパターン。無ければ `null`。 */
export function pullInPatternFor(trip: Trip, network: NetworkIndex): StopPattern | null {
  const stopId = terminalStopId(trip, network);
  if (stopId === null) return null;

  const depots = depotIds(network);
  return findDeadhead(
    network,
    (index) => index.originStopId === stopId && depots.has(index.terminalStopId),
  );
}

/**
 * その便の出区回送を作る。作れなければ `null`。
 *
 * アンカーは営業便の始発停留所に、始発時刻と同じ時刻で置く（0 分折返し）。
 */
export function createPullOut(trip: Trip, network: NetworkIndex, tripId: string): Trip | null {
  return connect(
    pullOutPatternFor(trip, network),
    originStopId(trip, network),
    originTime(trip, network),
    trip,
    network,
    tripId,
  );
}

/**
 * その便の入区回送を作る。作れなければ `null`。
 *
 * アンカーは営業便の終着停留所に、終着時刻と同じ時刻で置く（0 分発車）。
 */
export function createPullIn(trip: Trip, network: NetworkIndex, tripId: string): Trip | null {
  return connect(
    pullInPatternFor(trip, network),
    terminalStopId(trip, network),
    terminalTime(trip, network),
    trip,
    network,
    tripId,
  );
}

/**
 * 接点で繋がる回送便を組み立てる。
 *
 * 時刻を入れるのに `setTimeAt` を通すのは、**車庫側が表せる範囲に収まるか**を
 * そこが確かめるためである（仕様書 §2.1 の 0:00〜47:55）。0:10 発の便に出区を
 * 付けようとすれば前日の 23:50 発となり、作れない。
 */
function connect(
  pattern: StopPattern | null,
  stopId: string | null,
  time: Seconds | null,
  trip: Trip,
  network: NetworkIndex,
  tripId: string,
): Trip | null {
  if (pattern === null || stopId === null || time === null) return null;

  const empty: Trip = { tripId, patternId: pattern.patternId, anchor: null, blockId: trip.blockId };
  return setTimeAt(empty, stopId, time, network);
}

/** 条件に合う回送パターン。複数あれば定義の順で先のものを採る。 */
function findDeadhead(
  network: NetworkIndex,
  matches: (index: PatternIndex) => boolean,
): StopPattern | null {
  const found = network.patternIndexes.find((index) => index.pattern.isDeadhead && matches(index));
  return found?.pattern ?? null;
}

/** 営業所の停留所 ID。 */
function depotIds(network: NetworkIndex): ReadonlySet<string> {
  return new Set(network.def.stops.filter((stop) => stop.isDepot).map((stop) => stop.stopId));
}
