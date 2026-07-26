/**
 * 実行環境に応じた実装を選ぶ。
 *
 * デスクトップ版の実装は**動的に読み込む**。静的に import すると
 * `@tauri-apps/api` が Web 版のバンドルにも入り、ブラウザでしか使わない利用者に
 * 不要なコードを配ることになる。
 *
 * 判定と生成をここに閉じ込めることで、アプリの起動側（`main.tsx`）は
 * 「環境を選ぶ」ことを知らずに済む。
 */

import type { PlatformAdapter } from './types';

/**
 * Tauri の中で動いているか。
 *
 * Tauri v2 は起動時に `window.__TAURI_INTERNALS__` を注入する。この有無で判定
 * するのは Tauri 自身の `isTauri()` と同じ方法であり、そのためだけに
 * `@tauri-apps/api` を静的に import せずに済む。
 */
export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/** 環境に合った実装を作る。 */
export async function createPlatform(): Promise<PlatformAdapter> {
  if (isTauri()) {
    const { createTauriPlatform } = await import('./tauri');
    return createTauriPlatform();
  }
  const { createBrowserEnvironment, createWebPlatform } = await import('./web');
  return createWebPlatform(createBrowserEnvironment());
}
