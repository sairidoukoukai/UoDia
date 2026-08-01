/**
 * ダイヤグラムに描くもの（実装計画書 §3.5、T-24／T-26）。
 *
 * 描画関数が受け取るのはこの 1 つの不変オブジェクトだけである。**ストアの形を
 * 描画側に見せない。** 見せると、状態の作りを変えるたびにレンダラを直すことに
 * なり、書き出し（v2）のために別の入力を渡すこともできなくなる。
 *
 * ## 折れ点はここで作る
 *
 * 便がどの停留所を何時に通るかは、パターンと区間所要時間から決まる導出値である
 * （仕様書 §5.6）。それを描画のたびに解き直させず、**あらかじめ座標の並びに
 * 近い形**（停留所と時刻の組）にして渡す。描画側は縦軸の位置を引いて線を繋ぐ
 * だけになる。
 *
 * ## 判断はここで済ませ、描画側には結果だけ渡す（T-26）
 *
 * 着色モード・表示フィルタ・便番号は、どれも「何を描くか」を決める設定である。
 * 決め方まで描画側に渡すと、`drawTrips` が `colorMode` を見て色を選ぶことになり、
 * **同じ判断が描画のたびに繰り返される。** ここで解いてしまえば、スジは色と
 * 線種と折れ点を持つだけの平らな並びになる。
 */

import { assignBlockColors } from '@/domain/block';
import type { ColorMode, DirectionId, GridStyle, Stop, Trip } from '@/domain/model';
import type { NetworkIndex } from '@/domain/network';
import type { Seconds } from '@/domain/time';
import { allTimes, expandDeadheads, sourceTripId } from '@/domain/trip';
import {
  memoizeByIdentity,
  selectNetwork,
  selectTripNumbers,
  selectTrips,
  selectVisibleStops,
  type AppState,
  type SelectionRect,
} from '@/store';
import { assignPatternDashes, SOLID } from './tripStyle';

/** 縦軸に並ぶ停留所。 */
export interface SceneStop {
  readonly stopId: string;
  readonly stopName: string;
  /** 縦軸の位置（仕様書 §6.2.1）。 */
  readonly axisPosition: number;
  readonly gridStyle: GridStyle;
  /** 千里営業所。縦軸の外側の専用レーンに置く（§6.2.1）。 */
  readonly isDepot: boolean;
}

/** スジの折れ点。 */
export interface ScenePoint {
  readonly stopId: string;
  readonly time: Seconds;
}

/** 1 本のスジ。 */
export interface SceneTrip {
  readonly tripId: string;
  /**
   * この線の元になっている**保存されている便**の `tripId`。
   *
   * 回送スジは営業便から展開された線であり（仕様書 §6.1.7）、`tripId` は
   * `t1#out` のような派生 ID を持つ。選択も当たり判定も「保存されている便」を
   * 単位とするため、描画側が `#out` という綴りを知らずに元の便を指せるように
   * しておく。営業便では `tripId` と同じ値になる。
   */
  readonly sourceTripId: string;
  readonly patternId: string;
  /** 描く色。着色モードを解いた結果である（仕様書 §6.2.4）。 */
  readonly color: string;
  /** 描く線種。色に頼らずパターンを見分けるための併用（§9.4）。 */
  readonly lineDash: readonly number[];
  readonly directionId: DirectionId;
  /** 回送は破線で描く（§6.2.2）。 */
  readonly isDeadhead: boolean;
  readonly blockId: string;
  /** スジに添える便番号（仕様書 §6.1.6）。回送は空文字（番号を持たない）。 */
  readonly tripNumber: string;
  /**
   * 経路の順に並んだ折れ点。**縦軸に出ない停留所は含まない。**
   *
   * 微生物研究所前（`hiddenInEditor`）を落とすことで、直行便がそこで折れずに
   * 貫通して描かれる（T-26 の受入条件）。
   */
  readonly points: readonly ScenePoint[];
}

/** 描画に使う色（仕様書 §9.4）。画面から読んで渡す（T-39 でテーマに追随させる）。 */
export interface SceneTheme {
  readonly background: string;
  /** 一番濃い線。枠・60 分線・停留所線（`bold` は太く、`normal` は細く）。 */
  readonly axis: string;
  /** 中間の線。30 分線・10 分線・`dashed` の停留所線。 */
  readonly grid: string;
  /** 一番淡い線。5 分線。 */
  readonly gridFaint: string;
  /** 目盛と停留所名の文字。 */
  readonly label: string;
  /** 千里営業所の専用レーンの地色（仕様書 §6.2.1）。 */
  readonly lane: string;
}

/**
 * ダイヤグラムに描くものの全体。
 *
 * **着色モードも便番号の対応表も持たない。** どちらもスジの色と文字に解けて
 * いる。同じ事実を 2 か所に持つと、片方だけ古い状態を作れてしまう。
 */
export interface DiagramScene {
  readonly stops: readonly SceneStop[];
  readonly trips: readonly SceneTrip[];
  /** 選択されている**保存されている便**の ID（`SceneTrip.sourceTripId` と照合する）。 */
  readonly selectedTripIds: ReadonlySet<string>;
  /** 引きずっている最中の選択の枠（仕様書 §6.3.1、T-28）。掴んでいなければ `null`。 */
  readonly selectionRect: SelectionRect | null;
  readonly theme: SceneTheme;
}

/** 表示フィルタ（仕様書 §6.2.4）。 */
interface SceneFilter {
  readonly patterns: ReadonlySet<string>;
  readonly blocks: ReadonlySet<string>;
  readonly directions: ReadonlySet<DirectionId>;
  readonly showDeadhead: boolean;
}

const NO_STOPS: readonly SceneStop[] = [];
const NO_TRIPS: readonly SceneTrip[] = [];
const NO_IDS: readonly string[] = [];
const NO_DIRECTIONS: readonly DirectionId[] = [];

const stopsOf = memoizeByIdentity((stops: readonly Stop[]): readonly SceneStop[] =>
  stops.map((stop) => ({
    stopId: stop.stopId,
    stopName: stop.stopName,
    axisPosition: stop.axisPosition,
    gridStyle: stop.gridStyle,
    isDepot: stop.isDepot,
  })),
);

const visibleIdsOf = memoizeByIdentity(
  (stops: readonly SceneStop[]): ReadonlySet<string> => new Set(stops.map((stop) => stop.stopId)),
);

/** パターンの線種。路線図が変わらないかぎり組み直さない。 */
const dashesOf = memoizeByIdentity((network: NetworkIndex) =>
  assignPatternDashes(network.def.patterns),
);

const filterOf = memoizeByIdentity(
  (
    hiddenPatternIds: readonly string[],
    hiddenBlockIds: readonly string[],
    hiddenDirections: readonly DirectionId[],
    showDeadhead: boolean,
  ): SceneFilter => ({
    patterns: new Set(hiddenPatternIds),
    blocks: new Set(hiddenBlockIds),
    directions: new Set(hiddenDirections),
    showDeadhead,
  }),
);

const tripsOf = memoizeByIdentity(
  (
    trips: readonly Trip[],
    network: NetworkIndex,
    visible: ReadonlySet<string>,
    filter: SceneFilter,
    colorMode: ColorMode,
    numbers: ReadonlyMap<string, string>,
  ): readonly SceneTrip[] => {
    const dashes = dashesOf(network);
    // **色は隠されている便も含めて割り当てる。** 表示を切り替えるたびに残った
    // 運用の色が入れ替わっては、色で運用を追えない。
    //
    // 運用番号が空欄の便は数に入れない。空欄は「まだ割り当てていない」ことで
    // あって 1 つの運用ではなく、数に入れると他の運用の色が 1 つずつずれる。
    const blockColors =
      colorMode === 'block'
        ? assignBlockColors(trips.map((trip) => trip.blockId).filter((blockId) => blockId !== ''))
        : null;

    const scene: SceneTrip[] = [];

    // **絞り込んでから展開する。** 回送便は営業便から作られる線であり、元の便を
    // 隠したなら、その出区・入区も画面から消える（仕様書 §6.2.4）。
    for (const trip of expandDeadheads(shownTrips(trips, network, filter), network)) {
      const pattern = network.patternIndex(trip.patternId);
      if (pattern === undefined) continue;
      if (pattern.pattern.isDeadhead && !filter.showDeadhead) continue;

      const times = allTimes(trip, network);
      const points: ScenePoint[] = [];
      for (const [stopId] of pattern.offsets) {
        const time = times.get(stopId);
        if (time === undefined || !visible.has(stopId)) continue;
        points.push({ stopId, time });
      }
      // 折れ点が無い便は線にならない。時刻が未入力か、表せる範囲を外れている。
      if (points.length === 0) continue;

      const source = sourceTripId(trip.tripId);
      scene.push({
        tripId: trip.tripId,
        sourceTripId: source,
        patternId: trip.patternId,
        color: blockColors?.get(trip.blockId) ?? pattern.pattern.color,
        lineDash: dashes.get(trip.patternId) ?? SOLID,
        directionId: pattern.pattern.directionId,
        isDeadhead: pattern.pattern.isDeadhead,
        blockId: trip.blockId,
        tripNumber: numbers.get(trip.tripId) ?? '',
        points,
      });
    }

    return scene;
  },
);

/** 表示フィルタを通った便。 */
function shownTrips(
  trips: readonly Trip[],
  network: NetworkIndex,
  filter: SceneFilter,
): readonly Trip[] {
  if (filter.patterns.size === 0 && filter.blocks.size === 0 && filter.directions.size === 0) {
    return trips;
  }
  return trips.filter((trip) => {
    if (filter.patterns.has(trip.patternId)) return false;
    if (filter.blocks.has(trip.blockId)) return false;
    const directionId = network.patternIndex(trip.patternId)?.pattern.directionId;
    return directionId === undefined || !filter.directions.has(directionId);
  });
}

const sceneOf = memoizeByIdentity(
  (
    stops: readonly SceneStop[],
    trips: readonly SceneTrip[],
    selectedTripIds: readonly string[],
    selectionRect: SelectionRect | null,
    theme: SceneTheme,
  ): DiagramScene => ({
    stops,
    trips,
    selectedTripIds: new Set(selectedTripIds),
    selectionRect,
    theme,
  }),
);

/**
 * 状態からダイヤグラムに描くものを組み立てる。
 *
 * @param theme 画面から読んだ色。**同じ参照を渡し続けること** — 毎回作り直すと
 *   場面も組み立て直しになる（`memoizeByIdentity`）
 */
export function selectDiagramScene(state: AppState, theme: SceneTheme): DiagramScene {
  const network = selectNetwork(state);
  const stops = network === null ? NO_STOPS : stopsOf(selectVisibleStops(state));
  const view = state.project?.view;

  // **拡大率とスクロール位置は見ない。** 同じ `view` の中にあるが、変わっても
  // 描くものは変わらない。ここで見ると、パンするたびにスジを組み直すことになる。
  const filter = filterOf(
    view?.hiddenPatternIds ?? NO_IDS,
    view?.hiddenBlockIds ?? NO_IDS,
    view?.hiddenDirections ?? NO_DIRECTIONS,
    view?.showDeadhead ?? true,
  );

  return sceneOf(
    stops,
    network === null
      ? NO_TRIPS
      : tripsOf(
          selectTrips(state),
          network,
          visibleIdsOf(stops),
          filter,
          view?.colorMode ?? 'pattern',
          selectTripNumbers(state),
        ),
    state.ui.selectedTripIds,
    state.ui.selectionRect,
    theme,
  );
}
