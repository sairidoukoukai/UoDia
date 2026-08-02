import { defineConfig } from 'vitest/config';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    // DOM を要する一部の UI テストのみ jsdom を使う（ファイル冒頭に
    // `// @vitest-environment jsdom` を書く）。既定を node にすることで
    // ドメイン層のテストを高速に保つ。
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    // jsdom に無いものを補う（`matchMedia` など）。node 環境でも読み込むが、
    // 既にあるものには触れない。
    setupFiles: ['./vitest.setup.ts'],
    // T-01 時点ではテスト対象がまだ無い。最初の実テストは T-03 で追加する。
    passWithNoTests: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      // ドメイン層のカバレッジ 80% 以上（実装計画書 §2.3）
      include: ['src/domain/**/*.ts'],
      exclude: ['src/domain/**/index.ts', 'src/domain/**/*.test.ts'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
  },
});
