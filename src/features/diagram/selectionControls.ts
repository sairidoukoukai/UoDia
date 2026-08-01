/**
 * 選択の受け口（仕様書 §6.3.1、T-28）。
 *
 * 左ボタンだけを扱う。中ボタンとスペース + 左ボタンは送り（`viewportControls`）の
 * ものであり、**掴まれた出来事には手を出さない** — 送りの側が `preventDefault` で
 * 「これは自分が受け取った」と印を付けているため、それを見て譲る。2 つの層が同じ
 * 押し下げを取り合わないための、DOM に元からある約束事である。
 *
 * ## 押しただけか、囲んだか
 *
 * 押して離すまでに指がわずかも動かないことはない。**動いた量がしきい値を超えて
 * 初めて矩形選択に移る。** 超えなければクリックとして扱う。しきい値が無いと、
 * スジを選ぼうとした指の震えが「空の矩形で囲んだ」ことになり、選択が消える。
 */

import type { DiagramView } from '@/domain/model';
import type { AppState, SelectionRect } from '@/store';
import type { ScreenPoint } from './drawTrips';
import { viewportForCanvas } from './interaction';
import { selectDiagramScene, type SceneTheme } from './scene';
import { hitTrip, nextSelection, selectionAfterRect, tripsInRect } from './selection';
import { xToTime, yToAxis, type Viewport } from './viewport';

/** 選択に要るだけの入れ口。 */
export interface SelectionStore {
  getState(): AppState & {
    readonly selectTrips: (tripIds: readonly string[]) => void;
    readonly setSelectionRect: (rect: SelectionRect | null) => void;
  };
}

export interface SelectionControlOptions {
  readonly canvas: HTMLCanvasElement;
  readonly store: SelectionStore;
  readonly theme: SceneTheme;
  /** 引きずりの受け口を張る先。既定は `window`（テストで差し替える）。 */
  readonly target?: Pick<Window, 'addEventListener' | 'removeEventListener'>;
}

const LEFT_BUTTON = 0;

/** ここを超えて動いたら矩形選択に移る（px）。 */
export const DRAG_THRESHOLD = 4;

export function attachSelectionControls(options: SelectionControlOptions): () => void {
  const { canvas, store, theme } = options;
  const target = options.target ?? window;

  /** 押し始めた場所。押していなければ `null`。 */
  let origin: ScreenPoint | null = null;
  /** しきい値を超えて動いたか。 */
  let dragging = false;

  const viewOf = (): DiagramView | null => store.getState().project?.view.diagram ?? null;

  /** canvas の左上を原点とする位置。 */
  const pointOf = (event: MouseEvent): ScreenPoint => {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  /** 2 点が囲む範囲を、描くものの座標で表す。 */
  const rectOf = (from: ScreenPoint, to: ScreenPoint, viewport: Viewport): SelectionRect => ({
    fromTime: xToTime(from.x, viewport),
    toTime: xToTime(to.x, viewport),
    fromAxis: yToAxis(from.y, viewport),
    toAxis: yToAxis(to.y, viewport),
  });

  const onPointerDown = (event: PointerEvent): void => {
    // 送りの側が既に受け取っている（中ボタン、スペース + 左ボタン）。
    if (event.defaultPrevented || event.button !== LEFT_BUTTON) return;

    origin = pointOf(event);
    dragging = false;
  };

  /** 掴めるスジの上では指の形を変える（仕様書 §6.3.1）。 */
  const onHover = (event: PointerEvent): void => {
    if (origin !== null) return;

    // 掴んで動かしている最中は、送りの側が形を決めている。取り合わない。
    const current = canvas.style.cursor;
    if (current !== '' && current !== 'pointer') return;

    const view = viewOf();
    if (view === null) return;

    const over =
      hitTrip(
        selectDiagramScene(store.getState(), theme),
        viewportForCanvas(view, canvas),
        pointOf(event),
      ) !== null;
    canvas.style.cursor = over ? 'pointer' : '';
  };

  const onDragMove = (event: PointerEvent): void => {
    const view = viewOf();
    if (origin === null || view === null) return;

    const point = pointOf(event);
    if (!dragging && Math.hypot(point.x - origin.x, point.y - origin.y) < DRAG_THRESHOLD) return;

    dragging = true;
    store.getState().setSelectionRect(rectOf(origin, point, viewportForCanvas(view, canvas)));
  };

  const onPointerUp = (event: PointerEvent): void => {
    const view = viewOf();
    if (origin === null || view === null) {
      cancel();
      return;
    }

    const state = store.getState();
    const scene = selectDiagramScene(state, theme);
    const viewport = viewportForCanvas(view, canvas);
    const additive = event.ctrlKey || event.metaKey;
    const point = pointOf(event);

    if (dragging) {
      const ids = tripsInRect(scene, viewport, rectOf(origin, point, viewport)).map(
        (trip) => trip.sourceTripId,
      );
      state.selectTrips(selectionAfterRect(state.ui.selectedTripIds, ids, additive));
    } else {
      const hit = hitTrip(scene, viewport, point);
      state.selectTrips(
        nextSelection(state.ui.selectedTripIds, hit?.sourceTripId ?? null, additive),
      );
    }

    origin = null;
    dragging = false;
    state.setSelectionRect(null);
  };

  /** 途中で断たれたら囲みを畳む。枠だけが画面に残らないようにする。 */
  const cancel = (): void => {
    if (origin === null) return;
    origin = null;
    dragging = false;
    store.getState().setSelectionRect(null);
  };

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onHover as EventListener);
  canvas.addEventListener('blur', cancel);
  target.addEventListener('pointermove', onDragMove as EventListener);
  target.addEventListener('pointerup', onPointerUp as EventListener);
  target.addEventListener('pointercancel', cancel);

  return () => {
    canvas.removeEventListener('pointerdown', onPointerDown);
    canvas.removeEventListener('pointermove', onHover as EventListener);
    canvas.removeEventListener('blur', cancel);
    target.removeEventListener('pointermove', onDragMove as EventListener);
    target.removeEventListener('pointerup', onPointerUp as EventListener);
    target.removeEventListener('pointercancel', cancel);
  };
}
