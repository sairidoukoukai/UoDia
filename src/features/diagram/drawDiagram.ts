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
 * 重ねる順は**背景 → 格子（T-25）→ スジ（T-26）→ 枠**である。
 */

import type { DrawContext } from './drawContext';
import { drawGrid } from './drawGrid';
import { drawTrips } from './drawTrips';
import type { DiagramScene } from './scene';
import type { Viewport } from './viewport';

export function drawDiagram(ctx: DrawContext, scene: DiagramScene, viewport: Viewport): void {
  ctx.save();
  drawBackground(ctx, scene, viewport);
  drawGrid(ctx, scene, viewport);
  drawTrips(ctx, scene, viewport);
  // 枠は一番上に描く。格子やスジに埋もれると、描画領域の端が分からなくなる。
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
  // 格子が破線を残している。実線に戻さないと枠が途切れる。
  ctx.setLineDash([]);
  ctx.beginPath();
  // 縦軸（左端）。
  ctx.moveTo(viewport.originX, viewport.originY);
  ctx.lineTo(viewport.originX, viewport.height);
  // 横軸（上端）。
  ctx.moveTo(viewport.originX, viewport.originY);
  ctx.lineTo(viewport.width, viewport.originY);
  ctx.stroke();
}
