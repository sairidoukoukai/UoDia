/**
 * ダイヤグラム上での作図（仕様書 §6.3.3、T-30）。
 *
 * **停留所線を押した場所が、便の通る 1 点になる。** 終点を指定する操作は無い
 * ——経路も所要時間もパターンが決めており（§5.2、§5.6）、押した点から先は
 * 計算で決まる。線を引く操作にしないのはそのためである。
 *
 * ## 時刻表と同じ規則にする
 *
 * 時刻表では「打った行の停留所を、その時刻に通る便」ができる（§6.1.2）。
 * ここも同じにした。仕様書の文面は「始発停留所線上をクリック」だが、始発に
 * 限る理由が無い——アンカーはどの停留所にも置ける（§5.6）。**同じ操作の入口が
 * 2 つあるだけ**という形を保つほうが、覚えることが少ない。
 */

import { MAX_SECONDS, roundToGrain, type Seconds } from '@/domain/time';
import type { DiagramScene } from './scene';
import { axisToY, xToTime, type Viewport } from './viewport';

/**
 * 停留所線を押したと見なす距離（px）。
 *
 * スジの当たり判定（`HIT_TOLERANCE`）より広く取る。線を狙うのではなく
 * 「この停留所のこのあたり」を指す操作であり、外すと**何も起きない**ためである。
 */
export const STOP_LINE_TOLERANCE = 12;

/** 押した場所が指している、新しい便の 1 点。 */
export interface CreationTarget {
  readonly stopId: string;
  /** 5 分に丸めた時刻（§2.1）。 */
  readonly time: Seconds;
}

/**
 * その位置に便を作るなら、どの停留所の何時か。
 *
 * @returns 停留所線から遠い、目盛の上、表せる時刻の範囲外のいずれかなら `null`
 */
export function creationTargetAt(
  scene: DiagramScene,
  viewport: Viewport,
  x: number,
  y: number,
  tolerance = STOP_LINE_TOLERANCE,
): CreationTarget | null {
  // 縦軸ラベルと時刻目盛の帯には線を引けない。
  if (x < viewport.originX || y < viewport.originY) return null;

  const stop = nearestStopLine(scene, viewport, y, tolerance);
  if (stop === null) return null;

  const time = xToTime(x, viewport);
  // 表せる範囲（0:00〜47:55）を外れていれば作れない。`roundToGrain` は
  // 範囲外で例外を投げるため、ここで確かめてから丸める。
  if (time < 0 || time > MAX_SECONDS) return null;

  return { stopId: stop, time: roundToGrain(time) };
}

/** 押した高さに一番近い停留所線。許容範囲を超えていれば `null`。 */
function nearestStopLine(
  scene: DiagramScene,
  viewport: Viewport,
  y: number,
  tolerance: number,
): string | null {
  let best: string | null = null;
  let bestDistance = tolerance;

  for (const stop of scene.stops) {
    // **営業所レーンには引かせない。** 車庫発の便は出区として作られるもので
    // あり（§6.1.7）、営業便の始発にはならない。
    if (stop.isDepot) continue;

    const distance = Math.abs(axisToY(stop.axisPosition, viewport) - y);
    if (distance > bestDistance) continue;
    bestDistance = distance;
    best = stop.stopId;
  }

  return best;
}
