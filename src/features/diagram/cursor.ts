/**
 * カーソルが指している時刻と停留所（仕様書 §6.4 のステータスバー、T-32）。
 *
 * **5 分に丸めて返す。** 画面はどの位置でも指せるが、このソフトが扱える時刻は
 * 5 分刻みである（§2.1）。7:23 と出すと、そこに便を置けるように見える。
 *
 * 状態にもストアにも触れない純関数にしてあるのは、`viewport.ts` と同じ理由で
 * ある——画面の位置から意味を取り出す計算は、canvas があるかどうかと関わりが
 * 無い。
 */

import { MAX_SECONDS, roundToGrain, type Seconds } from '@/domain/time';
import type { DiagramScene } from './scene';
import { axisToY, xToTime, type Viewport } from './viewport';

/** カーソルが指しているもの。 */
export interface DiagramCursor {
  /** 5 分に丸めた時刻。 */
  readonly time: Seconds;
  /** 一番近い停留所。 */
  readonly stopId: string;
  readonly stopName: string;
}

/**
 * 画面上の位置が指す時刻と停留所。
 *
 * @param x canvas の左上を原点とする位置（CSS px）
 * @returns 目盛の上（描画領域の外）や、表せる時刻の範囲を外れているときは `null`
 */
export function cursorAt(
  scene: DiagramScene,
  viewport: Viewport,
  x: number,
  y: number,
): DiagramCursor | null {
  // 縦軸ラベルと時刻目盛の帯は「線を引く場所」ではない。指しているものが無い。
  if (x < viewport.originX || y < viewport.originY) return null;

  const time = xToTime(x, viewport);
  if (time < 0 || time > MAX_SECONDS) return null;

  const stop = nearestStop(scene, viewport, y);
  if (stop === null) return null;

  return { time: roundToGrain(time), stopId: stop.stopId, stopName: stop.stopName };
}

/** 画面上の縦位置に一番近い停留所。停留所が無ければ `null`。 */
function nearestStop(
  scene: DiagramScene,
  viewport: Viewport,
  y: number,
): { readonly stopId: string; readonly stopName: string } | null {
  let best: { readonly stopId: string; readonly stopName: string } | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const stop of scene.stops) {
    const distance = Math.abs(axisToY(stop.axisPosition, viewport) - y);
    if (distance >= bestDistance) continue;
    bestDistance = distance;
    best = { stopId: stop.stopId, stopName: stop.stopName };
  }

  return best;
}
