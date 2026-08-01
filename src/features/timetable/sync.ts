/**
 * 選択に時刻表を追随させる（仕様書 §6.3.1、T-38）。
 *
 * 選択は 1 か所にしかない（`ui.selectedTripIds`）。時刻表とダイヤグラムは
 * どちらもそれを見ているだけであり、**同期のための状態は無い。** ここにあるのは
 * 「選ばれた便を見せるには、どの方向を開けばよいか」という計算だけである。
 */

import type { DirectionId, Trip } from '@/domain/model';
import type { NetworkIndex } from '@/domain/network';

/**
 * 選ばれた便を見せるために開くべき方向。切り替える必要が無ければ `null`。
 *
 * **今の方向に 1 本でも選ばれた便があるなら動かさない。** 両方向にまたがる選択
 * （矩形選択やダイヤ間コピー）のたびに画面が飛ぶと、何を見ていたのか分からなく
 * なる。見えているものが 1 つでもあるなら、それで用は足りている。
 */
export function directionToShow(
  selected: readonly Trip[],
  current: DirectionId,
  network: NetworkIndex,
): DirectionId | null {
  let found: DirectionId | null = null;

  for (const trip of selected) {
    const directionId = network.patternIndex(trip.patternId)?.pattern.directionId;
    if (directionId === undefined) continue;
    if (directionId === current) return null;
    found ??= directionId;
  }

  return found;
}
