/**
 * ダイヤの便に対する操作（仕様書 §6.1.4、T-21）。
 *
 * 追加・複製・削除・パターン変更・並べ替え・一括シフト・ダイヤ間コピーを、
 * **便の配列から便の配列を作る純関数**として書く。画面もストアも知らない。
 *
 * ## できないことは `null` で返す
 *
 * 表せる範囲を外れる（0:00〜47:55）、パターンが見つからない、といった事情で
 * 操作が成り立たないことがある。例外を投げず `null` を返すのは `domain/trip`
 * と同じ理由であり、呼び出し側が「押せるが効かない」を画面で伝えられるように
 * するためである。
 *
 * ## 一括操作は全部か無かである
 *
 * 選んだ便のうち 1 つでも動かせなければ、**どれも動かさない**。一部だけ動くと
 * 便同士の間隔が黙って変わる。一括シフトは「選んだ便の相対関係を保ったまま
 * 平行移動する」操作であり、間隔が変わるのは操作の意味そのものが壊れている。
 *
 * ## 何も変わらないときは同じ参照を返す
 *
 * 0 分のシフト、既に整列済みの並べ替え、選択が空の削除。これらは新しい配列を
 * 作らずに引数をそのまま返す。ストアは Immer のパッチで変更を見ており
 * （`store/store.ts`）、中身が同じでも新しい配列を代入すれば履歴に 1 段積まれる。
 * 「元に戻す」を押しても何も起きない段は、利用者から見れば故障である。
 */

import type { DirectionId, Trip } from '@/domain/model';
import type { NetworkIndex } from '@/domain/network';
import { GRAIN_SECONDS, SECONDS_PER_MINUTE, compareTime } from '@/domain/time';
import { changePattern, originTime, shiftTrip } from '@/domain/trip';

/** 時刻を動かせる最小の単位（分）。5 分格子（仕様書 §2.1）。 */
export const GRAIN_MINUTES = GRAIN_SECONDS / SECONDS_PER_MINUTE;

/** 便を作る操作の結果。 */
export interface TripInsertion {
  /** 操作後の便の並び。 */
  readonly trips: readonly Trip[];
  /** 作られた便。作った順に並ぶ。呼び出し側が選択を移すのに使う。 */
  readonly added: readonly Trip[];
}

/** 新しく作る便の ID の形。`t` に通し番号を付ける。 */
const TRIP_ID_PREFIX = 't';

/**
 * まだ使われていない便 ID を配る道具を作る。呼ぶたびに次の ID を返す。
 *
 * **既存の ID から決まる。** 乱数や時刻を使わないのは、同じ操作から同じ
 * ファイルが得られるようにするためである。UUID にすると差分が読めなくなり、
 * 手で直したときに追えなくなる。
 *
 * 個数を受け取って配列を返す形にしないのは、受け取った側が添字で取り出す
 * ことになり、「必ず入っている」ことを型で言えないためである。
 *
 * GTFS の `trip_id` はフィード全体で一意であるため、`existing` にはダイヤを
 * またいだすべての便を渡す。
 */
export function tripIdMinter(existing: readonly Trip[]): () => string {
  let next = 1;
  for (const trip of existing) {
    if (!trip.tripId.startsWith(TRIP_ID_PREFIX)) continue;
    const digits = trip.tripId.slice(TRIP_ID_PREFIX.length);
    if (!/^\d+$/.test(digits)) continue;
    next = Math.max(next, Number(digits) + 1);
  }

  return (): string => {
    const id = `${TRIP_ID_PREFIX}${String(next)}`;
    next += 1;
    return id;
  };
}

/**
 * その方向で便を作るときの既定パターン（仕様書 §6.1.4「既定パターンの空便」）。
 *
 * どれを既定とするかは**ネットワーク定義が決める**（`isDefault`）。アプリが
 * 「先頭のパターン」のように推測すると、`route.json` で並びを入れ替えただけで
 * 新規便の経路が変わる。回送便は既定になり得ない（R-05）。
 *
 * R-05 は各方向にちょうど 1 つ存在することを求めており、検証を通った定義しか
 * 状態に入らないため（`store/selectors.ts`）、実際に `null` が返るのは
 * 検証を通していない定義を直接渡したときだけである。
 */
export function defaultPatternId(network: NetworkIndex, directionId: DirectionId): string | null {
  const found = network.def.patterns.find(
    (pattern) => pattern.directionId === directionId && pattern.isDefault && !pattern.isDeadhead,
  );
  return found === undefined ? null : found.patternId;
}

/**
 * 便を 1 つ加える（仕様書 §6.1.4）。**時刻は入れない。**
 *
 * `anchor: null` の便として末尾に置く。仮の時刻を入れないのは、それが
 * 「本当に 0:00 発なのか、まだ入力していないのか」を消してしまうからである
 * （仕様書 §5.6）。並びを気にする必要は無い。時刻を入れてから
 * {@link sortTripsByOrigin} を掛ければ収まる。
 *
 * @param among ID の重複を避けるために見る便。既定は編集対象の便。ダイヤを
 *   またいで ID を一意にしたいときに、全ダイヤの便を渡す。
 */
export function addTrip(
  trips: readonly Trip[],
  patternId: string,
  network: NetworkIndex,
  among: readonly Trip[] = trips,
): TripInsertion | null {
  if (network.findPattern(patternId) === undefined) return null;

  const trip: Trip = {
    tripId: tripIdMinter(among)(),
    patternId,
    anchor: null,
    blockId: '',
    pullOut: false,
    pullIn: false,
  };
  return { trips: [...trips, trip], added: [trip] };
}

/**
 * 選んだ便を複製する（仕様書 §6.1.4）。
 *
 * 複製は**元の便のすぐ隣**に置く。末尾に積むと、時刻順に並んだ表の中で
 * 複製元と複製先が遠く離れ、続けて時刻を直すときに目で追えない。
 *
 * 運用番号は引き継ぐ。同じ運用の便を増やすのが複製の主な用途であるため
 * （仕様書 §6.1.4）。便番号は便が持たないため、引き継ぐも捨てるもない
 * （§6.1.6 の導出値である）。
 *
 * 時刻が未入力の便は、未入力のまま複製する。動かす時刻が無いためであり、
 * これは失敗ではない。
 */
export function duplicateTrips(
  trips: readonly Trip[],
  tripIds: readonly string[],
  shiftMinutes: number,
  network: NetworkIndex,
  among: readonly Trip[] = trips,
): TripInsertion | null {
  if (!isOnGrain(shiftMinutes)) return null;

  const wanted = new Set(tripIds);
  const targets = trips.filter((trip) => wanted.has(trip.tripId));
  if (targets.length === 0) return null;

  const mint = tripIdMinter(among);
  const copies = new Map<string, Trip>();

  for (const trip of targets) {
    const shifted = shiftCopy(trip, shiftMinutes, network);
    if (shifted === null) return null;
    copies.set(trip.tripId, { ...shifted, tripId: mint() });
  }

  const next: Trip[] = [];
  for (const trip of trips) {
    next.push(trip);
    const copy = copies.get(trip.tripId);
    if (copy !== undefined) next.push(copy);
  }
  return { trips: next, added: [...copies.values()] };
}

/**
 * 便を別のダイヤへ複製する（仕様書 §6.1.4 のダイヤ間コピー）。
 *
 * 時刻はそのまま写す。平日ダイヤを土曜ダイヤの下敷きにする、という使い方で
 * あり、写した先で時刻を直していく。運用番号も引き継ぐ。
 *
 * @returns コピー先の新しい便の並び。写すものが無ければ `null`。
 */
export function copyTripsToService(
  sourceTrips: readonly Trip[],
  targetTrips: readonly Trip[],
  tripIds: readonly string[],
): TripInsertion | null {
  const wanted = new Set(tripIds);
  const targets = sourceTrips.filter((trip) => wanted.has(trip.tripId));
  if (targets.length === 0) return null;

  // ID は写し元と写し先の両方を避ける。同じ ID の便が 2 つのダイヤに現れると、
  // GTFS へ書き出せなくなる。
  const mint = tripIdMinter([...sourceTrips, ...targetTrips]);
  const added = targets.map((trip): Trip => ({ ...trip, tripId: mint() }));
  return { trips: [...targetTrips, ...added], added };
}

/** 選んだ便を消す（仕様書 §6.1.4）。消すものが無ければ引数をそのまま返す。 */
export function removeTrips(trips: readonly Trip[], tripIds: readonly string[]): readonly Trip[] {
  const wanted = new Set(tripIds);
  const next = trips.filter((trip) => !wanted.has(trip.tripId));
  return next.length === trips.length ? trips : next;
}

/**
 * 選んだ便の停車パターンを変える（仕様書 §6.1.4）。
 *
 * アンカー停留所が新しいパターンに含まれない場合の扱いは
 * {@link changePattern} が決める（新パターンの始発を新しいアンカーとし、
 * 変更前の始発時刻を引き継ぐ）。ここでは**全部か無か**だけを足している。
 */
export function changeTripsPattern(
  trips: readonly Trip[],
  tripIds: readonly string[],
  patternId: string,
  network: NetworkIndex,
): readonly Trip[] | null {
  if (network.findPattern(patternId) === undefined) return null;

  const wanted = new Set(tripIds);
  const changed = new Map<string, Trip>();

  for (const trip of trips) {
    if (!wanted.has(trip.tripId) || trip.patternId === patternId) continue;
    const next = changePattern(trip, patternId, network);
    if (next === null) return null;
    changed.set(trip.tripId, next);
  }
  if (changed.size === 0) return trips;

  return trips.map((trip) => changed.get(trip.tripId) ?? trip);
}

/**
 * 選んだ便の時刻を ±N 分ずらす（仕様書 §6.1.4 の一括シフト）。
 *
 * 動かすのはアンカーだけであり、スジの傾きは変わらない。時刻が未入力の便は
 * そのまま残す（動かす時刻が無い）。1 つでも範囲を外れる便があれば `null`。
 */
export function shiftTrips(
  trips: readonly Trip[],
  tripIds: readonly string[],
  minutes: number,
  network: NetworkIndex,
): readonly Trip[] | null {
  if (!isOnGrain(minutes)) return null;
  if (minutes === 0) return trips;

  const wanted = new Set(tripIds);
  const shifted = new Map<string, Trip>();

  for (const trip of trips) {
    if (!wanted.has(trip.tripId)) continue;
    const next = shiftCopy(trip, minutes, network);
    if (next === null) return null;
    if (next !== trip) shifted.set(trip.tripId, next);
  }
  if (shifted.size === 0) return trips;

  return trips.map((trip) => shifted.get(trip.tripId) ?? trip);
}

/**
 * 始発時刻の昇順に並べ替える（仕様書 §6.1.4）。
 *
 * 時刻を入れられない便（未入力・参照が壊れている）は**末尾へ回し、元の並びを
 * 保つ**。時刻の無いものを先頭に集めると、追加したばかりの空便が毎回いちばん
 * 左に来て、時刻を入れた瞬間に飛んでいく。
 *
 * 同時刻の便の並びも元のままとする（安定ソート）。
 */
export function sortTripsByOrigin(trips: readonly Trip[], network: NetworkIndex): readonly Trip[] {
  const sorted = [...trips].sort((a, b) => {
    const timeA = originTime(a, network);
    const timeB = originTime(b, network);
    if (timeA === null) return timeB === null ? 0 : 1;
    if (timeB === null) return -1;
    return compareTime(timeA, timeB);
  });
  return sorted.every((trip, index) => trip === trips[index]) ? trips : sorted;
}

/** その分数だけ動かしてよいか。5 分格子（仕様書 §2.1）を外れる値は受け付けない。 */
function isOnGrain(minutes: number): boolean {
  return Number.isInteger(minutes) && minutes % GRAIN_MINUTES === 0;
}

/**
 * 便をずらした写しを返す。時刻が未入力ならそのまま返す。
 *
 * 未入力を失敗にしないのは、複製も一括シフトも「時刻の入っている便を動かす」
 * 操作でありながら、選択には空便が混ざり得るためである。
 */
function shiftCopy(trip: Trip, minutes: number, network: NetworkIndex): Trip | null {
  if (trip.anchor === null) return trip;
  return shiftTrip(trip, minutes, network);
}
