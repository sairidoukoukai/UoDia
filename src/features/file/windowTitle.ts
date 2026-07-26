/**
 * ウィンドウ題名を状態に追従させる（仕様書 §6.8）。
 *
 * 題名が変わる契機はファイル操作だけではない。**1 文字打っただけでも
 * 未保存になる**ため、状態の変化そのものを見る。
 *
 * 前回と同じ題名なら書き換えない。デスクトップ版では OS への呼び出しになり、
 * 打鍵のたびに投げるのは無駄である。
 */

import type { PlatformAdapter } from '@/platform';
import { selectIsDirty, type AppState, type AppStoreHook } from '@/store';
import { formatWindowTitle } from './title';

/** 今の状態に対応する題名。 */
export function windowTitleOf(state: AppState): string {
  return formatWindowTitle(state.file.handle?.name ?? null, selectIsDirty(state));
}

/**
 * 題名の追従を始める。戻り値を呼ぶと止まる。
 *
 * @returns 購読を解除する関数
 */
export function watchWindowTitle(store: AppStoreHook, platform: PlatformAdapter): () => void {
  let last: string | null = null;

  const apply = (state: AppState): void => {
    const title = windowTitleOf(state);
    if (title === last) return;
    last = title;

    void (async () => {
      try {
        await platform.setWindowTitle(title);
      } catch {
        // 題名を変えられなくても編集は続けられる。ここで落とすほうが害が大きい。
      }
    })();
  };

  apply(store.getState());
  return store.subscribe(apply);
}
