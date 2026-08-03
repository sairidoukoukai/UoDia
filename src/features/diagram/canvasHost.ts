/**
 * canvas を React の管理外で動かす（実装計画書 §3.4、T-24）。
 *
 * React の再描画と canvas の描画を連動させない。**ストアの購読 →
 * `requestAnimationFrame` → 1 回の描画**という道を 1 本だけ通す。
 *
 * ## 1 フレームに 1 回しか描かない
 *
 * 1 つの操作が状態を何度も変えることがある（便を作る → 選択を移す）。そのたびに
 * 描くと、同じ絵を 2 度描いて捨てることになる。予約済みなら何もしないことで、
 * 変化の回数と描画の回数を切り離す。
 *
 * ## 何を描くかと、いつ描くかを分ける
 *
 * `paint` を差し替えられるようにしてあるのは、**描く中身を持ち出さずに
 * 「いつ描くか」だけを試せる**ようにするためである。canvas の 2D
 * コンテキストは jsdom に無く、実際に描く経路は単体テストでは通せない。
 */

import { selectDiagramScene, type SceneTheme } from './scene';
import { drawDiagram } from './drawDiagram';
import { fitBackingStore, viewportOf } from './viewport';
import type { AppState } from '@/store';

/** 購読できる状態の入れ物。ストア全体を要求しない。 */
export interface DiagramStore {
  getState(): AppState;
  subscribe(listener: () => void): () => void;
}

export interface DiagramHostOptions {
  readonly canvas: HTMLCanvasElement;
  readonly store: DiagramStore;
  /** 画面から読んだ色。**同じ参照を渡し続けること**（`selectDiagramScene`）。 */
  readonly theme: SceneTheme;
  /** 1 回の描画。既定は canvas へ実際に描く。 */
  readonly paint?: (canvas: HTMLCanvasElement, state: AppState, theme: SceneTheme) => void;
  /** 既定は `requestAnimationFrame`。 */
  readonly requestFrame?: (draw: () => void) => number;
  /** 既定は `cancelAnimationFrame`。 */
  readonly cancelFrame?: (handle: number) => void;
  /** 大きさの変化を見る。既定は `ResizeObserver`。解除する関数を返すこと。 */
  readonly observeSize?: (target: HTMLCanvasElement, onResize: () => void) => () => void;
}

/**
 * canvas を状態に繋ぐ。返った関数を呼ぶと繋ぎを解く。
 *
 * 繋いだ直後に 1 度描く。**状態が変わるまで待つと、開いた瞬間の画面が空になる。**
 */
export function attachDiagram(options: DiagramHostOptions): () => void {
  const { canvas, store, theme } = options;
  const paint = options.paint ?? paintDiagram;
  const requestFrame = options.requestFrame ?? ((draw): number => requestAnimationFrame(draw));
  const cancelFrame =
    options.cancelFrame ??
    ((handle): void => {
      cancelAnimationFrame(handle);
    });
  const observeSize = options.observeSize ?? observeWithResizeObserver;

  let frame: number | null = null;

  const draw = (): void => {
    // 先に空ける。描いている間に来た変化は次のフレームで拾う。
    frame = null;
    paint(canvas, store.getState(), theme);
  };

  const schedule = (): void => {
    if (frame !== null) return;
    frame = requestFrame(draw);
  };

  const unsubscribe = store.subscribe(schedule);
  const unobserve = observeSize(canvas, schedule);
  schedule();

  return () => {
    unsubscribe();
    unobserve();
    if (frame !== null) cancelFrame(frame);
    frame = null;
  };
}

/** canvas へ実際に描く。大きさと画素密度を合わせてから {@link drawDiagram} を呼ぶ。 */
export function paintDiagram(canvas: HTMLCanvasElement, state: AppState, theme: SceneTheme): void {
  const ratio = pixelRatio();
  fitBackingStore(canvas, ratio);

  const ctx = canvas.getContext('2d');
  // 2D コンテキストを持たない環境（jsdom など）では何もしない。
  if (ctx === null) return;

  // **CSS px で描けるようにする。** 変換を掛けないと、裏側の解像度で座標を
  // 数える羽目になり、拡大率と画素密度が混ざる。
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);

  const view = state.project?.view.diagram;
  if (view === undefined) return;

  drawDiagram(
    ctx,
    selectDiagramScene(state, theme),
    viewportOf(view, canvas.clientWidth, canvas.clientHeight),
  );
}

/** 画素密度。取れない環境では 1 とする。 */
function pixelRatio(): number {
  const ratio = globalThis.devicePixelRatio;
  return typeof ratio === 'number' && ratio > 0 ? ratio : 1;
}

function observeWithResizeObserver(target: HTMLCanvasElement, onResize: () => void): () => void {
  // 対応していない環境では大きさの変化を追わない。初回の描画は行われる。
  if (typeof ResizeObserver === 'undefined') return () => undefined;

  const observer = new ResizeObserver(onResize);
  observer.observe(target);
  return () => {
    observer.disconnect();
  };
}
