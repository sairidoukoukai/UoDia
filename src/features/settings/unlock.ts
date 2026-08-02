/**
 * 隠し設定の有効化（仕様書 §6.5.4、§8.1、T-36）。
 *
 * **操作の表（`features/shell/commands.ts`）には載せない。** 隠してあるものを
 * メニューに並べては隠したことにならず、鍵の一覧に出しても同じである。ここが
 * その例外を引き受ける唯一の場所であり、**受け口は 1 つの鍵しか見ない。**
 *
 * ## なぜ隠すのか
 *
 * 危ないからではない。停車パターンは**普段の作図で触る場所ではない**——路線の
 * 定義であり、便を作る操作とは別の頻度で変わる。並べておくと、探しものの途中で
 * 押されてしまう。
 *
 * 有効にしたことは保存しない（`AppSettings.patternsUnlocked`）。起動のたびに
 * 閉じるのは、覚えさせて開いたままにすると隠した意味が薄れるためである。
 */

import type { AppStore } from '@/store';

/** その打鍵が有効化の合図か（<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Alt</kbd>+<kbd>D</kbd>）。 */
export function isUnlockShortcut(event: {
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
}): boolean {
  if (!(event.ctrlKey || event.metaKey)) return false;
  // **修飾は過不足なく求める。** Shift も Alt も要る組み合わせであり、
  // 偶然に押されることがないだけの数を課している。
  return event.shiftKey && event.altKey && event.key.toLowerCase() === 'd';
}

export interface UnlockOptions {
  readonly store: { getState(): AppStore };
  /** 受け口を張る先。既定は `window`（テストで差し替える）。 */
  readonly target?: Pick<Window, 'addEventListener' | 'removeEventListener'>;
}

/** 有効化の受け口を繋ぐ。返った関数を呼ぶと繋ぎを解く。 */
export function attachUnlock(options: UnlockOptions): () => void {
  const target = options.target ?? window;

  const onKeyDown = (event: KeyboardEvent): void => {
    if (!isUnlockShortcut(event)) return;

    // **一度開いたら、その起動のあいだは開いたままにする。** 押すたびに
    // 開け閉めすると、開いているつもりで閉じている状態を作れてしまう。
    const state = options.store.getState();
    if (state.settings.patternsUnlocked) return;

    event.preventDefault();
    state.setSettings({ patternsUnlocked: true });
  };

  target.addEventListener('keydown', onKeyDown as EventListener);
  return () => {
    target.removeEventListener('keydown', onKeyDown as EventListener);
  };
}
