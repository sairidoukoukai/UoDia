/**
 * 状態から必要な値を取り出す（実装計画書 T-15）。
 *
 * **派生値はここで計算し、状態には持たない。** 運用の導出も検証も、便を
 * 書き換えれば結果が変わる。状態に持つと、書き換えるたびに更新して回る
 * 必要があり、更新し忘れた箇所が「画面によって値が違う」形で現れる。
 *
 * 新しい配列やオブジェクトを返すセレクタは記憶化する（`memo.ts`）。しないと
 * 呼ぶたびに参照が変わり、中身が同じでも再描画が起きる。
 */

import { deriveBlocks, type BlockDerivation } from '@/domain/block';
import type { DirectionId, Project, Service, Trip } from '@/domain/model';
import type { NetworkIndex } from '@/domain/network';
import { allTimes } from '@/domain/trip';
import type { Seconds } from '@/domain/time';
import {
  validateService,
  type ValidationIssue,
  type ValidationThresholds,
} from '@/domain/validation';
import { memoizeByIdentity } from './memo';
import type { AppState } from './types';

/** 便が 1 つも無いときに返す配列。参照を使い回して再描画を防ぐ。 */
const NO_TRIPS: readonly Trip[] = [];
const NO_ISSUES: readonly ValidationIssue[] = [];

/** 編集中のダイヤ。`view.activeServiceId` が指すもの。無ければ先頭。 */
export function selectActiveService(state: AppState): Service | null {
  const { project } = state;
  if (project === null) return null;

  const { activeServiceId } = project.view;
  if (activeServiceId === null) return project.services[0] ?? null;
  return (
    project.services.find((s) => s.serviceId === activeServiceId) ?? project.services[0] ?? null
  );
}

/** 編集中のダイヤの便。 */
export function selectTrips(state: AppState): readonly Trip[] {
  return selectActiveService(state)?.trips ?? NO_TRIPS;
}

/** 選択中の便の ID。 */
export function selectSelectedTripIds(state: AppState): readonly string[] {
  return state.ui.selectedTripIds;
}

const selectedTripsOf = memoizeByIdentity(
  (trips: readonly Trip[], selectedIds: readonly string[]): readonly Trip[] => {
    if (selectedIds.length === 0) return NO_TRIPS;
    const wanted = new Set(selectedIds);
    return trips.filter((trip) => wanted.has(trip.tripId));
  },
);

/** 選択中の便。並びは元の便の並びに従う。 */
export function selectSelectedTrips(state: AppState): readonly Trip[] {
  return selectedTripsOf(selectTrips(state), state.ui.selectedTripIds);
}

const tripsByDirectionOf = memoizeByIdentity(
  (
    trips: readonly Trip[],
    network: NetworkIndex | null,
    directionId: DirectionId,
  ): readonly Trip[] => {
    if (network === null) return NO_TRIPS;
    return trips.filter(
      (trip) => network.patternIndex(trip.patternId)?.pattern.directionId === directionId,
    );
  },
);

/**
 * 指定した方向の便（仕様書 §6.1.1 の方向タブ）。
 *
 * 方向は便ではなく停車パターンが持つため、ネットワーク定義を引いて判定する。
 */
export function selectTripsByDirection(state: AppState, directionId: DirectionId): readonly Trip[] {
  return tripsByDirectionOf(selectTrips(state), state.network, directionId);
}

/** 時刻表の方向タブが指している方向。 */
export function selectActiveDirection(state: AppState): DirectionId {
  return state.project?.view.activeDirection ?? 0;
}

/** 編集中のダイヤの、表示中の方向の便。 */
export function selectActiveDirectionTrips(state: AppState): readonly Trip[] {
  return selectTripsByDirection(state, selectActiveDirection(state));
}

const blocksOf = memoizeByIdentity(
  (trips: readonly Trip[], network: NetworkIndex | null): BlockDerivation | null =>
    network === null ? null : deriveBlocks(trips, network),
);

/** 運用の導出結果（仕様書 §5.8）。 */
export function selectBlocks(state: AppState): BlockDerivation | null {
  return blocksOf(selectTrips(state), state.network);
}

const validationOf = memoizeByIdentity(
  (
    trips: readonly Trip[],
    network: NetworkIndex | null,
    thresholds: ValidationThresholds | undefined,
  ): readonly ValidationIssue[] => {
    if (network === null) return NO_ISSUES;
    return thresholds === undefined
      ? validateService(trips, network)
      : validateService(trips, network, thresholds);
  },
);

/** ダイヤ検証の結果（仕様書 §6.6）。 */
export function selectValidation(
  state: AppState,
  thresholds?: ValidationThresholds,
): readonly ValidationIssue[] {
  return validationOf(selectTrips(state), state.network, thresholds);
}

const timesOf = memoizeByIdentity(
  (
    trips: readonly Trip[],
    network: NetworkIndex | null,
  ): ReadonlyMap<string, Map<string, Seconds>> => {
    const times = new Map<string, Map<string, Seconds>>();
    if (network === null) return times;
    for (const trip of trips) {
      times.set(trip.tripId, allTimes(trip, network));
    }
    return times;
  },
);

/**
 * 便ごとの全停留所の時刻。時刻表の表そのものにあたる。
 *
 * 便を 1 つずつ引くのではなくまとめて返すのは、時刻表が全便を一度に描くため。
 * 1 便ずつ記憶化しても、表を組み立てる側が結局すべてを走査する。
 */
export function selectAllTripTimes(state: AppState): ReadonlyMap<string, Map<string, Seconds>> {
  return timesOf(selectTrips(state), state.network);
}

/** ダイヤグラム・時刻表の表示設定（仕様書 §5.10）。 */
export function selectView(state: AppState): Project['view'] | null {
  return state.project?.view ?? null;
}

/** 表示する停留所。`hiddenInEditor` を除き、縦軸の順に並べる（仕様書 §6.2.1）。 */
const visibleStopsOf = memoizeByIdentity((network: NetworkIndex | null) => {
  if (network === null) return [];
  return network.def.stops
    .filter((stop) => !stop.hiddenInEditor)
    .sort((a, b) => a.axisPosition - b.axisPosition);
});

export function selectVisibleStops(state: AppState): ReturnType<typeof visibleStopsOf> {
  return visibleStopsOf(state.network);
}
