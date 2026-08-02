import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

// Tauri 実行時は TAURI_ENV_* が注入される。
const isTauri = Boolean(process.env.TAURI_ENV_PLATFORM);

/**
 * 置き場所（仕様書 §10.4、T-42）。
 *
 * **ルート直下を前提にしない。** 配信先が決まっていない以上、サブディレクトリに
 * 置かれることを既定として扱う。相対で書き出しておけば、どこに置いても動く。
 *
 * 絶対パスで配りたいときは `UODIA_BASE=/uodia/ npm run build:web` のように渡す。
 * デスクトップ版は `tauri://` から読むため、ここは触らない。
 */
const base = isTauri ? '/' : (process.env.UODIA_BASE ?? './');

export default defineConfig({
  base,
  plugins: [react()],

  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },

  // Tauri は固定ポートを要求する。
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      // Rust 側の変更で Vite が再読込しないようにする。
      ignored: ['**/src-tauri/**'],
    },
  },

  // Web 版とデスクトップ版で同一のバンドルを用いる（仕様書 §10.4）。
  build: {
    // Tauri v2 の最小 WebView に合わせる。Web 版はより広くターゲットする。
    target: isTauri ? ['es2021', 'chrome105', 'safari15'] : 'es2022',
    sourcemap: !isTauri,
    rollupOptions: {
      output: {
        /*
          **外の部品だけを分ける**（T-42）。

          初回に落とす量は分けても変わらない（どちらも読み込む）。効くのは
          2 回目以降で、アプリを直しても React や Zod は落とし直さずに済む。
          機能ごとに細かく割らないのは、**この画面が全部を一度に使う**ためで
          ある——時刻表もダイヤグラムも起動した瞬間に出る。
        */
        manualChunks(id) {
          return id.includes('node_modules') ? 'vendor' : undefined;
        },
      },
    },
  },
});
