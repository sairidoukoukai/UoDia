/**
 * 選ばれたスジを画面に入れる（仕様書 §6.3.1、T-38）。
 *
 * **必要なときだけ動かす。** 選んだスジが既に見えているなら、視野は動かさない
 * ——時刻表で列を押すたびにダイヤグラムが飛んでは、見比べることができない。
 *
 * ## 循環しない理由
 *
 * ここは**選択から視野を決める**だけであり、視野は選択に影響しない。しかも
 * 一度寄せれば見えている状態になるため、同じ入力をもう一度与えても `null` を
 * 返す（べき等）。往復して揺れ続ける経路が存在しない。
 *
 * ## どちらの画面から選んでも同じ関数でよい
 *
 * ダイヤグラムでスジを押して選んだ場合、そのスジは定義により見えている。
 * したがって「動かす必要があるか」を見るだけで、**選択がどこで起きたかを
 * 知る必要がない。**
 */

import type { DiagramView } from '@/domain/model';
import { SECONDS_PER_MINUTE } from '@/domain/time';
import { clampScroll, sameView, type AxisBounds } from './interaction';
import type { DiagramScene } from './scene';
import { viewportEndAxis, viewportEndTime, type Viewport } from './viewport';

/** 寄せたときに、スジの手前に残す余白（分）。 */
export const REVEAL_LEAD_MINUTES = 15;

/** 寄せたときに、スジの上に残す余白（軸の単位）。 */
export const REVEAL_LEAD_AXIS = 4;

/** 選ばれたスジが占める範囲。 */
interface Extent {
  readonly fromTime: number;
  readonly toTime: number;
  readonly fromAxis: number;
  readonly toAxis: number;
}

/**
 * 選ばれたスジを見せるための視野。動かす必要が無ければ `null`。
 *
 * @param bounds 縦軸の端（`axisBoundsOf`）。送りを描くものの範囲に収めるのに使う
 */
export function viewToReveal(
  scene: DiagramScene,
  viewport: Viewport,
  view: DiagramView,
  bounds: AxisBounds,
): DiagramView | null {
  const extent = selectedExtent(scene, viewport);
  if (extent === null) return null;

  // **一部でも見えていれば動かさない。** 全体が入っていることまで求めると、
  // 長い便を選ぶたびに縮尺の合わない位置へ飛ぶ。
  const timeVisible =
    extent.fromTime <= viewportEndTime(viewport) && extent.toTime >= viewport.startTime;
  const axisVisible =
    extent.fromAxis <= viewportEndAxis(viewport) && extent.toAxis >= viewport.startAxis;
  if (timeVisible && axisVisible) return null;

  // 見えている向きは動かさない。横だけ外れているのに縦まで動かすと、
  // 見ていた停留所の帯が画面から消える。
  const next: DiagramView = {
    ...view,
    scrollTime: timeVisible
      ? view.scrollTime
      : extent.fromTime - REVEAL_LEAD_MINUTES * SECONDS_PER_MINUTE,
    scrollAxis: axisVisible ? view.scrollAxis : extent.fromAxis - REVEAL_LEAD_AXIS,
  };

  // **送りきれないなら動かさない。** 表示範囲の端より外にある便（22:00 以降）は、
  // 送っても画面に入らない。同じ値を返し続けると、呼ぶ側が「動いた」と受け取って
  // 描き直しを繰り返す。
  const clamped = clampScroll(next, viewport, bounds);
  return sameView(view, clamped) ? null : clamped;
}

/** 選ばれたスジが占める時刻と軸の範囲。選ばれていなければ `null`。 */
function selectedExtent(scene: DiagramScene, viewport: Viewport): Extent | null {
  const axisOf = new Map(scene.stops.map((stop) => [stop.stopId, stop.axisPosition]));

  let fromTime = Number.POSITIVE_INFINITY;
  let toTime = Number.NEGATIVE_INFINITY;
  let fromAxis = Number.POSITIVE_INFINITY;
  let toAxis = Number.NEGATIVE_INFINITY;

  for (const trip of scene.trips) {
    // **選択は保存されている便を指す**（§6.3.1）。回送スジも、それを生んだ
    // 営業便が選ばれていれば一緒に見せる。
    if (!scene.selectedTripIds.has(trip.sourceTripId)) continue;

    for (const point of trip.points) {
      const axis = axisOf.get(point.stopId);
      if (axis === undefined) continue;
      fromTime = Math.min(fromTime, point.time);
      toTime = Math.max(toTime, point.time);
      fromAxis = Math.min(fromAxis, axis);
      toAxis = Math.max(toAxis, axis);
    }
  }

  if (!Number.isFinite(fromTime) || !Number.isFinite(fromAxis)) return null;
  // 視野の大きさを持たない場面（描画前）では動かしようがない。
  if (viewport.width <= viewport.originX || viewport.height <= viewport.originY) return null;

  return { fromTime, toTime, fromAxis, toAxis };
}
