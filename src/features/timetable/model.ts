/**
 * 時刻表の中身を組み立てる（仕様書 §6.1.1、T-19）。
 *
 * 描く前に、表そのものを値として作る。**「何を出すか」と「どう出すか」を
 * 分ける**ことで、経由しない停留所の扱いやアンカーの位置といった、間違えると
 * 利用者が気づけない部分を React 抜きで確かめられる。
 */

import { assignBlockColors, blockNeighbors } from '@/domain/block';
import type { DirectionId, Handling, StopPattern, Stop, Trip } from '@/domain/model';
import type { NetworkIndex } from '@/domain/network';
import type { Seconds } from '@/domain/time';
import { isAnchored, originStopId, originTime, terminalStopId, terminalTime } from '@/domain/trip';

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

/**
 * 前運用・後運用の欄（仕様書 §6.1.7）。
 *
 * 同じ運用の直前・直後にあるものを映す。回送なら車庫側の時刻、営業便ならその
 * 便番号。
 */
export type LinkCell =
  /** 出区・入区の回送。`tripId` はその回送便を消すために持つ。 */
  | { readonly kind: 'depot'; readonly time: Seconds; readonly tripId: string }
  /** 同じ運用の営業便。 */
  | { readonly kind: 'trip'; readonly label: string }
  /** 何も繋がっていない。 */
  | { readonly kind: 'none' };

/** 便の前後の繋がり。 */
export interface TripLinks {
  readonly previous: LinkCell;
  readonly next: LinkCell;
}

const NO_LINK: LinkCell = { kind: 'none' };
const NO_LINKS: TripLinks = { previous: NO_LINK, next: NO_LINK };

/** 時刻表の 1 列。 */
export interface TimetableColumn {
  readonly trip: Trip;
  /** 停車パターン。参照が壊れていれば `null`。 */
  readonly pattern: StopPattern | null;
  /** 停留所ごとの升目。行の並びは `stops` に従う。 */
  readonly cells: readonly TimetableCell[];
  /** 前運用・後運用の欄（仕様書 §6.1.7）。 */
  readonly links: TripLinks;
}

/**
 * 便ごとの前後の繋がりを求める（仕様書 §6.1.7）。
 *
 * 渡すのはダイヤの**全便**である。運用は方向をまたぐため、片方向だけを見ると
 * 繋がりの半分を見失う。
 *
 * @param numbers 便番号の対応表（`selectTripNumbers`）
 */
export function buildTripLinks(
  trips: readonly Trip[],
  network: NetworkIndex,
  numbers: ReadonlyMap<string, string>,
): Map<string, TripLinks> {
  const links = new Map<string, TripLinks>();

  for (const [tripId, { previous, next }] of blockNeighbors(trips, network)) {
    links.set(tripId, {
      previous: linkTo(previous, network, numbers, 'previous'),
      next: linkTo(next, network, numbers, 'next'),
    });
  }

  return links;
}

/**
 * 前後の欄に何を出すか。
 *
 * **回送なら何でも時刻を出すわけではない。** 前運用に出すのは車庫から来る回送
 * （出庫）だけ、後運用に出すのは車庫へ向かう回送（入庫）だけである。向きの合わ
 * ない回送が隣にある状態は運用として破綻しており（V-01 が拾う）、そこに時刻を
 * 出すと「繋がっている」と読めてしまう。空欄にしておけば、押して出区・入区を
 * 付け直せる。
 */
function linkTo(
  trip: Trip | null,
  network: NetworkIndex,
  numbers: ReadonlyMap<string, string>,
  side: 'previous' | 'next',
): LinkCell {
  if (trip === null) return NO_LINK;

  if (network.findPattern(trip.patternId)?.isDeadhead !== true) {
    return { kind: 'trip', label: numbers.get(trip.tripId) ?? '' };
  }

  // 前運用は車庫を出る時刻、後運用は車庫に着く時刻。
  const time =
    side === 'previous'
      ? depotSide(trip, network, originStopId, originTime)
      : depotSide(trip, network, terminalStopId, terminalTime);
  return time === null ? NO_LINK : { kind: 'depot', time, tripId: trip.tripId };
}

/** その端が営業所であれば、その時刻。違えば `null`。 */
function depotSide(
  trip: Trip,
  network: NetworkIndex,
  stopOf: (trip: Trip, network: NetworkIndex) => string | null,
  timeOf: (trip: Trip, network: NetworkIndex) => Seconds | null,
): Seconds | null {
  const stopId = stopOf(trip, network);
  if (stopId === null || network.findStop(stopId)?.isDepot !== true) return null;
  return timeOf(trip, network);
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
 * と**営業所**を除く。営業所の行を置かないのは、回送便が列でなくなった以上
 * （§6.1.7）、営業便の列では常に空欄になるからである。出入区は前運用・後運用の
 * 欄が受け持つ。
 *
 * ## 並びは進行方向に従う
 *
 * 吹田方面は `axisPosition` の昇順（豊中学舎が上）、豊中方面は降順（工学部前が
 * 上）。**どちらのタブでも時刻が上から下へ進む。** 表を縦に読む動きと便の走る
 * 向きを一致させるためである。
 *
 * **ダイヤグラムの縦軸は反転しない**（§6.2.1）。両方向を 1 枚に重ねて描くため、
 * 向きを決められない。時刻表と上下が一致しない場合があるが、2 つの画面の選択は
 * 停留所ではなく便どうしで結ぶため（T-38）支障はない。
 *
 * 千里営業所は縦軸の外側にあり、この規則の例外となる。営業所は方向にかかわらず
 * 端に置かれるため、吹田方面では出庫回送が、豊中方面では入庫回送が、時刻の進む
 * 向きと逆になる。
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

  // 豊中方面は工学部前が始発であり、`axisPosition` の昇順だと時刻が下から上へ
  // 進む。向きを反転させる。
  const sign = directionId === 0 ? 1 : -1;
  return network.def.stops
    .filter((stop) => served.has(stop.stopId) && !stop.hiddenInEditor && !stop.isDepot)
    .sort((a, b) => sign * (a.axisPosition - b.axisPosition));
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
 * @param links 前後の繋がり（`buildTripLinks`）。渡さなければ前後は空欄になる
 */
export function buildTimetable(
  trips: readonly Trip[],
  stops: readonly Stop[],
  network: NetworkIndex,
  times: ReadonlyMap<string, ReadonlyMap<string, Seconds>>,
  links: ReadonlyMap<string, TripLinks> = new Map(),
): Timetable {
  return {
    stops,
    columns: trips.map((trip) =>
      buildColumn(trip, stops, network, times.get(trip.tripId), links.get(trip.tripId) ?? NO_LINKS),
    ),
  };
}

function buildColumn(
  trip: Trip,
  stops: readonly Stop[],
  network: NetworkIndex,
  times: ReadonlyMap<string, Seconds> | undefined,
  links: TripLinks,
): TimetableColumn {
  const pattern = network.findPattern(trip.patternId) ?? null;
  if (pattern === null) {
    // 参照が壊れている便。経路が分からない以上、どの停留所も「経由しない」と
    // しか言えない。何が起きているかは検証（V-04）が伝える。
    return { trip, pattern, cells: stops.map(() => ({ kind: 'notServed' })), links };
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

  return { trip, pattern, cells, links };
}
