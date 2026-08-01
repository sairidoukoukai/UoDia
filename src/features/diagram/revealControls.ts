/**
 * 選択が変わったらスジを画面に入れる（仕様書 §6.3.1、T-38）。
 *
 * **見るのは選択だけである。** 状態が変わるたびに寄せ直すと、便を 1 つ動かす
 * たびに視野が動く。購読はストア全体に掛かるため、`ui.selectedTripIds` の
 * 参照が変わったときにだけ働くようにする。
 *
 * 寄せるかどうかの判断は純関数（`viewToReveal`）にある。ここは canvas の
 * 大きさを測ってそれを呼び、返った視野を置くだけである。
 */

import type { DiagramView } from '@/domain/model';
import type { AppState } from '@/store';
import { axisBoundsOf, sameView, viewportForCanvas } from './interaction';
import { viewToReveal } from './reveal';
import { selectDiagramScene, type SceneTheme } from './scene';

/** 視野の読み書きと購読に要るだけの入れ口。 */
export interface RevealStore {
  getState(): AppState & { readonly setDiagramView: (view: DiagramView) => void };
  subscribe(listener: () => void): () => void;
}

export interface RevealControlOptions {
  readonly canvas: HTMLCanvasElement;
  readonly store: RevealStore;
  /** 場面の組み立てに要る色。**同じ参照を渡し続けること**（`selectDiagramScene`）。 */
  readonly theme: SceneTheme;
}

/** 選択への追随を繋ぐ。返った関数を呼ぶと繋ぎを解く。 */
export function attachSelectionReveal(options: RevealControlOptions): () => void {
  const { canvas, store, theme } = options;
  let lastSelection = store.getState().ui.selectedTripIds;

  const onChange = (): void => {
    const state = store.getState();
    const selection = state.ui.selectedTripIds;
    if (selection === lastSelection) return;
    lastSelection = selection;

    const view = state.project?.view.diagram;
    if (view === undefined) return;

    const scene = selectDiagramScene(state, theme);
    const next = viewToReveal(scene, viewportForCanvas(view, canvas), view, axisBoundsOf(scene));
    // 変わっていないなら書き換えない。書き換えれば描き直しが起きる。
    if (next === null || sameView(view, next)) return;

    state.setDiagramView(next);
  };

  return store.subscribe(onChange);
}
