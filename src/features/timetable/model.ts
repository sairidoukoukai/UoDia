/**
 * 時刻表の中身を組み立てる（仕様書 §6.1.1、T-19）。
 *
 * 描く前に、表そのものを値として作る。**「何を出すか」と「どう出すか」を
 * 分ける**ことで、経由しない停留所の扱いやアンカーの位置といった、間違えると
 * 利用者が気づけない部分を React 抜きで確かめられる。
 */

import { assignBlockColors, blockNeighbors, neighborsOf } from '@/domain/block';
import type { DirectionId, Handling, StopPattern, Stop, Trip } from '@/domain/model';
import type { NetworkIndex } from '@/domain/network';
import type { Seconds } from '@/domain/time';
import { createPullIn, createPullOut, isAnchored, originTime, terminalTime } from '@/domain/trip';

/** 方向タブの見出し（仕様書 §6.1.1）。 */
export const DIRECTION_LABEL: Readonly<Record<DirectionId, string>> = {
  0: '吹田方面',
  1: '豊中方面',
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
      /*
       * **どの升目が基準時刻（アンカー）かは持たない**（T-60、#164、仕様書 v1.1 §5.1）。
       *
       * アンカー 1 点方式は**便の中で時刻が食い違わないようにするための設計**で
       * あって、利用者が意識する概念ではない。どの升目に打っても同じように打て
       * （打った升目がアンカーになる）、**振る舞いが同じものを見た目で分ける理由が
       * 無い。** 基準の位置は `Trip.anchor` にそのまま残っている。
       */
    }
  /** 経由するが時刻を出せない。 */
  | { readonly kind: 'empty'; readonly handling: Handling; readonly reason: EmptyReason }
  /** **その便は経由しない。** 直行便と箕面経由便を見分けるのはこれである。 */
  | { readonly kind: 'notServed' };

/**
 * 前運用・次運用の欄（仕様書 §6.1.7）。
 *
 * その便自身の `pullOut` / `pullIn` を第一に映し、立っていなければ同じ運用の
 * 直前・直後にある営業便の便番号を映す。**出区・入区の表示は運用番号に依存
 * しない。** 繋がる相手を映すほうだけが運用を要する。
 */
export type LinkCell =
  /** 出区・入区。車庫側の時刻。 */
  | { readonly kind: 'depot'; readonly time: Seconds }
  /** 出区・入区は付いているが、車庫側の時刻を表せない（V-04）。 */
  | { readonly kind: 'depotUnresolvable' }
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
  /** 前運用・次運用の欄（仕様書 §6.1.7）。 */
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
  const neighbors = blockNeighbors(trips, network);
  const links = new Map<string, TripLinks>();

  for (const trip of trips) {
    const { previous, next } = neighborsOf(neighbors, trip.tripId);
    links.set(trip.tripId, {
      previous: trip.pullOut
        ? depotCell(trip, createPullOut(trip, network), originTime, network)
        : revenueCell(previous, network, numbers),
      next: trip.pullIn
        ? depotCell(trip, createPullIn(trip, network), terminalTime, network)
        : revenueCell(next, network, numbers),
    });
  }

  return links;
}

/**
 * 出区・入区の欄。車庫側の時刻を出す。
 *
 * **時刻がまだ入っていない便では空欄にする。** 回送の時刻も決まらないのは当然で
 * あり、そこに「時刻を出せません」と出すのは、入力の途中である正常な状態を
 * 異常として見せることになる（仕様書 §6.1.7）。表せる範囲を外れている場合だけ
 * 知らせる。
 */
function depotCell(
  trip: Trip,
  deadhead: Trip | null,
  timeOf: (trip: Trip, network: NetworkIndex) => Seconds | null,
  network: NetworkIndex,
): LinkCell {
  if (!isAnchored(trip)) return NO_LINK;
  if (deadhead === null) return { kind: 'depotUnresolvable' };
  const time = timeOf(deadhead, network);
  return time === null ? { kind: 'depotUnresolvable' } : { kind: 'depot', time };
}

/**
 * 繋がる相手の欄。
 *
 * 出すのは**営業便の便番号だけ**である。隣が回送だということは、その回送を
 * 作った便との間に自分が挟まっているということであり、運用として破綻している
 * （V-01 が拾う）。そこに時刻を出すと「繋がっている」と読めてしまう。
 */
function revenueCell(
  trip: Trip | null,
  network: NetworkIndex,
  numbers: ReadonlyMap<string, string>,
): LinkCell {
  if (trip === null || network.findPattern(trip.patternId)?.isDeadhead !== false) return NO_LINK;
  return { kind: 'trip', label: numbers.get(trip.tripId) ?? '' };
}

export interface Timetable {
  /** 行。縦軸の順に並ぶ。 */
  readonly stops: readonly Stop[];
  /** 列。便の並びは利用者が決めたものであり、並べ替えない。 */
  readonly columns: readonly TimetableColumn[];
  /**
   * 便の右に並べる**空の列**の数（仕様書 §6.1.1、T-52）。
   *
   * 空の列は便ではない。打った時点でそれが便になるため、「便を追加する」という
   * 操作が要らなくなる。
   */
  readonly emptyColumns: number;
}

/**
 * 既定で並べる空の列の数。
 *
 * 表示領域の幅から本数を計算しない。計算するには列幅の実測と `ResizeObserver`
 * が要り、**表を描く前に幅を知る**必要が出る。1 画面ぶんに足りる本数を置いて
 * 残りを横スクロールに委ねるほうが単純であり、利用者から見た違いも無い。
 */
export const EMPTY_COLUMNS = 24;

/** 表に並ぶ列の総数。空の列を含む。 */
export function columnCount(timetable: Timetable): number {
  return timetable.columns.length + timetable.emptyColumns;
}

/**
 * その方向の表に出す停留所（仕様書 §6.1.1）。
 *
 * その方向のいずれかのパターンに含まれる停留所の和集合から、`hiddenInEditor`
 * と**営業所**を除く。営業所の行を置かないのは、回送便が列でなくなった以上
 * （§6.1.7）、営業便の列では常に空欄になるからである。出入区は前運用・次運用の
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
export function blockColorsOf(
  trips: readonly Trip[],
  chosen: Readonly<Record<string, string>> = {},
): ReadonlyMap<string, string> {
  return assignBlockColors(
    trips.map((trip) => trip.blockId).filter((blockId) => blockId !== ''),
    undefined,
    chosen,
  );
}

/**
 * 表を組み立てる。
 *
 * @param trips 出す便。既に方向で絞ってあること
 * @param stops 出す停留所。`stopsForDirection` の結果
 * @param times 便ごとの時刻。ストアのセレクタが計算済みのものを渡す
 * @param links 前後の繋がり（`buildTripLinks`）。渡さなければ前後は空欄になる
 * @param emptyColumns 便の右に並べる空の列の数（§6.1.1）
 */
export function buildTimetable(
  trips: readonly Trip[],
  stops: readonly Stop[],
  network: NetworkIndex,
  times: ReadonlyMap<string, ReadonlyMap<string, Seconds>>,
  links: ReadonlyMap<string, TripLinks> = new Map(),
  emptyColumns = EMPTY_COLUMNS,
): Timetable {
  return {
    stops,
    columns: trips.map((trip) =>
      buildColumn(trip, stops, network, times.get(trip.tripId), links.get(trip.tripId) ?? NO_LINKS),
    ),
    emptyColumns,
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

    return { kind: 'time', time, handling };
  });

  return { trip, pattern, cells, links };
}
