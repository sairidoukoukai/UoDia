/**
 * 時刻表の中身を組み立てる（仕様書 §6.1.1、T-19）。
 *
 * 描く前に、表そのものを値として作る。**「何を出すか」と「どう出すか」を
 * 分ける**ことで、経由しない停留所の扱いやアンカーの位置といった、間違えると
 * 利用者が気づけない部分を React 抜きで確かめられる。
 */

import { assignBlockColors } from '@/domain/block';
import type { DirectionId, Handling, StopPattern, Stop, Trip } from '@/domain/model';
import type { NetworkIndex } from '@/domain/network';
import type { Seconds } from '@/domain/time';
import { isAnchored } from '@/domain/trip';

/** 方向タブの見出し（仕様書 §6.1.1）。 */
export const DIRECTION_LABEL: Readonly<Record<DirectionId, string>> = {
  0: '吹田方面',
  1: '豊中方面',
};

/**
 * 取扱区分の記号（仕様書 §6.1.1）。
 *
 * **記号は行ではなく升目に付く。** 取扱区分は停留所ではなく「そのパターンが
 * その停留所をどう扱うか」であり、同じ停留所でも便によって変わる。実際、
 * 箕面学舎は吹田方面だけを見ても S2 では乗車のみ・M2 では降車のみ・S3 では
 * 乗降であり、行の見出しに 1 つ書くと必ずどれかが嘘になる。
 */
export const HANDLING_MARK: Readonly<Record<Handling, string>> = {
  stop: '',
  boardOnly: '△',
  alightOnly: '▽',
};

/** 経由しない停留所に出す印（仕様書 §6.1.1）。 */
export const NOT_SERVED = '−';

/** 時刻を出せない理由。 */
export type EmptyReason =
  /** まだ時刻が入力されていない（アンカー未設定。V-08）。 */
  | 'unset'
  /** 参照が壊れている・表せる範囲を外れている（V-04）。 */
  | 'unresolvable';

export type TimetableCell =
  | {
      readonly kind: 'time';
      readonly time: Seconds;
      readonly handling: Handling;
      /** この升目が便の基準時刻か（仕様書 §6.1.1）。 */
      readonly isAnchor: boolean;
    }
  /** 経由するが時刻を出せない。 */
  | { readonly kind: 'empty'; readonly handling: Handling; readonly reason: EmptyReason }
  /** **その便は経由しない。** 直行便と箕面経由便を見分けるのはこれである。 */
  | { readonly kind: 'notServed' };

/** 時刻表の 1 列。 */
export interface TimetableColumn {
  readonly trip: Trip;
  /** 停車パターン。参照が壊れていれば `null`。 */
  readonly pattern: StopPattern | null;
  /** 停留所ごとの升目。行の並びは `stops` に従う。 */
  readonly cells: readonly TimetableCell[];
}

export interface Timetable {
  /** 行。縦軸の順に並ぶ。 */
  readonly stops: readonly Stop[];
  /** 列。便の並びは利用者が決めたものであり、並べ替えない。 */
  readonly columns: readonly TimetableColumn[];
}

/**
 * その方向の表に出す停留所（仕様書 §6.1.1）。
 *
 * その方向のいずれかのパターンに含まれる停留所の和集合から、`hiddenInEditor`
 * を除く。並びはダイヤグラムと同じ `axisPosition` の順とする。2 つの画面で
 * 停留所の並びが違うと、T-38 で選択を行き来させたときに目で追えなくなる。
 */
export function stopsForDirection(
  network: NetworkIndex,
  directionId: DirectionId,
): readonly Stop[] {
  const served = new Set<string>();
  for (const pattern of network.def.patterns) {
    if (pattern.directionId !== directionId) continue;
    for (const stop of pattern.stopSequence) served.add(stop.stopId);
  }

  return network.def.stops
    .filter((stop) => served.has(stop.stopId) && !stop.hiddenInEditor)
    .sort((a, b) => a.axisPosition - b.axisPosition);
}

/**
 * 便の運用番号に色を割り当てる（仕様書 §6.1.3、§5.8）。
 *
 * **空欄は未割当であり、色を持たない。** 空欄どうしを同じ色でまとめると、
 * まだ運用を決めていない便が「同じ車両で回る便」に見えてしまう。
 *
 * 渡すのはダイヤの全便である。運用は方向をまたぐため、片方向だけで割り当てると
 * 同じ運用が方向によって違う色になる。
 */
export function blockColorsOf(trips: readonly Trip[]): ReadonlyMap<string, string> {
  return assignBlockColors(trips.map((trip) => trip.blockId).filter((blockId) => blockId !== ''));
}

/**
 * 表を組み立てる。
 *
 * @param trips 出す便。既に方向で絞ってあること
 * @param stops 出す停留所。`stopsForDirection` の結果
 * @param times 便ごとの時刻。ストアのセレクタが計算済みのものを渡す
 */
export function buildTimetable(
  trips: readonly Trip[],
  stops: readonly Stop[],
  network: NetworkIndex,
  times: ReadonlyMap<string, ReadonlyMap<string, Seconds>>,
): Timetable {
  return {
    stops,
    columns: trips.map((trip) => buildColumn(trip, stops, network, times.get(trip.tripId))),
  };
}

function buildColumn(
  trip: Trip,
  stops: readonly Stop[],
  network: NetworkIndex,
  times: ReadonlyMap<string, Seconds> | undefined,
): TimetableColumn {
  const pattern = network.findPattern(trip.patternId) ?? null;
  if (pattern === null) {
    // 参照が壊れている便。経路が分からない以上、どの停留所も「経由しない」と
    // しか言えない。何が起きているかは検証（V-04）が伝える。
    return { trip, pattern, cells: stops.map(() => ({ kind: 'notServed' })) };
  }

  const handlings = new Map(pattern.stopSequence.map((s) => [s.stopId, s.handling]));
  const reason: EmptyReason = isAnchored(trip) ? 'unresolvable' : 'unset';

  const cells = stops.map((stop): TimetableCell => {
    const handling = handlings.get(stop.stopId);
    if (handling === undefined) return { kind: 'notServed' };

    const time = times?.get(stop.stopId);
    if (time === undefined) return { kind: 'empty', handling, reason };

    return { kind: 'time', time, handling, isAnchor: trip.anchor?.stopId === stop.stopId };
  });

  return { trip, pattern, cells };
}
