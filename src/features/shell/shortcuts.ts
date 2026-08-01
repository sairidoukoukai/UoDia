/**
 * 最大化のショートカット（仕様書 §6.4、T-32）。
 *
 * **窓に張る。** 最大化はどこに焦点があっても効くべきものであり、時刻表の升目を
 * 打っている最中にも押される。要素ごとに張ると、焦点の位置によって効いたり
 * 効かなかったりする。
 *
 * どの鍵がどちらを指すかは `layout.ts` の純関数が決める。ここは受け取って
 * ストアへ渡すだけである。
 */

import type { AppState, MaximizedPane } from '@/store';
import { maximizeShortcut, togglePane } from './layout';

/** 最大化の読み書きに要るだけの入れ口。 */
export interface ShortcutStore {
  getState(): AppState & { readonly setMaximizedPane: (pane: MaximizedPane) => void };
}

export interface ShortcutOptions {
  readonly store: ShortcutStore;
  /** 受け口を張る先。既定は `window`（テストで差し替える）。 */
  readonly target?: Pick<Window, 'addEventListener' | 'removeEventListener'>;
}

/** ショートカットを繋ぐ。返った関数を呼ぶと繋ぎを解く。 */
export function attachShortcuts(options: ShortcutOptions): () => void {
  const { store } = options;
  const target = options.target ?? window;

  const onKeyDown = (event: KeyboardEvent): void => {
    const pane = maximizeShortcut(event);
    if (pane === null) return;

    // ブラウザのタブ切り替えに渡さない（Tauri では既定の動きが無い）。
    event.preventDefault();
    const { ui, setMaximizedPane } = store.getState();
    setMaximizedPane(togglePane(ui.maximized, pane));
  };

  target.addEventListener('keydown', onKeyDown as EventListener);
  return () => {
    target.removeEventListener('keydown', onKeyDown as EventListener);
  };
}
