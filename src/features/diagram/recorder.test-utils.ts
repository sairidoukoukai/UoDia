/**
 * 描画の記録役（T-25／T-26 のテストで共有する）。
 *
 * **canvas を使わずに描画を検めるための器である。** 引かれた線・置かれた文字・
 * 塗られた矩形を覚えるだけで、絵は作らない。実物の canvas が要らないこと自体が、
 * 描画関数が `ctx` / `scene` / `viewport` の 3 つで完結している証拠になる
 * （実装計画書 §3.5）。
 *
 * 格子（`drawGrid`）とスジ（`drawTrips`）の両方が同じ器を使う。テストごとに
 * 書き写すと、**片方だけ古い記録の仕方**が残り、同じ絵を別の言葉で語ることに
 * なる。
 */

import type { DrawContext } from './drawContext';

/** 引かれた線分 1 本。 */
export interface RecordedSegment {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
  readonly strokeStyle: string;
  readonly lineWidth: number;
  /** 不透明度（#166）。フォーカス範囲の外は薄く描かれる。 */
  readonly alpha: number;
  readonly dash: readonly number[];
}

/** 置かれた文字 1 つ。 */
export interface RecordedLabel {
  readonly text: string;
  readonly x: number;
  readonly y: number;
  readonly align: CanvasTextAlign;
  readonly baseline: CanvasTextBaseline;
  readonly fillStyle: string;
  readonly maxWidth: number | undefined;
}

/** 塗られた丸 1 つ（停車の点。#115）。 */
export interface RecordedDot {
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly fillStyle: string;
}

/** 塗られた矩形 1 つ（帯・ハンドル）。 */
export interface RecordedRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly fillStyle: string;
}

export class Recorder implements DrawContext {
  // 色は文字列しか渡さない。`String()` を挟まずに比べられる。
  fillStyle = '';
  strokeStyle = '';
  lineWidth = 1;
  globalAlpha = 1;
  font = '';
  textAlign: CanvasTextAlign = 'start';
  textBaseline: CanvasTextBaseline = 'alphabetic';

  readonly segments: RecordedSegment[] = [];
  readonly labels: RecordedLabel[] = [];
  readonly rects: RecordedRect[] = [];
  readonly dots: RecordedDot[] = [];
  /** `clip` で切り取られた範囲。 */
  readonly clips: { x: number; y: number; width: number; height: number }[] = [];

  #dash: readonly number[] = [];
  #path: { x: number; y: number }[][] = [];
  #pending: { x: number; y: number; width: number; height: number }[] = [];
  #circles: { x: number; y: number; radius: number }[] = [];

  save(): void {
    // 状態の保存は数えない。
  }

  restore(): void {
    // 同上。
  }

  clearRect(): void {
    // 消した跡は数えない。
  }

  fillRect(x: number, y: number, width: number, height: number): void {
    this.rects.push({ x, y, width, height, fillStyle: this.fillStyle });
  }

  beginPath(): void {
    this.#path = [];
    this.#pending = [];
    this.#circles = [];
  }

  arc(x: number, y: number, radius: number): void {
    this.#circles.push({ x, y, radius });
  }

  fill(): void {
    for (const circle of this.#circles) this.dots.push({ ...circle, fillStyle: this.fillStyle });
    this.#circles = [];
  }

  moveTo(x: number, y: number): void {
    this.#path.push([{ x, y }]);
  }

  lineTo(x: number, y: number): void {
    this.#path.at(-1)?.push({ x, y });
  }

  rect(x: number, y: number, width: number, height: number): void {
    this.#pending.push({ x, y, width, height });
  }

  clip(): void {
    this.clips.push(...this.#pending);
    this.#pending = [];
  }

  stroke(): void {
    for (const subpath of this.#path) {
      for (let i = 1; i < subpath.length; i += 1) {
        const from = subpath[i - 1];
        const to = subpath[i];
        if (from === undefined || to === undefined) continue;
        this.segments.push({
          x1: from.x,
          y1: from.y,
          x2: to.x,
          y2: to.y,
          strokeStyle: this.strokeStyle,
          lineWidth: this.lineWidth,
          alpha: this.globalAlpha,
          dash: this.#dash,
        });
      }
    }
  }

  setLineDash(segments: number[]): void {
    this.#dash = [...segments];
  }

  fillText(text: string, x: number, y: number, maxWidth?: number): void {
    this.labels.push({
      text,
      x,
      y,
      align: this.textAlign,
      baseline: this.textBaseline,
      fillStyle: this.fillStyle,
      maxWidth,
    });
  }
}

/** 横に伸びる線分か。 */
export const isHorizontal = (segment: RecordedSegment): boolean => segment.y1 === segment.y2;

/** 縦に伸びる線分か。 */
export const isVertical = (segment: RecordedSegment): boolean => segment.x1 === segment.x2;
