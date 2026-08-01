/**
 * 送りと拡げの受け口（仕様書 §6.2.3、T-27）。
 *
 * DOM の出来事を {@link viewAfterWheel} などの純関数に渡し、返った視野を
 * ストアへ置くだけの層である。**ここに計算を書かない。**
 *
 * ## なぜ React のイベントを使わないのか
 *
 * <kbd>Ctrl</kbd>+ホイールは、既定ではブラウザ全体の拡大縮小になる。止めるには
 * `preventDefault` が要るが、React が張るホイールの受け口は受動（passive）で
 * あり、そこからは止められない。canvas に直接、受動でない受け口を張る。
 *
 * ## 引きずりの受け口は窓に張る
 *
 * 押し始めは canvas でも、指が離れるのは canvas の外かもしれない。窓で受けて
 * おかないと、外で離した引きずりが**終わらないまま残る**。
 */

import type { DiagramView } from '@/domain/model';
import type { AppState } from '@/store';
import {
  axisBoundsOf,
  DEFAULT_DIAGRAM_VIEW,
  sameView,
  viewAfterDrag,
  viewAfterWheel,
  viewportForCanvas,
  type AxisBounds,
} from './interaction';
import { selectDiagramScene, type SceneTheme } from './scene';

/** 視野の読み書きに要るだけの入れ口。**購読はしない**（描き直しは `canvasHost`）。 */
export interface ViewportStore {
  getState(): AppState & { readonly setDiagramView: (view: DiagramView) => void };
}

export interface ViewportControlOptions {
  readonly canvas: HTMLCanvasElement;
  readonly store: ViewportStore;
  /** 縦軸の端を求めるのに使う色。場面の組み立てに要るだけで、描画には使わない。 */
  readonly theme: SceneTheme;
  /** 引きずりの受け口を張る先。既定は `window`（テストで差し替える）。 */
  readonly target?: Pick<Window, 'addEventListener' | 'removeEventListener'>;
}

/** 中ボタン。 */
const MIDDLE_BUTTON = 1;
const LEFT_BUTTON = 0;

/**
 * canvas に送りと拡げの操作を繋ぐ。返った関数を呼ぶと繋ぎを解く。
 */
export function attachViewportControls(options: ViewportControlOptions): () => void {
  const { canvas, store, theme } = options;
  const target = options.target ?? window;

  /** スペースを押している間は、左ボタンでも掴んで動かせる。 */
  let spaceHeld = false;
  let dragging: { readonly x: number; readonly y: number } | null = null;

  const viewOf = (): DiagramView | null => store.getState().project?.view.diagram ?? null;

  const boundsOf = (): AxisBounds => axisBoundsOf(selectDiagramScene(store.getState(), theme));

  const apply = (next: DiagramView): void => {
    const view = viewOf();
    // 変わっていないなら書き換えない。書き換えれば購読が動き、描き直しが起きる。
    if (view === null || sameView(view, next)) return;
    store.getState().setDiagramView(next);
  };

  const onWheel = (event: WheelEvent): void => {
    const view = viewOf();
    if (view === null) return;

    // ブラウザ全体の拡大や、ページの縦スクロールに渡さない。
    event.preventDefault();

    const rect = canvas.getBoundingClientRect();
    apply(
      viewAfterWheel(
        view,
        {
          deltaX: event.deltaX,
          deltaY: event.deltaY,
          zoomKey: event.ctrlKey || event.metaKey,
          shiftKey: event.shiftKey,
          x: event.clientX - rect.left,
          y: event.clientY - rect.top,
        },
        viewportForCanvas(view, canvas),
        boundsOf(),
      ),
    );
  };

  const onPointerDown = (event: PointerEvent): void => {
    const grab = event.button === MIDDLE_BUTTON || (event.button === LEFT_BUTTON && spaceHeld);
    // 焦点を移す。キーボードの操作（スペース・Ctrl+0）はここに来て初めて届く。
    canvas.focus();
    if (!grab) return;

    // 中ボタンの自動スクロールを止める。
    event.preventDefault();
    dragging = { x: event.clientX, y: event.clientY };
    canvas.style.cursor = 'grabbing';
  };

  const onPointerMove = (event: PointerEvent): void => {
    if (dragging === null) return;
    const view = viewOf();
    if (view === null) return;

    const dx = event.clientX - dragging.x;
    const dy = event.clientY - dragging.y;
    dragging = { x: event.clientX, y: event.clientY };

    apply(viewAfterDrag(view, dx, dy, viewportForCanvas(view, canvas), boundsOf()));
  };

  const endDrag = (): void => {
    if (dragging === null) return;
    dragging = null;
    canvas.style.cursor = spaceHeld ? 'grab' : '';
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === ' ') {
      // ページを送らせない。スペースは「掴む」の修飾として使う。
      event.preventDefault();
      if (!spaceHeld) {
        spaceHeld = true;
        if (dragging === null) canvas.style.cursor = 'grab';
      }
      return;
    }

    // Ctrl+0 で既定の視野に戻す（仕様書 §6.2.3）。
    if (event.key === '0' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      apply(DEFAULT_DIAGRAM_VIEW);
    }
  };

  const onKeyUp = (event: KeyboardEvent): void => {
    if (event.key !== ' ') return;
    spaceHeld = false;
    if (dragging === null) canvas.style.cursor = '';
  };

  /** 焦点を失ったら押しっぱなしの記憶を捨てる。押し下げだけが届いた状態を残さない。 */
  const onBlur = (): void => {
    spaceHeld = false;
    endDrag();
    canvas.style.cursor = '';
  };

  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('keydown', onKeyDown);
  canvas.addEventListener('keyup', onKeyUp);
  canvas.addEventListener('blur', onBlur);
  target.addEventListener('pointermove', onPointerMove as EventListener);
  target.addEventListener('pointerup', endDrag);
  target.addEventListener('pointercancel', endDrag);

  return () => {
    canvas.removeEventListener('wheel', onWheel);
    canvas.removeEventListener('pointerdown', onPointerDown);
    canvas.removeEventListener('keydown', onKeyDown);
    canvas.removeEventListener('keyup', onKeyUp);
    canvas.removeEventListener('blur', onBlur);
    target.removeEventListener('pointermove', onPointerMove as EventListener);
    target.removeEventListener('pointerup', endDrag);
    target.removeEventListener('pointercancel', endDrag);
  };
}
