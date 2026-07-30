/**
 * ダイヤグラムを描く（仕様書 §6.2、実装計画書 §3.5、T-24）。
 *
 * **引数は 3 つだけである。** 描画先・描くもの・視野。ストアも DOM も
 * `window` も見ない。この形を守っている限り、v2 の書き出しは「オフスクリーンの
 * `ctx` と別の視野を渡す」だけで済む。
 *
 * ```ts
 * drawDiagram(screenCtx, scene, viewportOf(view, width, height));   // 画面
 * drawDiagram(exportCtx, scene, { ...viewport, pxPerMinute: 8 });   // 書き出し
 * ```
 *
 * T-24 が描くのは**背景と描画領域の枠**までである。停留所線・時刻線・目盛は
 * T-25、スジは T-26 が同じ形の関数を足して重ねる。
 */

import type { DiagramScene } from './scene';
import { axisToY, timeToX, type Viewport } from './viewport';

/** 描画に使う 2D コンテキスト。**canvas そのものは見ない。** */
export type DrawContext = Pick<
  CanvasRenderingContext2D,
  'save' | 'restore' | 'clearRect' | 'fillRect' | 'beginPath' | 'moveTo' | 'lineTo' | 'stroke'
> & {
  fillStyle: string | CanvasGradient | CanvasPattern;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  lineWidth: number;
};

export function drawDiagram(ctx: DrawContext, scene: DiagramScene, viewport: Viewport): void {
  ctx.save();
  drawBackground(ctx, scene, viewport);
  drawAxisFrame(ctx, scene, viewport);
  ctx.restore();
}

/**
 * 背景を塗る。
 *
 * `clearRect` だけでは済まない。**書き出し先の canvas は透明で始まる**ため、
 * 塗らずに渡すと背景が抜けた画像になる。画面では CSS の背景が透けて同じ色に
 * 見えるので、塗り忘れに気づけない。
 */
function drawBackground(ctx: DrawContext, scene: DiagramScene, viewport: Viewport): void {
  ctx.clearRect(0, 0, viewport.width, viewport.height);
  ctx.fillStyle = scene.theme.background;
  ctx.fillRect(0, 0, viewport.width, viewport.height);
}

/**
 * 描画領域の枠を描く。
 *
 * 縦軸ラベルと横軸目盛の余白（`originX` / `originY`）の内側が描画領域である。
 * 枠があると、座標変換が視野の端をどこに置いているかが目で確かめられる。
 */
function drawAxisFrame(ctx: DrawContext, scene: DiagramScene, viewport: Viewport): void {
  ctx.strokeStyle = scene.theme.axis;
  ctx.lineWidth = 1;
  ctx.beginPath();
  // 縦軸（左端）。
  ctx.moveTo(viewport.originX, viewport.originY);
  ctx.lineTo(viewport.originX, viewport.height);
  // 横軸（上端）。
  ctx.moveTo(viewport.originX, viewport.originY);
  ctx.lineTo(viewport.width, viewport.originY);
  ctx.stroke();
}

/**
 * 便のスジが通る座標の並び。
 *
 * 描画（T-26）と当たり判定（T-28）が同じ列を使う。両者が別々に座標を組むと、
 * **見えている線と掴める線がずれる**。
 *
 * 縦軸に無い停留所は場面に含まれていない（`scene.ts`）ため、ここでは折れ点が
 * 必ず座標を持つ。
 */
export function tripPolyline(
  trip: DiagramScene['trips'][number],
  scene: DiagramScene,
  viewport: Viewport,
): readonly { readonly x: number; readonly y: number }[] {
  const axis = new Map(scene.stops.map((stop) => [stop.stopId, stop.axisPosition]));
  const points: { x: number; y: number }[] = [];

  for (const point of trip.points) {
    const axisPosition = axis.get(point.stopId);
    if (axisPosition === undefined) continue;
    points.push({ x: timeToX(point.time, viewport), y: axisToY(axisPosition, viewport) });
  }

  return points;
}
