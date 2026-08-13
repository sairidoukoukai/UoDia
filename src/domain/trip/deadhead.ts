/**
 * 回送便の展開（仕様書 §6.1.7、T-51）。
 *
 * 出区した車はその場で折り返して営業を始め、入区する車は営業を終えた場所から
 * そのまま車庫へ向かう。待ち合わせは車庫で行う（§5.8 の営業所待機）。
 *
 * ## 回送便は保存しない
 *
 * この 0 分折返しの制約により、回送便に決めるものが残らない。
 *
 * | 決めるもの | 決まり方 |
 * | --- | --- |
 * | 停車パターン | 接する停留所から一意（豊中学舎発の便の出区は「車庫発豊中」） |
 * | 時刻 | 営業便の始発・終着と同じ。車庫側は区間所要時間から導出される |
 * | 運用番号 | 営業便と同じ |
 *
 * したがって便が持つのは `pullOut` / `pullIn` の真偽値だけであり、回送便は
 * **要る場面でその都度作る**。独立した便として保存すると、営業便をずらした・
 * パターンを変えた・消したときに置いていかれる。
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

/**
 * 展開した回送便の ID に付ける印。
 *
 * 新しい UUID を振らないのは、保存されない値だからである。**同じ入力から同じ ID が
 * 出る**ことで、検証の指摘やダイヤグラムの選択が、再描画をまたいで同じものを
 * 指し続ける。
 */
const SUFFIX = { out: '#out', in: '#in' } as const;

/**
 * その ID が指す、保存されている便の ID。
 *
 * 展開した回送便の ID を渡すと、展開元の営業便の ID を返す。検証の指摘のように
 * **画面が指し示す先**を作るところで通す。回送便の列は無いため、`t1#out` を
 * 指されても利用者はどこも見られない。
 */
export function sourceTripId(tripId: string): string {
  for (const suffix of Object.values(SUFFIX)) {
    if (tripId.endsWith(suffix)) return tripId.slice(0, -suffix.length);
  }
  return tripId;
}

/**
 * 営業便に回送便を展開した便の並びを返す。
 *
 * 展開できない便は黙って落ちる。時刻が未入力の便には回送の時刻も決まらず、
 * 車庫側が 0:00〜47:55 を外れる便（0:10 発の出区は前日 23:50）は表せない。
 * 前者は正常な途中状態、後者は V-04 が拾う。
 */
export function expandDeadheads(trips: readonly Trip[], network: NetworkIndex): Trip[] {
  const expanded: Trip[] = [];

  for (const trip of trips) {
    const pullOut = trip.pullOut ? createPullOut(trip, network) : null;
    if (pullOut !== null) expanded.push(pullOut);

    expanded.push(trip);

    const pullIn = trip.pullIn ? createPullIn(trip, network) : null;
    if (pullIn !== null) expanded.push(pullIn);
  }

  return expanded;
}

/** その便の出区回送。作れなければ `null`。 */
export function createPullOut(trip: Trip, network: NetworkIndex): Trip | null {
  return connect(
    pullOutPatternFor(trip, network),
    originStopId(trip, network),
    originTime(trip, network),
    trip,
    network,
    `${trip.tripId}${SUFFIX.out}`,
  );
}

/** その便の入区回送。作れなければ `null`。 */
export function createPullIn(trip: Trip, network: NetworkIndex): Trip | null {
  return connect(
    pullInPatternFor(trip, network),
    terminalStopId(trip, network),
    terminalTime(trip, network),
    trip,
    network,
    `${trip.tripId}${SUFFIX.in}`,
  );
}

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
 * 接点で繋がる回送便を組み立てる。
 *
 * 時刻を入れるのに `setTimeAt` を通すのは、**車庫側が表せる範囲に収まるか**を
 * そこが確かめるためである（仕様書 §2.1 の 0:00〜47:55）。
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

  const empty: Trip = {
    tripId,
    patternId: pattern.patternId,
    anchor: null,
    blockId: trip.blockId,
    // 回送の回送は無い。
    pullOut: false,
    pullIn: false,
  };
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
/** 営業所の停留所 ID。**回送かどうかではなく、営業所に接するかを見るのに使う。** */
export function depotIds(network: NetworkIndex): ReadonlySet<string> {
  return new Set(network.def.stops.filter((stop) => stop.isDepot).map((stop) => stop.stopId));
}
