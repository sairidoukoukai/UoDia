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

import type { Trip } from '@/domain/model';
import type { NetworkIndex } from '@/domain/network';
import { expandDeadheads, patternDistance } from '@/domain/trip';
import type { Block } from './derive';

/** 走行距離の内訳（メートル）。距離の分からない区間があれば `null`。 */
export interface TotalDistances {
  /** 回送を**含む**。実際に走った距離。 */
  readonly total: number | null;
  /** 回送を**含まない**。客を運ぶために走った距離。 */
  readonly revenue: number | null;
  /** 回送距離。走った距離のうち客を乗せていない距離。 */
  readonly deadhead: number | null;
}

/** 運用 1 つの走行距離（メートル）。距離の分からない区間があれば `null`。 */
export interface BlockDistance extends TotalDistances {
  readonly blockId: string;
}

/**
 * 展開済みの便の並びから、走行・営業・回送の距離を求める。
 *
 * **運用ごととダイヤ全体で同じ関数を通す。** 別々に数えると、停留所間の回送
 * （`trips` に便として置かれる `isDeadhead`）が営業側に紛れ込んだり二重に
 * 足されたりして、運用の和と全体の和が食い違う。
 */
function distancesOf(trips: readonly Trip[], network: NetworkIndex): TotalDistances {
  let revenue = 0;
  let deadhead = 0;

  for (const trip of trips) {
    const pattern = network.patternIndex(trip.patternId);
    const distance = patternDistance(trip.patternId, network);
    if (pattern === undefined || distance === null) {
      return { total: null, revenue: null, deadhead: null };
    }
    if (pattern.pattern.isDeadhead) {
      deadhead += distance;
    } else {
      revenue += distance;
    }
  }

  return {
    total: revenue + deadhead,
    revenue,
    deadhead,
  };
}

/** 運用 1 つの走行距離。 */
export function blockDistance(block: Block, network: NetworkIndex): BlockDistance {
  return {
    blockId: block.blockId,
    ...distancesOf(
      block.trips.map((entry) => entry.trip),
      network,
    ),
  };
}

/** 運用ごとの走行距離。運用番号の昇順（`deriveBlocks` の並びのまま）。 */
export function blockDistances(
  blocks: readonly Block[],
  network: NetworkIndex,
): readonly BlockDistance[] {
  return blocks.map((block) => blockDistance(block, network));
}

/**
 * すべての系統の運行距離和・営業距離和・回送距離和を計算する。
 *
 * 出入庫回送を `expandDeadheads` で展開したうえで `distancesOf` に通す。
 * 距離が分からない区間があれば `null`。
 */
export function totalDistances(trips: readonly Trip[], network: NetworkIndex): TotalDistances {
  return distancesOf(expandDeadheads(trips, network), network);
}
