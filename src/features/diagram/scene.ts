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
  type PatternStyleChoice,
  type SelectionRect,
  type TripShift,
} from '@/store';
import { readableOn } from './color';
import { buildBlockLinks, type BlockLinkEntry, type SceneBlockLink } from './blockLinks';
import { patternStyles, SOLID } from './tripStyle';

/** 縦軸に並ぶ停留所。 */
export interface SceneStop {
  readonly stopId: string;
  /**
   * 縦軸に出す名前。**正式名ではなく略称である**（`Stop.shortName`、#116）。
   *
   * 正式名は GTFS の `stop_name` として持ち続けるが、画面に出すのは略称にする
   * ——「コンベンションセンター前」を出すために縦軸の欄を 144px 取ると、その
   * ぶん描画領域が狭くなる。
   */
  readonly shortName: string;
  /** 縦軸の位置（仕様書 §6.2.1）。 */
  readonly axisPosition: number;
  readonly gridStyle: GridStyle;
}

/** スジの折れ点。 */
export interface ScenePoint {
  readonly stopId: string;
  readonly time: Seconds;
  /**
   * 縦軸に無い点（営業所）。**ヒゲの先として描く**（#118、仕様書 §6.2.2）。
   *
   * 営業所には縦軸上の置き場所が無い（3 拠点のいずれからも 20 分にある）。
   * 位置を決めて線を引くと、その傾きが速さを表しているように読めてしまう。
   * 縦にどれだけ伸ばすかは**画面の量（px）で決める**——軸の単位で決めると、
   * 縦に拡げるたびにヒゲが伸び、横断が戻ってくる。
   *
   * 横（時刻）は正直に置く。出庫 7:40 の便ならヒゲの端は 7:40 の位置にあり、
   * 目盛から読める。
   */
  readonly offAxis?: true;
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
  /** 折返しの接続線（#167、仕様書 v1.1 §5.3）。 */
  readonly blockLinks: readonly SceneBlockLink[];
  /** 選択されている**保存されている便**の ID（`SceneTrip.sourceTripId` と照合する）。 */
  readonly selectedTripIds: ReadonlySet<string>;
  /** 引きずっている最中の選択の枠（仕様書 §6.3.1、T-28）。掴んでいなければ `null`。 */
  readonly selectionRect: SelectionRect | null;
  /** 引きずっている最中の移動量（仕様書 §6.3.2、T-29）。掴んでいなければ `null`。 */
  readonly tripShift: TripShift | null;
  readonly theme: SceneTheme;
}

/** 表示フィルタ（仕様書 §6.2.4）。 */
interface SceneFilter {
  readonly patterns: ReadonlySet<string>;
  readonly blocks: ReadonlySet<string>;
  readonly directions: ReadonlySet<DirectionId>;
  readonly showDeadhead: boolean;
  /** 折返しの接続線を出すか（#167）。 */
  readonly showBlockLinks: boolean;
}

const NO_STOPS: readonly SceneStop[] = [];
const NO_TRIPS: readonly SceneTrip[] = [];
const NO_IDS: readonly string[] = [];
const NO_DIRECTIONS: readonly DirectionId[] = [];

/** 運用の色を 1 つも選んでいない状態。**同じ参照を返す**（記憶化の鍵になる）。 */
const NO_BLOCK_COLORS: Readonly<Record<string, string>> = Object.freeze({});

/**
 * 縦軸に並ぶ停留所。**線種だけは利用者の上書きが勝つ**（§6.5.3、#133）。
 *
 * 上書きは疎な表であり、入っていない停留所は `route.json` の値をそのまま使う。
 * ここで当てるのは、**`route.json` を書き換えないため**である——どの停留所が
 * 幹線かは路線の事実であり、その人の見やすさとは別物である。
 */
const stopsOf = memoizeByIdentity(
  (stops: readonly Stop[], overrides: Readonly<Record<string, GridStyle>>): readonly SceneStop[] =>
    stops.map((stop) => ({
      stopId: stop.stopId,
      shortName: stop.shortName,
      axisPosition: stop.axisPosition,
      gridStyle: overrides[stop.stopId] ?? stop.gridStyle,
    })),
);

const visibleIdsOf = memoizeByIdentity(
  (stops: readonly SceneStop[]): ReadonlySet<string> => new Set(stops.map((stop) => stop.stopId)),
);

/**
 * 営業所の停留所 ID。
 *
 * 縦軸には並ばない（#118）が、折れ点からは落とさない。落とすと回送スジが 1 点に
 * なり、**出入庫を付け忘れていることが絵から消える。**
 */
const depotIdsOf = memoizeByIdentity(
  (network: NetworkIndex): ReadonlySet<string> =>
    new Set(network.def.stops.filter((stop) => stop.isDepot).map((stop) => stop.stopId)),
);

/**
 * パターンの色と線種。**利用者の上書きが勝つ**（§6.5.3、#147）。
 *
 * 凡例（`PatternList`）も同じ関数を通る。別々に決めると、一覧とスジが違う姿に
 * なる。
 */
const stylesOf = memoizeByIdentity(
  (network: NetworkIndex, choices: Readonly<Record<string, PatternStyleChoice>>) =>
    patternStyles(network.def.patterns, choices),
);

const filterOf = memoizeByIdentity(
  (
    hiddenPatternIds: readonly string[],
    hiddenBlockIds: readonly string[],
    hiddenDirections: readonly DirectionId[],
    showDeadhead: boolean,
    showBlockLinks: boolean,
  ): SceneFilter => ({
    patterns: new Set(hiddenPatternIds),
    blocks: new Set(hiddenBlockIds),
    directions: new Set(hiddenDirections),
    showDeadhead,
    showBlockLinks,
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
    /** 地色。**色を読めるように調えるために要る**（§9.4、T-39）。 */
    background: string,
    /** パターンの色と線種の上書き（設定。#147）。 */
    patternChoices: Readonly<Record<string, PatternStyleChoice>>,
    /** 運用ごとに選んだ色（プロジェクト。#148）。 */
    blockChoices: Readonly<Record<string, string>>,
  ): readonly SceneTrip[] => {
    const styles = stylesOf(network, patternChoices);
    const depots = depotIdsOf(network);
    // **色は隠されている便も含めて割り当てる。** 表示を切り替えるたびに残った
    // 運用の色が入れ替わっては、色で運用を追えない。
    //
    // 運用番号が空欄の便は数に入れない。空欄は「まだ割り当てていない」ことで
    // あって 1 つの運用ではなく、数に入れると他の運用の色が 1 つずつずれる。
    const blockColors =
      colorMode === 'block'
        ? assignBlockColors(
            trips.map((trip) => trip.blockId).filter((blockId) => blockId !== ''),
            undefined,
            blockChoices,
          )
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
        if (time === undefined) continue;
        if (visible.has(stopId)) {
          points.push({ stopId, time });
        } else if (depots.has(stopId)) {
          // 営業所は縦軸に無い。**時刻は持たせたまま**ヒゲの先として残す（#118）。
          points.push({ stopId, time, offAxis: true });
        }
      }
      // 折れ点が無い便は線にならない。時刻が未入力か、表せる範囲を外れている。
      if (points.length === 0) continue;

      const source = sourceTripId(trip.tripId);
      scene.push({
        tripId: trip.tripId,
        sourceTripId: source,
        patternId: trip.patternId,
        // **持っている色は 1 つ。** 暗い配色では明るさだけを調えて出す
        // （`readableOn`）。route.json の値は書き換えない。
        color: readableOn(
          blockColors?.get(trip.blockId) ??
            styles.get(trip.patternId)?.color ??
            pattern.pattern.color,
          background,
        ),
        lineDash: styles.get(trip.patternId)?.lineDash ?? SOLID,
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

const NO_LINKS: readonly SceneBlockLink[] = [];

/**
 * 折返しの接続線（#167、T-62）。
 *
 * **回送便を落とす前に組む。** 出入区を隠していても、車庫へ帰る運用に線を
 * 引いてはならない——隠したのは見え方の話であって、そこで待っていなかった
 * という事実は変わらない。
 */
const linksOf = memoizeByIdentity(
  (
    trips: readonly Trip[],
    network: NetworkIndex,
    stops: readonly SceneStop[],
    visible: ReadonlySet<string>,
    filter: SceneFilter,
    background: string,
    blockChoices: Readonly<Record<string, string>>,
  ): readonly SceneBlockLink[] => {
    if (!filter.showBlockLinks) return NO_LINKS;

    const colors = assignBlockColors(
      trips.map((trip) => trip.blockId).filter((blockId) => blockId !== ''),
      undefined,
      blockChoices,
    );

    const entries: BlockLinkEntry[] = [];
    for (const trip of expandDeadheads(shownTrips(trips, network, filter), network)) {
      const pattern = network.patternIndex(trip.patternId);
      if (pattern === undefined) continue;

      const times = allTimes(trip, network);
      const originTime = times.get(pattern.originStopId);
      const terminalTime = times.get(pattern.terminalStopId);
      if (originTime === undefined || terminalTime === undefined) continue;

      entries.push({
        blockId: trip.blockId,
        originStopId: pattern.originStopId,
        originTime,
        terminalStopId: pattern.terminalStopId,
        terminalTime,
        onAxis: visible.has(pattern.originStopId) && visible.has(pattern.terminalStopId),
      });
    }

    const positions = new Map(stops.map((stop) => [stop.stopId, stop.axisPosition]));
    const values = [...positions.values()];
    const midpoint = values.length === 0 ? 0 : (Math.min(...values) + Math.max(...values)) / 2;

    return buildBlockLinks(
      entries,
      // **着色モードによらず運用の色で引く。** 繋がりは運用そのものの事実で
      // あり、パターンには属さない。
      (blockId) => {
        const color = colors.get(blockId);
        return color === undefined ? undefined : readableOn(color, background);
      },
      { of: (stopId) => positions.get(stopId), midpoint },
    );
  },
);

const sceneOf = memoizeByIdentity(
  (
    stops: readonly SceneStop[],
    trips: readonly SceneTrip[],
    blockLinks: readonly SceneBlockLink[],
    selectedTripIds: readonly string[],
    selectionRect: SelectionRect | null,
    tripShift: TripShift | null,
    theme: SceneTheme,
  ): DiagramScene => ({
    stops,
    trips,
    blockLinks,
    selectedTripIds: new Set(selectedTripIds),
    selectionRect,
    tripShift,
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
  const stops =
    network === null ? NO_STOPS : stopsOf(selectVisibleStops(state), state.settings.stopGridStyles);
  const view = state.project?.view;

  // **拡大率とスクロール位置は見ない。** 同じ `view` の中にあるが、変わっても
  // 描くものは変わらない。ここで見ると、パンするたびにスジを組み直すことになる。
  const filter = filterOf(
    view?.hiddenPatternIds ?? NO_IDS,
    view?.hiddenBlockIds ?? NO_IDS,
    view?.hiddenDirections ?? NO_DIRECTIONS,
    view?.showDeadhead ?? true,
    view?.showBlockLinks ?? true,
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
          theme.background,
          state.settings.patternStyles,
          view?.blockColors ?? NO_BLOCK_COLORS,
        ),
    network === null
      ? NO_LINKS
      : linksOf(
          selectTrips(state),
          network,
          stops,
          visibleIdsOf(stops),
          filter,
          theme.background,
          view?.blockColors ?? NO_BLOCK_COLORS,
        ),
    state.ui.selectedTripIds,
    state.ui.selectionRect,
    state.ui.tripShift,
    theme,
  );
}
