/**
 * 運用の走行距離（#161、仕様書 v1.1 §6.1.2）。
 *
 * **回送込みと回送抜きの 2 つを出す。** 片方だけでは答えられない問いがそれぞれに
 * ある——**車がその日に何 km 走ったか**（燃料・車両の傷み）は回送を含み、
 * **客をどれだけ運ぶために走ったか**（1 便あたりの効率）は含まない。導出はどちらも
 * 同じ和であり、足す対象が違うだけである。
 *
 * **「営業キロ」とは呼ばない。** 営業キロは運賃計算のための擬制キロを指す語で
 * あり、本ソフトに運賃の概念は無い。ここで出すのは**実際に走る距離**である。
 *
 * **永続化しない。** 区間表と便から毎回導ける値であり、保存すると区間表を直した
 * ときに古い値が残る（仕様書 §5.8 と同じ方針）。
 */

import type { NetworkIndex } from '@/domain/network';
import { patternDistance, sumDistances } from '@/domain/trip';
import type { Block, BlockTrips } from './derive';

/** 運用 1 つの走行距離（メートル）。距離の分からない区間があれば `null`。 */
export interface BlockDistance {
  readonly blockId: string;
  /** 回送を**含む**。その日にその車が走った距離。 */
  readonly total: number | null;
  /** 回送を**含まない**。客を運ぶために走った距離。 */
  readonly revenue: number | null;
}

/** 便の並びから距離を足す。`deadheads` が `false` なら回送を除く。 */
function sumOf(trips: BlockTrips, network: NetworkIndex, deadheads: boolean): number | null {
  return sumDistances(
    trips
      .filter((trip) => deadheads || !trip.isDeadhead)
      .map((trip) => patternDistance(trip.trip.patternId, network)),
  );
}

/** 運用 1 つの走行距離。 */
export function blockDistance(block: Block, network: NetworkIndex): BlockDistance {
  return {
    blockId: block.blockId,
    total: sumOf(block.trips, network, true),
    revenue: sumOf(block.trips, network, false),
  };
}

/** 運用ごとの走行距離。運用番号の昇順（`deriveBlocks` の並びのまま）。 */
export function blockDistances(
  blocks: readonly Block[],
  network: NetworkIndex,
): readonly BlockDistance[] {
  return blocks.map((block) => blockDistance(block, network));
}
