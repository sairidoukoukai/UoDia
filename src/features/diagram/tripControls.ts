/**
 * スジを選び、動かす（仕様書 §6.3.1・§6.3.2、T-28／T-29）。
 *
 * 左ボタンだけを扱う。中ボタンとスペース + 左ボタンは送り（`viewportControls`）の
 * ものであり、**掴まれた出来事には手を出さない** — 送りの側が `preventDefault` で
 * 「これは自分が受け取った」と印を付けているため、それを見て譲る。2 つの層が同じ
 * 押し下げを取り合わないための、DOM に元からある約束事である。
 *
 * ## 左ボタンの行き先は 1 か所で決める
 *
 * 押した場所と動いた量から、**選ぶ・囲む・動かす**のどれになるかが決まる。
 *
 * | 押した場所 | 動かない | 動いた |
 * | --- | --- | --- |
 * | スジの上 | そのスジを選ぶ | 便を動かす（§6.3.2） |
 * | 何も無い場所 | 選択を解く | 矩形で囲む（§6.3.1） |
 *
 * この分岐を 2 つの層に分けると、「掴んだのは選択か移動か」を層どうしで教え合う
 * 必要が出る。**分岐が 1 つなら、教え合う必要も無い。**
 *
 * ## 押しただけか、動かしたか
 *
 * 押して離すまでに指がわずかも動かないことはない。**動いた量がしきい値を超えて
 * 初めて**囲む・動かすに移る。しきい値が無いと、スジを選ぼうとした指の震えが
 * 「空の矩形で囲んだ」ことになり、選択が消える。
 *
 * ## 動かすことは、その場で動かすことである
 *
 * 引きずっている最中の姿を別に持たない。**便そのものを動かし、履歴では
 * `mergeKey` で 1 操作にまとめる。** 見えているものが状態そのものであり、
 * 「途中経過の絵」と「確定した値」が食い違う余地が無い。5 分に吸い付くため、
 * 状態が変わるのは格子をまたいだときだけである。
 */

import type { DiagramView, Trip } from '@/domain/model';
import { createTrip, patternForStop, shiftTrips } from '@/domain/service';
import { roundMinutesToGrain } from '@/domain/time';
import {
  selectActiveDirection,
  selectActiveService,
  selectNetwork,
  type AppState,
  type DiagramTool,
  type ExecuteResult,
  type SelectionRect,
  type TripShift,
} from '@/store';
import { creationTargetAt } from './creation';
import type { ScreenPoint } from './drawTrips';
import { viewportForCanvas } from './interaction';
import { selectDiagramScene, type SceneTheme } from './scene';
import { hitTrip, nextSelection, selectionAfterRect, tripsInRect } from './selection';
import { xToTime, yToAxis, type Viewport } from './viewport';

/** 選択と移動に要るだけの入れ口。 */
export interface TripControlStore {
  getState(): AppState & {
    readonly selectTrips: (tripIds: readonly string[]) => void;
    readonly setSelectionRect: (rect: SelectionRect | null) => void;
    readonly setTripShift: (shift: TripShift | null) => void;
    readonly editProject: (
      label: string,
      recipe: (project: { services: { serviceId: string; trips: Trip[] }[] }) => void,
      mergeKey?: string,
    ) => ExecuteResult;
    readonly undo: () => boolean;
    readonly setTool: (tool: DiagramTool) => void;
  };
}

export interface TripControlOptions {
  readonly canvas: HTMLCanvasElement;
  readonly store: TripControlStore;
  readonly theme: SceneTheme;
  /** 引きずりの受け口を張る先。既定は `window`（テストで差し替える）。 */
  readonly target?: Pick<Window, 'addEventListener' | 'removeEventListener'>;
  /**
   * スジの上で右クリックされた（仕様書 §6.3.4、T-31）。
   *
   * 場所は canvas の左上を原点とする px。スジの無い場所では `null` を渡す
   * （開いているメニューを閉じるため）。**メニューそのものは React が描く**
   * ——canvas に文字と押しボタンを描き足すより、DOM に任せるほうが、焦点も
   * 読み上げも既にあるものが働く（§9.4）。
   */
  readonly onContextMenu?: (at: ScreenPoint | null) => void;
}

const LEFT_BUTTON = 0;

/** ここを超えて動いたら、囲む・動かすに移る（px）。 */
export const DRAG_THRESHOLD = 4;

/**
 * 引きずっている最中の身振り。
 *
 * 3 つの状態を真偽値の組で表すと、あり得ない組合せ（囲みながら動かす）を
 * 書けてしまう。**排他であることを型で示す。**
 */
type Gesture =
  | { readonly kind: 'press'; readonly origin: ScreenPoint; readonly hit: string | null }
  | { readonly kind: 'marquee'; readonly origin: ScreenPoint }
  | {
      readonly kind: 'move';
      readonly origin: ScreenPoint;
      readonly tripIds: readonly string[];
      /** これまでに実際に動かした分。 */
      readonly applied: number;
      /** この引きずりを 1 操作にまとめる鍵。**引きずるたびに変える。** */
      readonly mergeKey: string;
    };

/** 引きずりごとに違う鍵を作るための番号。 */
let dragCount = 0;

export function attachTripControls(options: TripControlOptions): () => void {
  const { canvas, store, theme } = options;
  const target = options.target ?? window;

  /** いま進んでいる身振り。押していなければ `null`。 */
  let gesture: Gesture | null = null;

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

    const view = viewOf();
    if (view === null) return;

    const origin = pointOf(event);

    // 作図モードでは、押した場所に便ができる（仕様書 §6.3.3）。**身振りは
    // 始めない**——引きずっても線は伸びず、終点はパターンが決める。
    if (store.getState().ui.tool === 'draw') {
      createAt(origin, viewportForCanvas(view, canvas));
      return;
    }

    const hit = hitTrip(
      selectDiagramScene(store.getState(), theme),
      viewportForCanvas(view, canvas),
      origin,
    );
    gesture = { kind: 'press', origin, hit: hit?.sourceTripId ?? null };
  };

  /**
   * 便を 1 つ作る（仕様書 §6.3.3）。作った便はそのまま選ばれる。
   *
   * **時刻表の升目に打ったときと同じ関数を通す**（`createTrip`）。運用番号の
   * 提案も便 ID の採番も、入口が違うだけで規則は 1 つである。
   */
  const createAt = (point: ScreenPoint, viewport: Viewport): void => {
    const state = store.getState();
    const network = selectNetwork(state);
    const service = selectActiveService(state);
    if (network === null || service === null) return;

    const target = creationTargetAt(selectDiagramScene(state, theme), viewport, point.x, point.y);
    if (target === null) return;

    // 経路は**押した停留所と、時刻表で開いている方向**から決まる。同じ停留所を
    // 両方向の便が通るため、方向を決める手立てが要る（§6.1.2 と同じ規則）。
    //
    // 1 本の線が 2 つの停留所を指すことがある（#117。コンベ前と人科前は同じ
    // 軸位置にある）。**開いている方向が通るほうを採る**——吹田方面ならコンベ前、
    // 豊中方面なら人科前であり、押した人にはどちらも「その線」である。
    const direction = selectActiveDirection(state);
    let chosen: { readonly stopId: string; readonly patternId: string } | null = null;
    for (const stopId of target.stopIds) {
      const patternId = patternForStop(network, direction, stopId);
      if (patternId !== null) {
        chosen = { stopId, patternId };
        break;
      }
    }
    if (chosen === null) return;

    const all = state.project?.services.flatMap((item) => item.trips) ?? [];
    const result = createTrip(
      service.trips,
      chosen.patternId,
      chosen.stopId,
      target.time,
      network,
      all,
    );
    // 表せる範囲を外れる位置には作れない。押しても何も起きない。
    if (result === null) return;

    state.editProject('スジの作成', (project) => {
      const target2 = project.services.find((item) => item.serviceId === service.serviceId);
      if (target2 !== undefined) target2.trips = result.trips as Trip[];
    });
    state.selectTrips(result.added.map((trip) => trip.tripId));
  };

  /** 押せば何が起きるかを指の形で示す（仕様書 §6.3.1、§9.4）。 */
  const onHover = (event: PointerEvent): void => {
    if (gesture !== null) return;

    // 掴んで動かしている最中は、送りの側が形を決めている。取り合わない。
    const current = canvas.style.cursor;
    if (current !== '' && current !== 'pointer' && current !== 'crosshair') return;

    const view = viewOf();
    if (view === null) return;

    const state = store.getState();
    const viewport = viewportForCanvas(view, canvas);
    const point = pointOf(event);

    if (state.ui.tool === 'draw') {
      // 作れる場所（停留所線の近く）でだけ十字にする。外は押しても何も起きない。
      const target = creationTargetAt(selectDiagramScene(state, theme), viewport, point.x, point.y);
      canvas.style.cursor = target === null ? '' : 'crosshair';
      return;
    }

    const over = hitTrip(selectDiagramScene(state, theme), viewport, point) !== null;
    canvas.style.cursor = over ? 'pointer' : '';
  };

  const onDragMove = (event: PointerEvent): void => {
    const view = viewOf();
    if (gesture === null || view === null) return;

    const viewport = viewportForCanvas(view, canvas);
    const point = pointOf(event);

    let current: Gesture = gesture;
    if (current.kind === 'press') {
      if (Math.hypot(point.x - current.origin.x, point.y - current.origin.y) < DRAG_THRESHOLD) {
        return;
      }
      current = begin(current);
      gesture = current;
    }

    if (current.kind === 'marquee') {
      store.getState().setSelectionRect(rectOf(current.origin, point, viewport));
      return;
    }

    moveTrips(current, point, viewport);
  };

  /**
   * しきい値を超えた瞬間に、囲むのか動かすのかを決める。
   *
   * 掴んだスジが選ばれていなければ、**まず選んでから動かす。** 何が動くのかを
   * 見せずに動かし始めては、意図しない便を動かしていても気づけない。
   */
  const begin = (press: Gesture & { kind: 'press' }): Exclude<Gesture, { kind: 'press' }> => {
    if (press.hit === null) return { kind: 'marquee', origin: press.origin };

    const state = store.getState();
    const selection = state.ui.selectedTripIds;
    const tripIds = selection.includes(press.hit) ? selection : [press.hit];
    if (!selection.includes(press.hit)) state.selectTrips(tripIds);

    dragCount += 1;
    return {
      kind: 'move',
      origin: press.origin,
      tripIds,
      applied: 0,
      mergeKey: `diagram-drag:${String(dragCount)}`,
    };
  };

  /**
   * 便を水平に動かす（仕様書 §6.3.2）。
   *
   * **縦の動きは見ない。** 傾きは区間所要時間で決まっており、便ごとに変えられない
   * （§2.2）。上下に引きずっても意味を持たせようがない。
   */
  const moveTrips = (
    move: Gesture & { kind: 'move' },
    point: ScreenPoint,
    viewport: Viewport,
  ): void => {
    const minutes = roundMinutesToGrain((point.x - move.origin.x) / viewport.pxPerMinute);
    let applied = move.applied;

    if (minutes !== applied && applyShift(move, minutes - applied)) {
      applied = minutes;
      gesture = { ...move, applied };
    }

    // **出すのは実際に動いた分である。** 範囲を外れて動かせなかったとき、
    // 求めた分を出すと、画面の数字と便の位置が食い違う。
    store.getState().setTripShift({
      minutes: applied,
      atTime: xToTime(point.x, viewport),
      atAxis: yToAxis(point.y, viewport),
    });
  };

  /**
   * 便を差分だけ動かす。動かせたなら `true`。
   *
   * **1 便でも表せる範囲を外れるなら、何も動かさない**（`shiftTrips`）。一部だけ
   * 動いた状態は、利用者が求めたものではない。
   */
  const applyShift = (move: Gesture & { kind: 'move' }, delta: number): boolean => {
    const state = store.getState();
    const network = selectNetwork(state);
    const serviceId = selectActiveService(state)?.serviceId;
    if (network === null || serviceId === undefined) return false;

    const result = state.editProject(
      'スジの移動',
      (project) => {
        const service = project.services.find((item) => item.serviceId === serviceId);
        if (service === undefined) return;
        const next = shiftTrips(service.trips, move.tripIds, delta, network);
        // 範囲を外れたときは何も変えない。`changed: false` で戻る。
        if (next !== null) service.trips = next as Trip[];
      },
      // 引きずり全体を 1 回の取り消しで戻す（仕様書 §6.7）。**鍵は引きずりごとに
      // 変える。** 同じ鍵を使い回すと、2 回目の引きずりが 1 回目に合流し、
      // 1 度の取り消しで両方が戻る。
      move.mergeKey,
    );

    return result.ok && result.changed;
  };

  const onPointerUp = (event: PointerEvent): void => {
    const view = viewOf();
    if (gesture === null || view === null) {
      finish();
      return;
    }

    const state = store.getState();
    const viewport = viewportForCanvas(view, canvas);
    const additive = event.ctrlKey || event.metaKey;
    const point = pointOf(event);

    if (gesture.kind === 'marquee') {
      const ids = tripsInRect(
        selectDiagramScene(state, theme),
        viewport,
        rectOf(gesture.origin, point, viewport),
      ).map((trip) => trip.sourceTripId);
      state.selectTrips(selectionAfterRect(state.ui.selectedTripIds, ids, additive));
    } else if (gesture.kind === 'press') {
      state.selectTrips(nextSelection(state.ui.selectedTripIds, gesture.hit, additive));
    }
    // 動かしたときは、既に動き終わっている。選択も掴んだ時点で決まっている。

    finish();
  };

  /** 身振りを終える。画面に出していた枠と数字を畳む。 */
  const finish = (): void => {
    gesture = null;
    const state = store.getState();
    state.setSelectionRect(null);
    state.setTripShift(null);
  };

  /**
   * 引きずりを取り消す（仕様書 §6.3.2 の <kbd>Esc</kbd>）。
   *
   * 動かしたぶんは**取り消しで戻す。** 引きずり全体が 1 操作にまとまっているため、
   * 1 回で始めの位置へ戻る。まだ 1 度も動かしていなければ、戻すものは無い——
   * ここで取り消すと、引きずりとは関係のない前の編集が消える。
   */
  const cancel = (): void => {
    if (gesture === null) return;
    if (gesture.kind === 'move' && gesture.applied !== 0) store.getState().undo();
    finish();
  };

  /**
   * 右クリック（仕様書 §6.3.4）。
   *
   * **押したスジをまず選ぶ。** 何に効く操作なのかを見せないままメニューを
   * 出すと、選んだつもりの無い便が消える。既に選ばれている便を押したときは
   * 選択をそのままにする——まとめて効かせるための選択を崩さない。
   */
  const onContextMenu = (event: MouseEvent): void => {
    const view = viewOf();
    if (view === null) return;

    // ブラウザの既定のメニューは出さない。
    event.preventDefault();

    const point = pointOf(event);
    const state = store.getState();
    const hit = hitTrip(
      selectDiagramScene(state, theme),
      viewportForCanvas(view, canvas),
      point,
    )?.sourceTripId;

    if (hit === undefined) {
      options.onContextMenu?.(null);
      return;
    }

    if (!state.ui.selectedTripIds.includes(hit)) state.selectTrips([hit]);
    options.onContextMenu?.(point);
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') return;

    if (gesture !== null) {
      event.preventDefault();
      cancel();
      return;
    }

    // 何も掴んでいないときの Esc は、作図をやめて選択へ戻る（§6.3.3）。
    // **押し続けるつもりの無い道具から抜ける手立て**を、手元に残しておく。
    if (store.getState().ui.tool === 'draw') {
      event.preventDefault();
      store.getState().setTool('select');
      canvas.style.cursor = '';
    }
  };

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('contextmenu', onContextMenu);
  canvas.addEventListener('pointermove', onHover as EventListener);
  canvas.addEventListener('keydown', onKeyDown);
  canvas.addEventListener('blur', cancel);
  target.addEventListener('pointermove', onDragMove as EventListener);
  target.addEventListener('pointerup', onPointerUp as EventListener);
  target.addEventListener('pointercancel', cancel);

  return () => {
    canvas.removeEventListener('pointerdown', onPointerDown);
    canvas.removeEventListener('contextmenu', onContextMenu);
    canvas.removeEventListener('pointermove', onHover as EventListener);
    canvas.removeEventListener('keydown', onKeyDown);
    canvas.removeEventListener('blur', cancel);
    target.removeEventListener('pointermove', onDragMove as EventListener);
    target.removeEventListener('pointerup', onPointerUp as EventListener);
    target.removeEventListener('pointercancel', cancel);
  };
}
