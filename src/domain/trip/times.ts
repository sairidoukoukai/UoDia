/**
 * 便の時刻導出 — アンカー 1 点方式（仕様書 §5.6）。
 *
 * 便が永続化するのは**基準時刻 1 点だけ**であり、各停留所の時刻はそこからの
 * 純関数として求める。
 *
 * ```
 * timeAt(trip, stopId) = anchor.time
 *                      + offsetFromOrigin(pattern, stopId)
 *                      - offsetFromOrigin(pattern, anchor.stopId)
 * ```
 *
 * 結果として、**便の中で時刻が矛盾することが原理的に起こり得ない**。停留所ごとの
 * 時刻を保持しないため、片方だけ書き換わる状態が表現できないからである。
 * ダイヤグラム上でスジの傾きが変わらないのも、頂点のドラッグという操作が存在
 * しないのも、すべてこの 1 点に由来する。
 *
 * ## `null` の意味
 *
 * 本モジュールの関数は例外を投げず、できないことを `null` で表す。時刻の導出は
 * 描画のたびに走り、ドラッグ中は「その位置に置けるか」の判定として呼ばれる。
 * そこで例外を投げると描画や操作が中断してしまうため、「できない」ことを正常な
 * 結果として扱う。
 *
 * - 参照する停留所がその便の経路に無い（時刻表の「−」欄）
 * - `patternId` が解決できない（T-11 の参照整合性検査が拾う）
 * - 導出した時刻が表現できる範囲（0:00〜47:55）を外れる
 */

import type { Anchor, Trip } from '@/domain/model';
import type { NetworkIndex, PatternIndex } from '@/domain/network';
import { tryAddMinutes, type Seconds } from '@/domain/time';

/** その便に時刻が入力されているか。`false` なら全停留所の時刻が `null` になる。 */
export function isAnchored(trip: Trip): boolean {
  return trip.anchor !== null;
}

/** 便のパターンとアンカー。解決できなければ `null`。 */
function resolve(
  trip: Trip,
  network: NetworkIndex,
): { pattern: PatternIndex; anchor: Anchor; anchorOffset: number } | null {
  const pattern = network.patternIndex(trip.patternId);
  if (pattern === undefined) return null;
  const { anchor } = trip;
  if (anchor === null) return null;
  const anchorOffset = pattern.offsetFromOrigin(anchor.stopId);
  if (anchorOffset === undefined) return null;
  return { pattern, anchor, anchorOffset };
}

/**
 * 便がその停留所を通る時刻。経路に無ければ `null`。
 *
 * 着時刻と発時刻を区別しない。便の内部に停車時分は存在せず、着即発として扱う
 * （仕様書 §2.2）。
 */
export function timeAt(trip: Trip, stopId: string, network: NetworkIndex): Seconds | null {
  const resolved = resolve(trip, network);
  if (resolved === null) return null;
  const offset = resolved.pattern.offsetFromOrigin(stopId);
  if (offset === undefined) return null;
  return tryAddMinutes(resolved.anchor.time, offset - resolved.anchorOffset);
}

/**
 * 便の全停留所の時刻を、経路の順に返す。
 *
 * `Map` は挿入順を保つため、そのまま時刻表の 1 列・ダイヤグラムの 1 本のスジの
 * 折れ点の並びとして使える。
 */
export function allTimes(trip: Trip, network: NetworkIndex): Map<string, Seconds> {
  const times = new Map<string, Seconds>();
  const resolved = resolve(trip, network);
  if (resolved === null) return times;

  for (const [stopId, offset] of resolved.pattern.offsets) {
    const time = tryAddMinutes(resolved.anchor.time, offset - resolved.anchorOffset);
    if (time !== null) times.set(stopId, time);
  }
  return times;
}

/** 便の始発停留所。パターンが解決できなければ `null`。 */
export function originStopId(trip: Trip, network: NetworkIndex): string | null {
  return network.patternIndex(trip.patternId)?.originStopId ?? null;
}

/** 便の終着停留所。 */
export function terminalStopId(trip: Trip, network: NetworkIndex): string | null {
  return network.patternIndex(trip.patternId)?.terminalStopId ?? null;
}

/** 便の始発時刻。運用の折返し時分（仕様書 §2.2）の算出に用いる。 */
export function originTime(trip: Trip, network: NetworkIndex): Seconds | null {
  const stopId = originStopId(trip, network);
  return stopId === null ? null : timeAt(trip, stopId, network);
}

/** 便の終着時刻。 */
export function terminalTime(trip: Trip, network: NetworkIndex): Seconds | null {
  const stopId = terminalStopId(trip, network);
  return stopId === null ? null : timeAt(trip, stopId, network);
}

/**
 * すべての停留所の時刻が表現できる範囲に収まるか。
 *
 * アンカーを動かす操作は、便の**両端**が範囲を外れないことを確かめてから
 * 結果を返す。中間停留所は両端の間にあるため、両端さえ収まれば必ず収まる。
 */
function isRepresentable(trip: Trip, network: NetworkIndex): boolean {
  return originTime(trip, network) !== null && terminalTime(trip, network) !== null;
}

/**
 * 停留所 *S* の時刻を *T* に設定した便を返す。
 *
 * **前のアンカーは破棄される。**（仕様書 §5.6 の更新規則、UC-3）
 * 複数のアンカーを保持したり、以前の指定とマージしたりはしない。「始発を 8:00 に
 * したあと箕面学舎を 9:00 にする」は、始発の指定が無かったことになるのであって、
 * 2 つの制約を満たす解を探すのではない。この単純さが便内の無矛盾性を生んでいる。
 *
 * 指定した停留所が経路に無い場合、および時刻が範囲を外れる場合は `null`。
 */
export function setTimeAt(
  trip: Trip,
  stopId: string,
  time: Seconds,
  network: NetworkIndex,
): Trip | null {
  const next: Trip = { ...trip, anchor: { stopId, time } };
  return isRepresentable(next, network) ? next : null;
}

/**
 * 便全体を指定分だけ平行移動する（仕様書 §6.1.4 の一括シフト、§6.3 のドラッグ）。
 *
 * アンカー時刻だけを動かす。**スジの傾きは変わらない。**
 * 時刻が未入力の便は動かしようがないため `null` を返す。
 */
export function shiftTrip(trip: Trip, minutes: number, network: NetworkIndex): Trip | null {
  const { anchor } = trip;
  if (anchor === null) return null;
  const time = tryAddMinutes(anchor.time, minutes);
  return time === null ? null : setTimeAt(trip, anchor.stopId, time, network);
}

/**
 * 便の停車パターンを変更する（仕様書 §6.1.4）。
 *
 * アンカー停留所が新しいパターンにも含まれていれば、そのまま引き継ぐ。利用者が
 * 意図して固定した 1 点を動かさないためである。
 *
 * 含まれていない場合は、**新パターンの始発停留所を新しいアンカーとし、変更前の
 * 始発時刻を引き継ぐ**。始発時刻を選ぶのは、それが利用者にとって最も動いて
 * ほしくない値だからである（例: 箕面経由から直行へ変えても、豊中学舎を出る時刻は
 * 変えたくない）。
 *
 * 時刻が未入力の便は、未入力のまま経路だけが変わる。引き継ぐ時刻が無いのだから
 * 仮の時刻を作ってはならない。経路を決めてから時刻を入れる、という順序の入力が
 * これで成り立つ。
 */
export function changePattern(trip: Trip, patternId: string, network: NetworkIndex): Trip | null {
  const next = network.patternIndex(patternId);
  if (next === undefined) return null;

  const { anchor } = trip;
  if (anchor === null) return { ...trip, patternId };

  if (next.includes(anchor.stopId)) {
    const moved: Trip = { ...trip, patternId };
    return isRepresentable(moved, network) ? moved : null;
  }

  const previousOriginTime = originTime(trip, network);
  if (previousOriginTime === null) return null;

  const moved: Trip = {
    ...trip,
    patternId,
    anchor: { stopId: next.originStopId, time: previousOriginTime },
  };
  return isRepresentable(moved, network) ? moved : null;
}
