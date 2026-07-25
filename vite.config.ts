import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

// Tauri 実行時は TAURI_ENV_* が注入される。
const isTauri = Boolean(process.env.TAURI_ENV_PLATFORM);

export default defineConfig({
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
  },
});
