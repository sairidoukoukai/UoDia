/**
 * スジを描く（仕様書 §6.2.2、実装計画書 §3.5、T-26）。
 *
 * 引数は {@link drawGrid} と同じ 3 つである。ストアも DOM も見ない。
 *
 * ## スジは「便の姿」そのものである
 *
 * 時刻表は数字の列であり、隣の便との関係は目で拾うしかない。スジは傾きで所要
 * 時間を、間隔で運行間隔を、交わりで行き違いを一度に見せる。**この絵が出た
 * 時点で、ダイヤを設計しているという実感が初めて成り立つ。**
 *
 * ## 描画順は重なりの順である
 *
 * 選択されたスジを最後に描く。密なダイヤでは 1 本のスジが何本もの下に潜り、
 * 「選んだのに太くならない」ように見える。順序を決めておくのは飾りではない。
 */

import { formatMinutesSigned } from '@/domain/time';
import type { DrawContext } from './drawContext';
import type { DiagramScene, SceneTrip } from './scene';
import { axisToY, isTimeVisible, plotXRange, screenRect, timeToX, type Viewport } from './viewport';

/** 営業スジの太さ。罫線（1px）より太くし、格子に沈まないようにする。 */
const TRIP_WIDTH = 1.5;

/**
 * 回送スジの太さ。営業スジより細くする。
 *
 * **線種と色だけでは足りない。** 運用で着色すると（仕様書 §6.2.4）、回送は元の
 * 便と同じ色になり、破線どうしの見分けは刻みの長さだけになる。太さを変えて
 * おけば、色をどう塗っても「これは営業便ではない」と読める。
 */
const DEADHEAD_WIDTH = 1;

/** 選択されたスジの太さ（仕様書 §6.2.2）。細い回送も同じ比で太くする。 */
const SELECTED_SCALE = 2;

/** 選択されたスジの端点に置く四角の 1 辺。 */
const HANDLE_SIZE = 7;

/** 便番号ラベル。 */
const LABEL_FONT = '11px system-ui, sans-serif';
const LABEL_HEIGHT = 12;
/** ラベルと折れ点のあいだの余白。 */
const LABEL_GAP = 3;
/** 1 文字あたりの幅の見積り。重なりの判定にのみ使う。 */
const LABEL_CHAR_WIDTH = 7;

/** 引きずっている最中の移動量（T-29）。番号より目立たせる。 */
const SHIFT_FONT = 'bold 12px system-ui, sans-serif';
const SHIFT_GAP = 12;

/** 画面上の点。 */
export interface ScreenPoint {
  readonly x: number;
  readonly y: number;
}

interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** スジ 1 本と、その画面上の座標。 */
export interface TripPolyline {
  readonly trip: SceneTrip;
  readonly points: readonly ScreenPoint[];
  readonly first: ScreenPoint;
  readonly last: ScreenPoint;
}

export function drawTrips(ctx: DrawContext, scene: DiagramScene, viewport: Viewport): void {
  const range = plotXRange(viewport);
  // 表示範囲（7:00〜22:00）が視野の外にある。
  if (range === null) return;

  ctx.save();
  // **描画領域の外へ出さない。** 表示範囲の外に置かれた便は、そのままでは
  // 停留所名の欄や目盛の帯にはみ出して線を引く。格子と同じ範囲に収める。
  ctx.beginPath();
  ctx.rect(
    range.left,
    viewport.originY,
    range.right - range.left,
    viewport.height - viewport.originY,
  );
  ctx.clip();

  const drawn = tripPolylines(scene, viewport);

  const isSelected = (entry: TripPolyline): boolean =>
    scene.selectedTripIds.has(entry.trip.sourceTripId);

  for (const entry of drawn.filter((item) => !isSelected(item))) drawTrip(ctx, entry, false);
  for (const entry of drawn.filter(isSelected)) drawTrip(ctx, entry, true);

  drawTripNumbers(ctx, drawn, viewport);
  drawSelectionRect(ctx, scene, viewport);
  drawTripShift(ctx, scene, viewport);

  ctx.restore();
}

/**
 * 視野に掛かるスジの座標。
 *
 * **描画（T-26）と当たり判定（T-28）が同じ列を使う。** 両者が別々に座標を組むと、
 * 見えている線と掴める線がずれる。**座標は 1 本につき 1 度だけ求める。**
 *
 * 縦軸に無い停留所は場面に含まれていない（`scene.ts`）ため、折れ点は必ず座標を
 * 持つ。
 */
export function tripPolylines(scene: DiagramScene, viewport: Viewport): readonly TripPolyline[] {
  const axis = axisPositions(scene);
  const drawn: TripPolyline[] = [];

  for (const trip of scene.trips) {
    if (!isTripVisible(trip, viewport)) continue;

    const points = polyline(trip, axis, viewport);
    const first = points[0];
    const last = points.at(-1);
    if (first === undefined || last === undefined) continue;

    drawn.push({ trip, points, first, last });
  }

  return drawn;
}

/** 1 本ぶんの座標。 */
export function tripPolyline(
  trip: SceneTrip,
  scene: DiagramScene,
  viewport: Viewport,
): readonly ScreenPoint[] {
  return polyline(trip, axisPositions(scene), viewport);
}

function axisPositions(scene: DiagramScene): ReadonlyMap<string, number> {
  return new Map(scene.stops.map((stop) => [stop.stopId, stop.axisPosition]));
}

function polyline(
  trip: SceneTrip,
  axis: ReadonlyMap<string, number>,
  viewport: Viewport,
): readonly ScreenPoint[] {
  const points: ScreenPoint[] = [];

  for (const point of trip.points) {
    const axisPosition = axis.get(point.stopId);
    if (axisPosition === undefined) continue;
    points.push({ x: timeToX(point.time, viewport), y: axisToY(axisPosition, viewport) });
  }

  return points;
}

/**
 * そのスジが視野の横幅に掛かるか（仕様書 §6.2.2 のカリング）。
 *
 * 折れ点は経路の順（＝時刻の順）に並ぶため、両端だけを見れば済む。**視野を
 * またいで通り過ぎる便**（左端より前に発って右端より後に着く）を落とさないよう、
 * 端が入っているかではなく範囲が重なっているかで判定する。
 */
export function isTripVisible(trip: SceneTrip, viewport: Viewport): boolean {
  const first = trip.points[0];
  const last = trip.points.at(-1);
  if (first === undefined || last === undefined) return false;

  if (isTimeVisible(first.time, viewport) || isTimeVisible(last.time, viewport)) return true;
  return first.time < viewport.startTime && last.time > viewport.startTime;
}

function drawTrip(ctx: DrawContext, entry: TripPolyline, selected: boolean): void {
  const { trip, points, first, last } = entry;

  const width = trip.isDeadhead ? DEADHEAD_WIDTH : TRIP_WIDTH;

  ctx.strokeStyle = trip.color;
  ctx.lineWidth = selected ? width * SELECTED_SCALE : width;
  ctx.setLineDash([...trip.lineDash]);
  ctx.beginPath();
  ctx.moveTo(first.x, first.y);
  for (const point of points.slice(1)) ctx.lineTo(point.x, point.y);
  ctx.stroke();

  if (!selected) return;

  // 端点のハンドル（§6.2.2）。掴める場所を示す（引きずるのは T-29）。
  ctx.fillStyle = trip.color;
  ctx.setLineDash([]);
  for (const point of [first, last]) {
    ctx.fillRect(point.x - HANDLE_SIZE / 2, point.y - HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE);
  }
}

/**
 * 囲んでいる最中の枠（仕様書 §6.3.1、T-28）。
 *
 * **塗り潰さない。** 中を塗ると、いま選ぼうとしているスジが枠の下に隠れる。
 * 破線の輪郭だけにする。
 *
 * 色は罫線ではなく**文字と同じ濃さ**にする。罫線と同じ色にすると、格子の一部に
 * 見えて「いま囲んでいる」ことが伝わらない。
 */
function drawSelectionRect(ctx: DrawContext, scene: DiagramScene, viewport: Viewport): void {
  if (scene.selectionRect === null) return;

  const { left, top, right, bottom } = screenRect(scene.selectionRect, viewport);

  ctx.strokeStyle = scene.theme.label;
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 3]);
  ctx.beginPath();
  ctx.moveTo(left, top);
  ctx.lineTo(right, top);
  ctx.lineTo(right, bottom);
  ctx.lineTo(left, bottom);
  ctx.lineTo(left, top);
  ctx.stroke();
}

/**
 * 引きずっている最中の移動量（仕様書 §6.3.2、T-29）。
 *
 * **数字で出す。** 5 分の格子に吸い付いて動くため、どれだけ動かしたかは目では
 * 数えられない。「15 分遅らせたい」という意図に対して、画面が答えを返す。
 */
function drawTripShift(ctx: DrawContext, scene: DiagramScene, viewport: Viewport): void {
  if (scene.tripShift === null) return;

  ctx.font = SHIFT_FONT;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'bottom';
  ctx.setLineDash([]);
  ctx.fillStyle = scene.theme.label;
  ctx.fillText(
    formatMinutesSigned(scene.tripShift.minutes),
    timeToX(scene.tripShift.atTime, viewport) + SHIFT_GAP,
    axisToY(scene.tripShift.atAxis, viewport) - SHIFT_GAP,
  );
}

/**
 * 便番号をスジの始点近傍に置く。**重なる場所には置かない**（仕様書 §6.2.2）。
 *
 * 便が密なところで全部に番号を付けると、数字が重なって**どれも読めなくなる**。
 * 番号は時刻表にも出ているため、ここで落ちても失われる情報は無い。
 */
function drawTripNumbers(
  ctx: DrawContext,
  drawn: readonly TripPolyline[],
  viewport: Viewport,
): void {
  ctx.font = LABEL_FONT;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.setLineDash([]);

  const placed: Rect[] = [];

  for (const { trip, first } of drawn) {
    // 回送スジは番号を持たない（仕様書 §6.1.6、T-51）。
    if (trip.tripNumber === '') continue;

    const rect = labelRect(trip.tripNumber, first, viewport);
    if (placed.some((other) => overlaps(other, rect))) continue;
    placed.push(rect);

    ctx.fillStyle = trip.color;
    ctx.fillText(trip.tripNumber, rect.x, rect.y);
  }
}

/**
 * ラベルを置く矩形。
 *
 * 始点の右上に置く。**上に余地が無ければ下へ回す。** 吹田方面の便は縦軸の
 * 一番上（豊中学舎）から始まるため、上に置くと必ず描画領域の外に出て、
 * すべての番号が消える。
 */
function labelRect(text: string, first: ScreenPoint, viewport: Viewport): Rect {
  const above = first.y - LABEL_GAP - LABEL_HEIGHT;

  return {
    x: first.x + LABEL_GAP,
    y: above < viewport.originY ? first.y + LABEL_GAP : above,
    width: text.length * LABEL_CHAR_WIDTH,
    height: LABEL_HEIGHT,
  };
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}
