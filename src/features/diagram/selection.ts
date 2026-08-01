/**
 * スジを掴む（仕様書 §6.3.1、実装計画書 §3.4、T-28）。
 *
 * ## 見えている線と掴める線をずらさない
 *
 * 当たり判定は**描画と同じ座標列**（{@link tripPolylines}）を使う。両者が別々に
 * 座標を組むと、拡大率や折れ点の扱いを片方だけ直した日に、**見えている場所と
 * 掴める場所が食い違う**。利用者から見れば「クリックしても選べない」であり、
 * 原因は画面のどこにも現れない。
 *
 * ## 総当たりでよい
 *
 * 100 便 × 約 4 区間 = 約 400 線分である（実装計画書 §3.4）。点と線分の距離を
 * 400 回計算しても 1ms に満たない。空間索引を持つと、便を書き換えるたびに索引を
 * 更新する責務が増える——**速くならない最適化のために状態が増える。**
 */

import type { SelectionRect } from '@/store';
import { tripPolylines, type ScreenPoint } from './drawTrips';
import type { DiagramScene, SceneTrip } from './scene';
import { screenRect, type ScreenRect, type Viewport } from './viewport';

/**
 * スジを掴めるとみなす距離（px）。
 *
 * 線の太さ（1.5px）より広く取る。**細い線をちょうど踏むことを求めない。**
 * 密集していても迷わないよう、広げすぎもしない。
 */
export const HIT_TOLERANCE = 6;

/**
 * その点で掴めるスジ。**最も近いものを 1 本だけ返す**（受入条件）。
 *
 * 密集した領域では複数のスジが許容範囲に入る。手前から順に走査して最初に
 * 見つけたものを返すと、**同じ場所を押すたびに違う便が選ばれる**ように見える。
 *
 * @returns 許容範囲内に無ければ `null`
 */
export function hitTrip(
  scene: DiagramScene,
  viewport: Viewport,
  point: ScreenPoint,
  tolerance: number = HIT_TOLERANCE,
): SceneTrip | null {
  let best: SceneTrip | null = null;
  let bestDistance = tolerance;

  for (const { trip, points } of tripPolylines(scene, viewport)) {
    for (let i = 1; i < points.length; i += 1) {
      const from = points[i - 1];
      const to = points[i];
      if (from === undefined || to === undefined) continue;

      const distance = distanceToSegment(point, from, to);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = trip;
      }
    }
  }

  return best;
}

/** 矩形に掛かるスジ。**触れていれば選ぶ**（囲み切ることを求めない）。 */
export function tripsInRect(
  scene: DiagramScene,
  viewport: Viewport,
  rect: SelectionRect,
): readonly SceneTrip[] {
  const box = screenRect(rect, viewport);
  const found: SceneTrip[] = [];

  for (const { trip, points } of tripPolylines(scene, viewport)) {
    for (let i = 1; i < points.length; i += 1) {
      const from = points[i - 1];
      const to = points[i];
      if (from === undefined || to === undefined) continue;

      if (segmentIntersectsRect(from, to, box)) {
        found.push(trip);
        break;
      }
    }
  }

  return found;
}

/**
 * 点と線分の距離。
 *
 * 線分の**内側に落ちない**垂線を扱うため、媒介変数を 0〜1 に収める。収めないと、
 * 線分を延長した先の点まで近いと判定され、便の走っていない時間帯を押しても
 * 選べてしまう。
 */
export function distanceToSegment(point: ScreenPoint, a: ScreenPoint, b: ScreenPoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;

  // 長さ 0 の線分（同じ時刻に 2 度通る折れ点）。点どうしの距離になる。
  if (lengthSquared === 0) return Math.hypot(point.x - a.x, point.y - a.y);

  const t = clamp01(((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared);
  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
}

/**
 * 線分が矩形に掛かるか（Liang-Barsky）。
 *
 * 4 辺それぞれについて線分の媒介変数の範囲を削っていき、範囲が残れば掛かって
 * いる。端点が中にある場合も、削る辺が無いまま範囲が残るため同じ判定で済む。
 */
function segmentIntersectsRect(a: ScreenPoint, b: ScreenPoint, rect: ScreenRect): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const edges: readonly (readonly [number, number])[] = [
    [-dx, a.x - rect.left],
    [dx, rect.right - a.x],
    [-dy, a.y - rect.top],
    [dy, rect.bottom - a.y],
  ];

  let enter = 0;
  let leave = 1;

  for (const [direction, distance] of edges) {
    if (direction === 0) {
      // 辺に平行。外側にあるならどこまで行っても掛からない。
      if (distance < 0) return false;
      continue;
    }
    const t = distance / direction;
    if (direction < 0) {
      if (t > leave) return false;
      if (t > enter) enter = t;
    } else {
      if (t < enter) return false;
      if (t < leave) leave = t;
    }
  }

  return true;
}

/**
 * クリックしたあとの選択（仕様書 §6.3.1）。
 *
 * **選ぶ単位は保存されている便である。** 回送スジを掴んでも、選ばれるのは
 * それを生んだ営業便になる（`SceneTrip.sourceTripId`）。
 *
 * @param additive <kbd>Ctrl</kbd> を押しているか
 */
export function nextSelection(
  current: readonly string[],
  hit: string | null,
  additive: boolean,
): readonly string[] {
  if (hit === null) {
    // 何も無い場所を押したら選択を解く。Ctrl を押しているときは、外した拍子に
    // 積み上げた選択が消えるのを防ぐため何もしない。
    return additive ? current : [];
  }
  if (!additive) return [hit];

  // 既に選ばれているものを Ctrl + クリックしたら外す。
  return current.includes(hit) ? current.filter((id) => id !== hit) : [...current, hit];
}

/** 矩形で囲んだあとの選択。<kbd>Ctrl</kbd> を押していれば足す。 */
export function selectionAfterRect(
  current: readonly string[],
  ids: readonly string[],
  additive: boolean,
): readonly string[] {
  if (!additive) return [...new Set(ids)];
  return [...new Set([...current, ...ids])];
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
