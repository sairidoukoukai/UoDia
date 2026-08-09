/**
 * `DrawContext` を PDF で満たす（仕様書 v2 §5.4.2、実装計画書 v2 §3.3、T-77）。
 *
 * ## 描画関数は書き直さない
 *
 * `DrawContext` は 14 のメソッドしか持たない狭い型である。**そのすべてが PDF の
 * 描画命令に写せる。**
 *
 * ```ts
 * drawDiagram(canvasCtx, scene, viewport);                  // PNG
 * drawDiagram(new PdfDrawContext(…), scene, viewport);      // PDF——同じ関数
 * ```
 *
 * **PNG と PDF が同じ関数から出るため、絵が食い違わない。** 片方だけを直して
 * 見た目がずれることが、構造上起きない。
 *
 * ## 座標系を 1 度だけ捻る
 *
 * canvas は左上が原点で y が下へ、PDF は左下が原点で y が上へ伸びる。**升目
 * ごとに引き算する代わりに、変換行列を 1 度だけ積む。**
 *
 * ```
 * [s 0 0 -s 0 H]   s = 紙の大きさ ÷ 描くときの大きさ、H = 紙の高さ
 * ```
 *
 * これで canvas の座標をそのまま渡せる。**字だけは裏返る**ため、置くときに
 * もう一度捻り返す（{@link fillText}）。
 *
 * ## 状態は自分で持つ
 *
 * PDF の `q` / `Q` は描画の状態（色・線幅・破線）を保存するが、**こちらが持って
 * いる色や書体は PDF が知らない。** `save` / `restore` で自分の側も積む。
 */

import {
  appendBezierCurve,
  beginText,
  clip,
  concatTransformationMatrix,
  endPath,
  endText,
  fill,
  lineTo,
  moveTo,
  popGraphicsState,
  pushGraphicsState,
  rectangle,
  setDashPattern,
  setFillingRgbColor,
  setFontAndSize,
  setLineWidth,
  setStrokingRgbColor,
  setTextMatrix,
  showText,
  stroke,
  type PDFFont,
  type PDFOperator,
  type PDFPage,
} from 'pdf-lib';
import type { DrawContext } from '@/features/diagram';

export interface PdfDrawContextOptions {
  readonly page: PDFPage;
  readonly font: PDFFont;
  /** 描くときの座標系の幅（CSS px）。 */
  readonly width: number;
  readonly height: number;
}

/** 描画の状態のうち、**PDF が持たないもの**。 */
interface PaintState {
  fillStyle: string;
  strokeStyle: string;
  lineWidth: number;
  font: string;
  textAlign: CanvasTextAlign;
  textBaseline: CanvasTextBaseline;
  dash: readonly number[];
}

/** 溜めている道。`stroke` / `fill` / `clip` のときに一度に出す。 */
type PathPart =
  | { readonly kind: 'move'; readonly x: number; readonly y: number }
  | { readonly kind: 'line'; readonly x: number; readonly y: number }
  | {
      readonly kind: 'rect';
      readonly x: number;
      readonly y: number;
      readonly w: number;
      readonly h: number;
    }
  | { readonly kind: 'circle'; readonly x: number; readonly y: number; readonly r: number };

/** 円を 4 本のベジエで近似するときの制御点の比。 */
const KAPPA = 0.5522847498307936;

/** 読めない色。**黒として扱う**（`features/diagram/color.ts` と同じ約束）。 */
const BLACK = { r: 0, g: 0, b: 0 };

export class PdfDrawContext implements DrawContext {
  readonly #page: PDFPage;
  readonly #font: PDFFont;
  readonly #fontKey: ReturnType<PDFPage['node']['newFontDictionary']>;

  #state: PaintState = {
    fillStyle: '#000000',
    strokeStyle: '#000000',
    lineWidth: 1,
    font: '10px sans-serif',
    textAlign: 'start',
    textBaseline: 'alphabetic',
    dash: [],
  };
  readonly #stack: PaintState[] = [];
  #path: PathPart[] = [];

  constructor(options: PdfDrawContextOptions) {
    this.#page = options.page;
    this.#font = options.font;
    this.#fontKey = options.page.node.newFontDictionary(options.font.name, options.font.ref);

    // **紙に収まる倍率を選ぶ。** 幅と高さの比がぴったり同じとは限らないため、
    // 小さいほうに合わせる——はみ出すより、余白がわずかに増えるほうがよい。
    const scale = Math.min(
      options.page.getWidth() / options.width,
      options.page.getHeight() / options.height,
    );

    this.#page.pushOperators(
      pushGraphicsState(),
      concatTransformationMatrix(scale, 0, 0, -scale, 0, options.page.getHeight()),
    );
  }

  // ---- `DrawContext` が読み書きする値 ----

  get fillStyle(): string {
    return this.#state.fillStyle;
  }
  set fillStyle(value: string | CanvasGradient | CanvasPattern) {
    this.#state.fillStyle = typeof value === 'string' ? value : '#000000';
  }

  get strokeStyle(): string {
    return this.#state.strokeStyle;
  }
  set strokeStyle(value: string | CanvasGradient | CanvasPattern) {
    this.#state.strokeStyle = typeof value === 'string' ? value : '#000000';
  }

  get lineWidth(): number {
    return this.#state.lineWidth;
  }
  set lineWidth(value: number) {
    this.#state.lineWidth = value;
  }

  get font(): string {
    return this.#state.font;
  }
  set font(value: string) {
    this.#state.font = value;
  }

  get textAlign(): CanvasTextAlign {
    return this.#state.textAlign;
  }
  set textAlign(value: CanvasTextAlign) {
    this.#state.textAlign = value;
  }

  get textBaseline(): CanvasTextBaseline {
    return this.#state.textBaseline;
  }
  set textBaseline(value: CanvasTextBaseline) {
    this.#state.textBaseline = value;
  }

  // ---- 状態 ----

  save(): void {
    this.#stack.push({ ...this.#state });
    this.#page.pushOperators(pushGraphicsState());
  }

  restore(): void {
    const previous = this.#stack.pop();
    if (previous !== undefined) this.#state = previous;
    this.#page.pushOperators(popGraphicsState());
  }

  /**
   * 消す。**PDF では何もしない。**
   *
   * 紙は白紙で始まる。`drawDiagram` は消したあと必ず地色を塗るため
   * （`drawBackground`）、消す操作そのものは要らない。
   */
  clearRect(): void {
    // 何もしない。
  }

  // ---- 道 ----

  beginPath(): void {
    this.#path = [];
  }

  moveTo(x: number, y: number): void {
    this.#path.push({ kind: 'move', x, y });
  }

  lineTo(x: number, y: number): void {
    this.#path.push({ kind: 'line', x, y });
  }

  rect(x: number, y: number, w: number, h: number): void {
    this.#path.push({ kind: 'rect', x, y, w, h });
  }

  /**
   * 弧。**丸としてしか使われない**（停車の点。`drawTrips`）。
   *
   * 角度は見ない。半端な弧を描く必要が出たときは、そのとき足せばよい——今 4 本の
   * ベジエで足りているものを、使われない一般形にしても確かめようがない。
   */
  arc(x: number, y: number, radius: number): void {
    this.#path.push({ kind: 'circle', x, y, r: radius });
  }

  /**
   * 破線の刻み。**線を引く直前に PDF へ渡す**（`stroke`）。
   *
   * PDF では破線も描画の状態であり、`q` / `Q` と一緒に積まれる。ここで出して
   * しまうと、`save` を挟んだあとに戻る先が食い違う。
   */
  setLineDash(segments: number[]): void {
    this.#state.dash = [...segments];
  }

  stroke(): void {
    const { strokeStyle, lineWidth, dash } = this.#state;
    this.#page.pushOperators(
      setStrokingRgbColor(...toRgb(strokeStyle)),
      setLineWidth(lineWidth),
      setDashPattern([...dash], 0),
      ...this.#pathOperators(),
      stroke(),
    );
  }

  fill(): void {
    this.#page.pushOperators(
      setFillingRgbColor(...toRgb(this.#state.fillStyle)),
      ...this.#pathOperators(),
      fill(),
    );
  }

  fillRect(x: number, y: number, w: number, h: number): void {
    this.#page.pushOperators(
      setFillingRgbColor(...toRgb(this.#state.fillStyle)),
      rectangle(x, y, w, h),
      fill(),
    );
  }

  /**
   * 切り取る。
   *
   * `W n` は**道を引かずに切り取り範囲だけを決める**。`n` を忘れると、切り取った
   * 範囲の輪郭がそのまま線として残る。
   */
  clip(): void {
    this.#page.pushOperators(...this.#pathOperators(), clip(), endPath());
  }

  // ---- 字 ----

  /**
   * 字を置く（仕様書 v2 §5.4.2）。**字として入れる。ラスタ化しない。**
   *
   * 座標系を捻り返してから置く。外側の変換で y が下向きになっているため、その
   * まま置くと**上下が裏返る。**
   *
   * 揃え方（`textAlign` / `textBaseline`）は canvas の意味に合わせて、置く前に
   * 自分でずらす。PDF には揃え方という考えが無く、字はいつも基準線の左端から
   * 始まる。
   */
  fillText(text: string, x: number, y: number, maxWidth?: number): void {
    if (text === '') return;

    const size = fontSizeOf(this.#state.font);
    const width = this.#font.widthOfTextAtSize(text, size);
    // **入りきらないときは横に詰める。** canvas の `maxWidth` と同じ振る舞いで
    // ある（縦横比を保って縮めるのではなく、横だけを縮める）。
    const squeeze = maxWidth !== undefined && width > maxWidth ? maxWidth / width : 1;

    const left = x - alignOffset(this.#state.textAlign, width * squeeze);
    const baseline = y + this.#baselineOffset(size);

    this.#page.pushOperators(
      pushGraphicsState(),
      // 捻り返し。ここから内側は y が上向きに戻る。
      concatTransformationMatrix(squeeze, 0, 0, -1, left, baseline),
      setFillingRgbColor(...toRgb(this.#state.fillStyle)),
      beginText(),
      setFontAndSize(this.#fontKey, size),
      setTextMatrix(1, 0, 0, 1, 0, 0),
      // **`encodeText` を通す。** 使った字を数えているのはこれであり、通さないと
      // その字がサブセットから落ちる。
      showText(this.#font.encodeText(text)),
      endText(),
      popGraphicsState(),
    );
  }

  /** 積んだ変換を降ろす。**ページを閉じる前に 1 度だけ呼ぶ。** */
  finish(): void {
    this.#page.pushOperators(popGraphicsState());
  }

  /**
   * 基準線をどれだけ下げるか（canvas の `textBaseline`）。
   *
   * 上へ伸びる量（`ascent`）と下へ伸びる量（`descent`）から決める。`pdf-lib` は
   * 直接には教えないが、**下を含めた高さと含めない高さの差**が下へ伸びる量である。
   */
  #baselineOffset(size: number): number {
    const ascent = this.#font.heightAtSize(size, { descender: false });
    const total = this.#font.heightAtSize(size);

    switch (this.#state.textBaseline) {
      case 'top':
      case 'hanging':
        return ascent;
      case 'middle':
        return ascent - total / 2;
      case 'bottom':
      case 'ideographic':
        return ascent - total;
      default:
        return 0;
    }
  }

  /** 溜めた道を PDF の命令にする。 */
  #pathOperators(): PDFOperator[] {
    const operators: PDFOperator[] = [];

    for (const part of this.#path) {
      switch (part.kind) {
        case 'move':
          operators.push(moveTo(part.x, part.y));
          break;
        case 'line':
          operators.push(lineTo(part.x, part.y));
          break;
        case 'rect':
          operators.push(rectangle(part.x, part.y, part.w, part.h));
          break;
        case 'circle':
          operators.push(...circle(part.x, part.y, part.r));
          break;
      }
    }

    return operators;
  }
}

/** 丸を 4 本のベジエで描く。 */
function circle(x: number, y: number, r: number): PDFOperator[] {
  const k = r * KAPPA;
  return [
    moveTo(x + r, y),
    appendBezierCurve(x + r, y + k, x + k, y + r, x, y + r),
    appendBezierCurve(x - k, y + r, x - r, y + k, x - r, y),
    appendBezierCurve(x - r, y - k, x - k, y - r, x, y - r),
    appendBezierCurve(x + k, y - r, x + r, y - k, x + r, y),
  ];
}

/** 揃え方によって、置き始める位置を左へどれだけ戻すか。 */
function alignOffset(align: CanvasTextAlign, width: number): number {
  switch (align) {
    case 'right':
    case 'end':
      return width;
    case 'center':
      return width / 2;
    default:
      return 0;
  }
}

/**
 * CSS の書体指定から大きさ（px）を取る。
 *
 * 描画側が渡すのは `12px system-ui, sans-serif` の形だけである（`drawGrid` /
 * `drawTrips`）。**太さは見ない**——埋めている書体は 1 ウェイトしか無く、
 * 太字を求められても出せるものが変わらない。
 */
export function fontSizeOf(font: string): number {
  const match = /(\d+(?:\.\d+)?)px/.exec(font);
  return match?.[1] === undefined ? 10 : Number(match[1]);
}

/**
 * CSS の色を 0〜1 の 3 つ組にする。
 *
 * 受けるのは `#rrggbb` と `#rgb` である。書き出しに乗る色はどれもこの形で作られ
 * ている（`route.json` の系統色・`SceneTheme`・`readableOn` の返り値）。
 * **読めない綴りは黒**——`features/diagram/color.ts` と同じ約束にしてある。
 */
export function toRgb(color: string): [number, number, number] {
  const { r, g, b } = parseHex(color);
  return [r / 255, g / 255, b / 255];
}

function parseHex(color: string): { r: number; g: number; b: number } {
  const text = color.trim();

  const long = /^#([0-9a-f]{6})$/i.exec(text);
  if (long?.[1] !== undefined) {
    const value = Number.parseInt(long[1], 16);
    return { r: (value >> 16) & 0xff, g: (value >> 8) & 0xff, b: value & 0xff };
  }

  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(text);
  if (short !== null) {
    const [, r = '0', g = '0', b = '0'] = short;
    return {
      r: Number.parseInt(`${r}${r}`, 16),
      g: Number.parseInt(`${g}${g}`, 16),
      b: Number.parseInt(`${b}${b}`, 16),
    };
  }

  return BLACK;
}
