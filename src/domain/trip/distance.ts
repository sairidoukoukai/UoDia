/**
 * 便の距離（#161、仕様書 v1.1 §6.1）。
 *
 * **所要時間と同じ理由で、距離も区間が持つ。** 停留所が持つ設計では「次まで
 * 何 km」と書けず（次が箕面学舎かコンベンションセンター前かで値が違う）、
 * 停車パターンが持つ設計では同じ区間の距離が重複する（仕様書 §5.2）。
 *
 * **メートルの整数で扱う。** km の小数で足し合わせると丸め誤差が乗り、10 区間
 * を足して `12.299999999999999 km` と出る。km に直すのは画面に出す直前だけである。
 *
 * ## 分からないことは分からないと返す
 *
 * 距離が 1 区間でも欠けていれば `null` を返す。**0 として足さない**——入力漏れが
 * 「短い運用」に化けると、抜けていることに気づかないまま読まれる。
 */

import type { NetworkIndex } from '@/domain/network';
import { adjacentPairs } from '@/domain/util';

/** km へ直す（画面に出す直前だけで使う）。 */
export const METERS_PER_KM = 1000;

/**
 * その停車パターンを 1 回走る距離（メートル）。
 *
 * @returns 通る区間の距離が 1 つでも欠けていれば `null`
 */
export function patternDistance(patternId: string, network: NetworkIndex): number | null {
  const pattern = network.patternIndex(patternId);
  if (pattern === undefined) return null;

  // **添字で辿らない。** `noUncheckedIndexedAccess` のもとでは `undefined` の
  // 分岐を書く羽目になり、それは到達しない道として残る。
  let total = 0;
  for (const [from, to] of adjacentPairs(pattern.offsets.map(([stopId]) => stopId))) {
    const distance = network.distanceMeters(from, to);
    // **区間が無いのか、距離が入っていないのかは区別しない。** どちらでも
    // 合計は出せない（`NetworkIndex.distanceMeters`）。
    if (distance === undefined) return null;
    total += distance;
  }

  return total;
}

/**
 * 距離の合計。**1 つでも `null` があれば `null`。**
 *
 * 足せるものだけ足して返す道は採らない——**一部が抜けた合計は、抜けていることに
 * 気づかないまま読まれる。**
 */
export function sumDistances(distances: readonly (number | null)[]): number | null {
  let total = 0;
  for (const distance of distances) {
    if (distance === null) return null;
    total += distance;
  }
  return total;
}

/** メートルを km の文字列にする（小数第 1 位まで）。 */
export function formatKm(meters: number): string {
  return `${(meters / METERS_PER_KM).toFixed(1)} km`;
}
