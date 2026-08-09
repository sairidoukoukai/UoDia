/**
 * 箱ダイヤを描く（仕様書 v2 §5.5、#194、T-79）。**v2 で唯一の新しい絵である。**
 *
 * ## 形が意味を持っている
 *
 * ```
 *         豊中      箕面      吹田
 *          │        │        │
 * 運用A    ├─────────────────┤        ← 1 便目（豊中 → 吹田）
 *          │                 │
 *          │        ┌────────┤        ← 2 便目（吹田 → 箕面）
 *          │        │
 *          ├────────┘                 ← 3 便目（箕面 → 豊中）
 *          │
 * ```
 *
 * **往復すると閉じて四角形になり、途中で折り返せば「コ」の字になる。** これが
 * 「箱」と呼ばれる所以である。四角が横に広ければ端から端まで走っており、狭ければ
 * 区間便である。**表に組み直すと、この形が消える。**
 *
 * ## ダイヤグラムと共有するのは器だけ
 *
 * `DrawContext` で描く（§5.5.5）。`PdfDrawContext` を渡せば、**箱ダイヤの
 * 停留所名も字として PDF に入る。**
 *
 * **描画そのものは共有できない。** ダイヤグラムは横軸が時刻・縦軸が停留所で
 * スジが斜めに走る。箱ダイヤは横軸が停留所・縦に段が下り、便は水平の棒である。
 * **軸が入れ替わっている。**
 */

import { formatTime } from '@/domain/time';
import type { DrawContext } from '@/features/diagram';
import type { BlockChartScene, ChartBar, ChartBlock } from './scene';
import { axisToX, blockRowOffsets, chartHeight, rowToY, type BlockChartViewport } from './viewport';

/** 棒の太さ（px）。 */
const BAR_WIDTH = 4;
/** 折り返しの縦線の太さ。**棒より細くする**——主役は棒である。 */
const LINK_WIDTH = 1.5;
/** 停留所線の太さ。 */
const STOP_LINE_WIDTH = 1;

/** 出入庫の印の大きさ（一辺の半分、px）。 */
const MARK_SIZE = 3.5;
/** 印を棒からどれだけ離すか。 */
const MARK_GAP = 5;

/*
  **画面の字より大きい。** これは紙 1 枚に載る図であり、A4 の上で読まれる。
  0.48 倍で紙に落ちるため、14px は約 6.7pt になる。
*/
const STOP_LABEL_FONT = '15px system-ui, sans-serif';
const BLOCK_LABEL_FONT = '15px system-ui, sans-serif';
const TIME_FONT = '11px system-ui, sans-serif';

/** 時刻を棒の端からどれだけ離すか。 */
const TIME_GAP = 4;
/** 字を出す下限の段の高さ（px）。**これより詰まったら時刻を出さない。** */
const TIME_MIN_ROW_HEIGHT = 14;

export function drawBlockChart(
  ctx: DrawContext,
  scene: BlockChartScene,
  viewport: BlockChartViewport,
): void {
  ctx.save();
  drawBackground(ctx, scene, viewport);
  drawStopAxis(ctx, scene, viewport);

  const offsets = blockRowOffsets(scene, viewport);
  for (const [index, block] of scene.blocks.entries()) {
    drawBlock(ctx, scene, viewport, block, offsets[index] ?? 0);
  }

  ctx.restore();
}

/**
 * 地色を塗る。
 *
 * **塗らずに渡すと背景が抜けた絵になる**（書き出し先の canvas は透明で始まる）。
 * ダイヤグラムと同じ理由である。
 *
 * **塗るのは割り当てられたマスだけである**（T-87）。0 から塗ると、格子に割った
 * ときに**先に描いたマスを消す**——同じ紙に 6 回描くためである。
 */
function drawBackground(
  ctx: DrawContext,
  scene: BlockChartScene,
  viewport: BlockChartViewport,
): void {
  const width = viewport.width - viewport.left;
  const height = viewport.height - viewport.top;
  ctx.clearRect(viewport.left, viewport.top, width, height);
  ctx.fillStyle = scene.theme.background;
  ctx.fillRect(viewport.left, viewport.top, width, height);
}

/**
 * 横軸（停留所）。**線は縦に引く。**
 *
 * ダイヤグラムでは停留所が横線として現れるが、ここでは縦線である。軸が
 * 入れ替わっているためであり、**同じ `axisPosition` を寝かせただけ**である。
 */
function drawStopAxis(
  ctx: DrawContext,
  scene: BlockChartScene,
  viewport: BlockChartViewport,
): void {
  const bottom = Math.min(viewport.height, chartHeight(scene, viewport));
  const columns = stopColumns(scene);

  ctx.strokeStyle = scene.theme.grid;
  ctx.lineWidth = STOP_LINE_WIDTH;
  ctx.setLineDash([]);
  ctx.beginPath();
  for (const column of columns) {
    const x = axisToX(column.axisPosition, viewport);
    ctx.moveTo(x, viewport.originY);
    ctx.lineTo(x, bottom);
  }
  ctx.stroke();

  // 見出しは帯（`top` から `originY` まで）の真ん中に置く。**0 から測らない**
  // ——格子に割ると、下の行のマスは 0 から始まらない（T-87）。
  const baseline = (viewport.top + viewport.originY) / 2;

  ctx.fillStyle = scene.theme.label;
  ctx.font = STOP_LABEL_FONT;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const [index, column] of columns.entries()) {
    ctx.fillText(
      column.label,
      axisToX(column.axisPosition, viewport),
      baseline,
      labelWidth(columns, index, viewport),
    );
  }
}

/**
 * 見出しに使ってよい幅（px）。
 *
 * **隣の線までの間合いで決まる**（T-87）。マスが狭くなると線と線の間隔も
 * 狭くなり、固定の幅では隣の名前と重なる。**重なった 2 つは、どちらも読めない。**
 * 縮めて出せば、少なくとも位置は読める。
 */
function labelWidth(
  columns: readonly { readonly axisPosition: number }[],
  index: number,
  viewport: BlockChartViewport,
): number {
  const here = columns[index]?.axisPosition ?? 0;
  const gaps = [columns[index - 1], columns[index + 1]]
    .filter((column) => column !== undefined)
    .map((column) => Math.abs(column.axisPosition - here) * viewport.pxPerAxisUnit);

  // 隣が無ければ（列が 1 本しかない）マスの幅に任せる。
  if (gaps.length === 0) return viewport.width - viewport.originX;
  // 中心に置くため、間合いの半分ずつを両側から使える。
  return Math.min(...gaps);
}

/**
 * 横軸の 1 本の線と、その名前。
 *
 * **同じ `axisPosition` の停留所は 1 本にまとめる。** コンベンションセンター前と
 * 人間科学部前は**同じ場所の上りと下り**であり、軸の上では同じ点である。別々に
 * 引くと線が重なり、名前も重なって読めない。
 */
function stopColumns(
  scene: BlockChartScene,
): readonly { readonly axisPosition: number; readonly label: string }[] {
  const names = new Map<number, string[]>();

  for (const stop of scene.stops) {
    const found = names.get(stop.axisPosition);
    if (found === undefined) {
      names.set(stop.axisPosition, [stop.shortName]);
    } else if (!found.includes(stop.shortName)) {
      found.push(stop.shortName);
    }
  }

  return [...names]
    .sort(([a], [b]) => a - b)
    .map(([axisPosition, labels]) => ({ axisPosition, label: labels.join('・') }));
}

/** 運用 1 つ。 */
function drawBlock(
  ctx: DrawContext,
  scene: BlockChartScene,
  viewport: BlockChartViewport,
  block: ChartBlock,
  firstRow: number,
): void {
  const xOf = (stopId: string): number | null => {
    const stop = scene.stops.find((entry) => entry.stopId === stopId);
    return stop === undefined ? null : axisToX(stop.axisPosition, viewport);
  };

  // 運用番号は左の欄に置く。**先頭の段に揃える**——運用の始まりがどこかが
  // 分からないと、段の並びがどの車のものか読めない。
  ctx.fillStyle = scene.theme.label;
  ctx.font = BLOCK_LABEL_FONT;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.fillText(
    block.blockId,
    viewport.originX - 6,
    rowToY(firstRow, viewport),
    viewport.originX - 6,
  );

  drawLinks(ctx, viewport, block, firstRow, xOf);
  drawBars(ctx, viewport, block, firstRow, xOf);
  drawMarks(ctx, viewport, block, firstRow, xOf);
  if (viewport.rowHeight >= TIME_MIN_ROW_HEIGHT) {
    drawTimes(ctx, scene, viewport, block, firstRow, xOf);
  }
}

/** 停留所 ID から x を引く関数。縦軸に無い停留所は `null`。 */
type StopX = (stopId: string) => number | null;

/**
 * 折り返しの縦線。**段と段を繋ぐ。**
 *
 * 前の便の終着と次の便の始発は同じ停留所であるはずだが、**そうでないことも
 * ある**（運用が破綻している。V-02 が拾う）。その場合は斜めに繋ぐ——繋がない
 * と、段がばらばらに浮いて理由が読めない。
 */
function drawLinks(
  ctx: DrawContext,
  viewport: BlockChartViewport,
  block: ChartBlock,
  firstRow: number,
  xOf: StopX,
): void {
  ctx.strokeStyle = block.color;
  ctx.lineWidth = LINK_WIDTH;
  ctx.setLineDash([]);
  ctx.beginPath();

  for (const [index, bar] of block.bars.entries()) {
    if (index === 0) continue;
    const previous = block.bars[index - 1];
    if (previous === undefined) continue;

    const from = xOf(previous.terminalStopId);
    const to = xOf(bar.originStopId);
    if (from === null || to === null) continue;

    ctx.moveTo(from, rowToY(firstRow + previous.row, viewport));
    ctx.lineTo(to, rowToY(firstRow + bar.row, viewport));
  }

  ctx.stroke();
}

/** 便の棒。**水平に引く。** */
function drawBars(
  ctx: DrawContext,
  viewport: BlockChartViewport,
  block: ChartBlock,
  firstRow: number,
  xOf: StopX,
): void {
  ctx.strokeStyle = block.color;
  ctx.lineWidth = BAR_WIDTH;
  ctx.setLineDash([]);
  ctx.beginPath();

  for (const bar of block.bars) {
    const left = xOf(bar.originStopId);
    const right = xOf(bar.terminalStopId);
    if (left === null || right === null) continue;

    const y = rowToY(firstRow + bar.row, viewport);
    ctx.moveTo(left, y);
    ctx.lineTo(right, y);
  }

  ctx.stroke();
}

/**
 * 出入庫の印（§5.5.3）。**棒にしない。**
 *
 * 出庫は最初の便の始発停留所の**上**、入庫は最後の便の終着停留所の**下**。
 * 回送に段を割かないのは、車庫が横軸のどこにも無いためである。
 */
function drawMarks(
  ctx: DrawContext,
  viewport: BlockChartViewport,
  block: ChartBlock,
  firstRow: number,
  xOf: StopX,
): void {
  ctx.fillStyle = block.color;

  if (block.pullOut !== null) {
    const x = xOf(block.pullOut.stopId);
    const first = block.bars[0];
    if (x !== null && first !== undefined) {
      // 上向きの三角。**車庫から出てきて、この段に降りる。**
      triangle(ctx, x, rowToY(firstRow + first.row, viewport) - MARK_GAP, -1);
    }
  }

  if (block.pullIn !== null) {
    const x = xOf(block.pullIn.stopId);
    const last = block.bars.at(-1);
    if (x !== null && last !== undefined) {
      triangle(ctx, x, rowToY(firstRow + last.row, viewport) + MARK_GAP, 1);
    }
  }
}

/**
 * 三角の印。
 *
 * @param direction `-1` なら上向き（出庫）、`1` なら下向き（入庫）
 */
function triangle(ctx: DrawContext, x: number, y: number, direction: -1 | 1): void {
  ctx.beginPath();
  ctx.moveTo(x, y + direction * MARK_SIZE);
  ctx.lineTo(x - MARK_SIZE, y - direction * MARK_SIZE);
  ctx.lineTo(x + MARK_SIZE, y - direction * MARK_SIZE);
  ctx.fill();
}

/**
 * 棒に添える時刻と折返し時分（§5.5.2）。
 *
 * **段の間隔が一定であるぶんを、ここで補う。** 30 分の折返しと 3 時間の待機が
 * 同じ間隔で描かれる以上、長さは字でしか分からない。
 */
function drawTimes(
  ctx: DrawContext,
  scene: BlockChartScene,
  viewport: BlockChartViewport,
  block: ChartBlock,
  firstRow: number,
  xOf: StopX,
): void {
  ctx.fillStyle = scene.theme.label;
  ctx.font = TIME_FONT;
  ctx.textBaseline = 'middle';

  for (const bar of block.bars) {
    const left = xOf(bar.originStopId);
    const right = xOf(bar.terminalStopId);
    if (left === null || right === null) continue;

    const y = rowToY(firstRow + bar.row, viewport);
    // **始発は棒の外側、終着も外側。** 棒の上に重ねると、棒の色と字が混ざる。
    const outward = left <= right ? 1 : -1;
    ctx.textAlign = outward === 1 ? 'right' : 'left';
    ctx.fillText(formatTime(bar.originTime), left - outward * TIME_GAP, y);
    ctx.textAlign = outward === 1 ? 'left' : 'right';
    ctx.fillText(formatTime(bar.terminalTime), right + outward * TIME_GAP, y);
  }

  drawLayovers(ctx, scene, viewport, block, firstRow, xOf);
}

/** 折返し時分。**縦線の脇に置く。** */
function drawLayovers(
  ctx: DrawContext,
  scene: BlockChartScene,
  viewport: BlockChartViewport,
  block: ChartBlock,
  firstRow: number,
  xOf: StopX,
): void {
  ctx.fillStyle = scene.theme.label;

  for (const [index, bar] of block.bars.entries()) {
    if (index === 0 || bar.layoverMinutes === null) continue;
    const previous = block.bars[index - 1];
    if (previous === undefined) continue;

    const x = xOf(bar.originStopId);
    if (x === null) continue;

    // **マスの端から内側へ置く。** 右端の停留所で折り返す運用は多く、外側へ
    // 出すと必ず切れる。
    const inward = x > (viewport.left + viewport.width) / 2 ? -1 : 1;
    ctx.textAlign = inward === 1 ? 'left' : 'right';

    const y =
      (rowToY(firstRow + previous.row, viewport) + rowToY(firstRow + bar.row, viewport)) / 2;
    ctx.fillText(`${String(bar.layoverMinutes)}分`, x + inward * TIME_GAP, y);
  }
}

/** 棒 1 本の左右の端（テストと当たり判定のため）。 */
export function barEnds(
  bar: ChartBar,
  scene: BlockChartScene,
  viewport: BlockChartViewport,
): { readonly left: number; readonly right: number } | null {
  const at = (stopId: string): number | null => {
    const stop = scene.stops.find((entry) => entry.stopId === stopId);
    return stop === undefined ? null : axisToX(stop.axisPosition, viewport);
  };

  const origin = at(bar.originStopId);
  const terminal = at(bar.terminalStopId);
  if (origin === null || terminal === null) return null;

  return { left: Math.min(origin, terminal), right: Math.max(origin, terminal) };
}
