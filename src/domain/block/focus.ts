/**
 * フォーカス範囲での数え方（#166、仕様書 v1.1 §6.4.2）。
 *
 * **按分しない。**
 *
 * | 数 | 数え方 |
 * | --- | --- |
 * | 距離 | その区間を通る時刻が範囲に入る**区間だけ**を足す（区間単位で切る） |
 * | 定員 | その区間を通る時刻が範囲に入る**便**の定員を足す。定員は切らない |
 *
 * 区間の途中で切ると、その区間の何割を走ったかを時刻から按分することになる。
 * **バスが等速で走っている前提を持ち込むことになり、持ち込む理由が無い。**
 * 定員を按分すれば `37.5 人` が出る——**人は割れない。**
 */

import type { Trip } from '@/domain/model';
import type { NetworkIndex } from '@/domain/network';
import type { Seconds } from '@/domain/time';
import { allTimes } from '@/domain/trip';
import { adjacentPairs } from '@/domain/util';

/** 数える時間の範囲。`null` なら 1 日全部。 */
export interface TimeRange {
  readonly from: Seconds;
  readonly to: Seconds;
}

/**
 * その便が範囲の中で走った距離（メートル）。
 *
 * **区間単位で切る。** 区間を通り始める時刻が範囲に入っていれば、その区間を
 * 丸ごと数える。
 *
 * @returns 通る区間の距離が 1 つでも欠けていれば `null`
 */
export function tripDistanceInRange(
  trip: Trip,
  network: NetworkIndex,
  range: TimeRange | null,
): number | null {
  const pattern = network.patternIndex(trip.patternId);
  if (pattern === undefined) return null;

  const times = allTimes(trip, network);
  let total = 0;

  for (const [from, to] of adjacentPairs(pattern.offsets.map(([stopId]) => stopId))) {
    const distance = network.distanceMeters(from, to);
    if (distance === undefined) return null;

    if (range !== null) {
      // **その区間を通り始める時刻で判定する。** 便の始発時刻で判定すると、
      // 8:55 発の便が 9:20 に通る区間が範囲から外れる。
      const at = times.get(from);
      if (at === undefined || at < range.from || at > range.to) continue;
    }
    total += distance;
  }

  return total;
}

/** 便の並びが範囲の中で走った距離。**1 つでも分からなければ `null`。** */
export function distanceInRange(
  trips: readonly Trip[],
  network: NetworkIndex,
  range: TimeRange | null,
): number | null {
  let total = 0;
  for (const trip of trips) {
    const distance = tripDistanceInRange(trip, network, range);
    if (distance === null) return null;
    total += distance;
  }
  return total;
}
