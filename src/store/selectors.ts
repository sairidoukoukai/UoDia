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
import type { DirectionId, NetworkDef, Project, Service, Trip } from '@/domain/model';
import { buildNetworkIndex, type NetworkIndex } from '@/domain/network';
import type { FileHandle } from '@/platform';
import { allTimes, numberTrips } from '@/domain/trip';
import type { Seconds } from '@/domain/time';
import {
  validateService,
  type ValidationIssue,
  type ValidationThresholds,
} from '@/domain/validation';
import { canRedo, canUndo } from './history';
import { memoizeByIdentity } from './memo';
import type { AppState } from './types';

/** 便が 1 つも無いときに返す配列。参照を使い回して再描画を防ぐ。 */
const NO_TRIPS: readonly Trip[] = [];
const NO_ISSUES: readonly ValidationIssue[] = [];
const NO_SERVICES: readonly Service[] = [];
const NO_NUMBERS: ReadonlyMap<string, string> = new Map();

const networkOf = memoizeByIdentity((def: NetworkDef | null): NetworkIndex | null =>
  def === null ? null : buildNetworkIndex(def),
);

/**
 * ネットワーク定義の索引（T-07）。
 *
 * 状態が持つのは素の定義であり（`types.ts`）、索引はここで組み立てる。定義が
 * 変わらないかぎり同じ索引を返すため、区間所要時間を編集したときだけ組み直る。
 *
 * 索引の構築は R-03・R-06・R-10 を前提とし、破られていれば例外を投げる。定義が
 * 状態に入る経路は `setNetworkDef`（`loadNetworkDef` が検証済み）と `execute`
 * （変更時に `validateNetwork` を通す）だけであり、**検証を通っていない定義は
 * ここに届かない**。
 */
export function selectNetwork(state: AppState): NetworkIndex | null {
  return networkOf(state.networkDef);
}

/** undo できるか（メニュー項目の有効・無効に使う）。 */
export function selectCanUndo(state: AppState): boolean {
  return canUndo(state.history);
}

export function selectCanRedo(state: AppState): boolean {
  return canRedo(state.history);
}

/** 次に取り消される操作の名前。無ければ `null`。 */
export function selectUndoLabel(state: AppState): string | null {
  return state.history.past.at(-1)?.label ?? null;
}

/** 次にやり直される操作の名前。無ければ `null`。 */
export function selectRedoLabel(state: AppState): string | null {
  return state.history.future[0]?.label ?? null;
}

/**
 * 保存していない変更があるか（仕様書 §6.8）。
 *
 * 保存した時点の内容と**参照が同じか**だけを見る。真偽値の旗を立て回すより、
 * 更新の漏れが「未保存」側に倒れるぶん安全である（`types.ts`）。
 */
export function selectIsDirty(state: AppState): boolean {
  return state.project !== null && state.project !== state.file.savedProject;
}

/** 保存先。まだ保存していなければ `null`。 */
export function selectFileHandle(state: AppState): FileHandle | null {
  return state.file.handle;
}

/** ダイヤの一覧（仕様書 §5.7）。ダイヤ間コピーの写し先を選ぶのに使う。 */
export function selectServices(state: AppState): readonly Service[] {
  return state.project?.services ?? NO_SERVICES;
}

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
  return tripsByDirectionOf(selectTrips(state), selectNetwork(state), directionId);
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
  return blocksOf(selectTrips(state), selectNetwork(state));
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
  return validationOf(selectTrips(state), selectNetwork(state), thresholds);
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
  return timesOf(selectTrips(state), selectNetwork(state));
}

const tripNumbersOf = memoizeByIdentity(
  (trips: readonly Trip[], network: NetworkIndex | null): ReadonlyMap<string, string> =>
    network === null ? NO_NUMBERS : numberTrips(trips, network),
);

/**
 * 便番号（仕様書 §6.1.6）。**便は番号を持たない。**
 *
 * 便に書き込むと、1 便の時刻を変えるたびに全便が書き換わり、取り消しの単位が
 * 「1 便の移動」ではなく「全便の書き換え」になる。ここで導出すれば、番号は
 * 便が変わったときにだけ計算し直される。
 */
export function selectTripNumbers(state: AppState): ReadonlyMap<string, string> {
  return tripNumbersOf(selectTrips(state), selectNetwork(state));
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
  return visibleStopsOf(selectNetwork(state));
}
