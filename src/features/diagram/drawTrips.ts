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

/**
 * 折返しの接続線（#167、T-62、仕様書 v1.1 §5.3）。
 *
 * **回送のヒゲ（細い実線）と見分けられるようにする。** 太さと線種の両方を変え、
 * 「そこを走っているのではない」ことが見た目から読めるようにする。
 */
const LINK_WIDTH = 1;
const LINK_DASH: readonly number[] = [2, 3];

/**
 * 段 1 つぶんのずらし幅（px）。
 *
 * **拡大率によらない。** 回送のヒゲと同じく、これは絵の記号の大きさであって
 * 距離でも時間でもない。軸の単位でずらすと、縦に拡げるたびに段の間隔が開き、
 * 離れた停留所の線に見える。
 */
const LINK_LEVEL_OFFSET = 4;

/**
 * 営業所側へ伸ばす「ヒゲ」の長さ（px。#118、仕様書 §6.2.2）。
 *
 * **軸の単位ではなく画面の量で持つ。** 軸の単位で決めると、縦に拡げるたびに
 * ヒゲが伸び、いま直したはずの「回送が全体を横断する」状態が戻ってくる。線幅や
 * 破線の刻みと同じで、これは**絵の記号の大きさ**であって、距離でも時間でもない。
 *
 * 伸ばす向きは下と決める。営業所は縦軸の外——一番下の停留所線より先にあるものと
 * して描いていた（v4.15 の営業所レーン）読み方をそのまま引き継ぐ。
 */
export const STUB_LENGTH = 15;

/** 選択されたスジの太さ（仕様書 §6.2.2）。細い回送も同じ比で太くする。 */
const SELECTED_SCALE = 2;

/** 選択されたスジの端点に置く四角の 1 辺。 */
const HANDLE_SIZE = 7;

/**
 * 停車を示す点の半径（px。#115、仕様書 §6.2.2）。
 *
 * **線幅と同じく画面の量で持つ。** 拡大しても点は大きくならない——点は「そこに
 * 停まる」という事実の印であって、長さでも時間でもない。
 *
 * **傾いた線は横に太く見える。** 線幅 1.5px でも、急なスジは 1 行あたり 4px ほどを
 * 覆う。半径 2.5px では線が少し膨らんだだけに見えたため（実機で確かめた）、
 * 3.5px とした。選んで太くしたスジ（線幅 3px）にも埋もれない。
 */
const STOP_DOT_RADIUS = 3.5;

/** 丸 1 周（ラジアン）。 */
const FULL_CIRCLE = Math.PI * 2;

/**
 * 折返しの接続線を引く（#167、T-62）。
 *
 * **スジより先に引く。** 便そのものの線が上に来るようにするためであり、
 * 繋がりは便を読むための手掛かりであって、便より目立ってはならない。
 */
function drawBlockLinks(ctx: DrawContext, scene: DiagramScene, viewport: Viewport): void {
  if (scene.blockLinks.length === 0) return;

  ctx.save();
  ctx.lineWidth = LINK_WIDTH;
  ctx.setLineDash(LINK_DASH);

  for (const link of scene.blockLinks) {
    const y =
      axisToY(axisOf(link.stopId, scene), viewport) +
      link.level * LINK_LEVEL_OFFSET * link.direction;
    ctx.strokeStyle = link.color;
    ctx.beginPath();
    ctx.moveTo(timeToX(link.from, viewport), y);
    ctx.lineTo(timeToX(link.to, viewport), y);
    ctx.stroke();
  }

  ctx.setLineDash([]);
  ctx.restore();
}

/** 停留所の軸位置。縦軸に無い停留所は 0 とする（接続線は引かれない）。 */
function axisOf(stopId: string, scene: DiagramScene): number {
  return scene.stops.find((stop) => stop.stopId === stopId)?.axisPosition ?? 0;
}

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

  drawBlockLinks(ctx, scene, viewport);

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
 * 見えている線と掴める線がずれる。**座標は 1 本につき 1 度だけ求める。** ヒゲも
 * この列に入るため、ヒゲを掴めば元の営業便が選ばれる（§6.3.1）。
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
  // 縦軸に乗る点の y。営業所（`offAxis`）はここでは決まらない。
  const ys = trip.points.map((point) => {
    const axisPosition = axis.get(point.stopId);
    return axisPosition === undefined ? null : axisToY(axisPosition, viewport);
  });

  const points: ScreenPoint[] = [];
  for (const [index, point] of trip.points.entries()) {
    const y = ys[index] ?? stubY(ys, index);
    // 縦軸に乗る点が 1 つも無い便。伸ばす元が無く、線にならない。
    if (y === null) continue;
    points.push({ x: timeToX(point.time, viewport), y });
  }

  return points;
}

/**
 * ヒゲの先の y（#118）。
 *
 * **一番近い縦軸上の点から一定の px だけ下へ伸ばす。** 回送は営業便の端に付く
 * 線であり、伸ばす元はその隣の折れ点である。
 */
function stubY(ys: readonly (number | null)[], index: number): number | null {
  for (let distance = 1; distance < ys.length; distance += 1) {
    const y = ys[index - distance] ?? ys[index + distance];
    if (y !== null && y !== undefined) return y + STUB_LENGTH;
  }
  return null;
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

  drawStopDots(ctx, entry);

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
/**
 * 停車する停留所に点を打つ（#115、仕様書 §6.2.2）。
 *
 * **箕面学舎に寄るかどうかが、折れ角だけでは読めない。** 豊中学舎→箕面学舎が
 * 20 分、箕面学舎→コンベ前が 15 分であり、軸位置を引き直した後（#117）でも
 * 傾きの差は小さい。拡大率によってはほとんど直線に見える。
 *
 * **打つのは折れ点すべてである。** パターンに含まれる停留所はすべて乗り降りの
 * できる停留所であり（§5.4 に「通過」は無い）、「経由するが停まらない」点は
 * 存在しない。直行便に箕面学舎の点が出ないのは、そこを**通っていない**からで
 * ある——線種（#114）が種別を、点が停車の事実を示す 2 段になる。
 *
 * 回送には打たない。客を乗せない便に「停まる」は無い。
 */
function drawStopDots(ctx: DrawContext, entry: TripPolyline): void {
  if (entry.trip.isDeadhead) return;

  ctx.fillStyle = entry.trip.color;
  for (const point of entry.points) {
    // **1 点ずつ道を起こす。** 続けて弧を足すと、点と点が線で繋がって塗られる。
    ctx.beginPath();
    ctx.arc(point.x, point.y, STOP_DOT_RADIUS, 0, FULL_CIRCLE);
    ctx.fill();
  }
}

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
