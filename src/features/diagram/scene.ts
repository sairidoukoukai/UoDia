/**
 * ダイヤグラムに描くもの（実装計画書 §3.5、T-24）。
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
 */

import type { ColorMode, DirectionId, GridStyle, Stop, Trip } from '@/domain/model';
import type { NetworkIndex } from '@/domain/network';
import type { Seconds } from '@/domain/time';
import { allTimes, expandDeadheads } from '@/domain/trip';
import {
  memoizeByIdentity,
  selectNetwork,
  selectTripNumbers,
  selectTrips,
  selectVisibleStops,
  type AppState,
} from '@/store';

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
  readonly patternId: string;
  /** パターンの色（仕様書 §6.2.2）。 */
  readonly color: string;
  readonly directionId: DirectionId;
  /** 回送は破線で描く（§6.2.2）。 */
  readonly isDeadhead: boolean;
  readonly blockId: string;
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
  readonly axis: string;
}

/** ダイヤグラムに描くものの全体。 */
export interface DiagramScene {
  readonly stops: readonly SceneStop[];
  readonly trips: readonly SceneTrip[];
  readonly selectedTripIds: ReadonlySet<string>;
  /** パターンで着色するか、運用で着色するか（仕様書 §6.2.4）。 */
  readonly colorMode: ColorMode;
  /** 便番号（仕様書 §6.1.6）。スジのラベルに使う。 */
  readonly tripNumbers: ReadonlyMap<string, string>;
  readonly theme: SceneTheme;
}

const NO_STOPS: readonly SceneStop[] = [];
const NO_TRIPS: readonly SceneTrip[] = [];

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

const tripsOf = memoizeByIdentity(
  (
    trips: readonly Trip[],
    network: NetworkIndex,
    visible: ReadonlySet<string>,
  ): readonly SceneTrip[] => {
    const scene: SceneTrip[] = [];

    // 回送便は保存されていない（仕様書 §6.1.7）。描く直前に展開する。
    for (const trip of expandDeadheads(trips, network)) {
      const pattern = network.patternIndex(trip.patternId);
      if (pattern === undefined) continue;

      const times = allTimes(trip, network);
      const points: ScenePoint[] = [];
      for (const [stopId] of pattern.offsets) {
        const time = times.get(stopId);
        if (time === undefined || !visible.has(stopId)) continue;
        points.push({ stopId, time });
      }
      // 折れ点が無い便は線にならない。時刻が未入力か、表せる範囲を外れている。
      if (points.length === 0) continue;

      scene.push({
        tripId: trip.tripId,
        patternId: trip.patternId,
        color: pattern.pattern.color,
        directionId: pattern.pattern.directionId,
        isDeadhead: pattern.pattern.isDeadhead,
        blockId: trip.blockId,
        points,
      });
    }

    return scene;
  },
);

const sceneOf = memoizeByIdentity(
  (
    stops: readonly SceneStop[],
    trips: readonly SceneTrip[],
    selectedTripIds: readonly string[],
    colorMode: ColorMode,
    tripNumbers: ReadonlyMap<string, string>,
    theme: SceneTheme,
  ): DiagramScene => ({
    stops,
    trips,
    selectedTripIds: new Set(selectedTripIds),
    colorMode,
    tripNumbers,
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

  return sceneOf(
    stops,
    network === null ? NO_TRIPS : tripsOf(selectTrips(state), network, visibleIdsOf(stops)),
    state.ui.selectedTripIds,
    state.project?.view.colorMode ?? 'pattern',
    selectTripNumbers(state),
    theme,
  );
}
