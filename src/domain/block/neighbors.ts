/**
 * 運用の中の前後関係（仕様書 §6.1.7、T-50）。
 *
 * 時刻表は回送便を独立した列にせず、営業便の**前運用・後運用の欄**に畳み込んで
 * 表示する。そのために「この便の直前・直後に何があるか」が要る。
 *
 * **繋がりはデータに持たない。** 同じ運用番号の便を始発時刻の昇順に並べたものが
 * 行路であり（仕様書 §5.8）、前後関係はそこから決まる。次便を指す欄を便に
 * 持たせると、時刻を動かしたときに繋がりだけが古いまま残る。
 */

import type { Trip } from '@/domain/model';
import type { NetworkIndex } from '@/domain/network';
import { deriveBlocks } from './derive';

/** 同じ運用の中で、その便の前後にある便。 */
export interface BlockNeighbors {
  readonly previous: Trip | null;
  readonly next: Trip | null;
}

/** 前も後も無い便に返す値。参照を使い回す。 */
const ALONE: BlockNeighbors = { previous: null, next: null };

/**
 * 便ごとの前後の便を求める。
 *
 * 運用番号が空欄の便、時刻が未入力の便、参照が壊れた便は行路に並べようがなく、
 * 表に含まれない（前後とも無いものとして扱う）。
 */
export function blockNeighbors(
  trips: readonly Trip[],
  network: NetworkIndex,
): Map<string, BlockNeighbors> {
  const neighbors = new Map<string, BlockNeighbors>();

  for (const block of deriveBlocks(trips, network).blocks) {
    block.trips.forEach(({ trip }, index) => {
      neighbors.set(trip.tripId, {
        previous: block.trips[index - 1]?.trip ?? null,
        next: block.trips[index + 1]?.trip ?? null,
      });
    });
  }

  return neighbors;
}

/** その便の前後。表に無ければ「前も後も無い」を返す。 */
export function neighborsOf(
  neighbors: ReadonlyMap<string, BlockNeighbors>,
  tripId: string,
): BlockNeighbors {
  return neighbors.get(tripId) ?? ALONE;
}
