import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: ['dist', 'coverage', 'src-tauri/target', 'src-tauri/gen', 'node_modules'],
  },

  js.configs.recommended,

  // ---- TypeScript（型情報を用いる厳格なルール。実装計画書 T-01）----
  {
    files: ['**/*.{ts,tsx}'],
    extends: [...tseslint.configs.strictTypeChecked, ...tseslint.configs.stylisticTypeChecked],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
      parserOptions: {
        projectService: {
          allowDefaultProject: ['e2e/*.ts', 'playwright.config.ts'],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // 仕様書 §9.3: `any` の使用は原則禁止する。
      '@typescript-eslint/no-explicit-any': 'error',

      // 未使用変数は `_` 接頭辞で明示的に無視できるようにする。
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],

      // 型のみの import を明示させる（verbatimModuleSyntax と対応）。
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
    },
  },

  // ---- React ----
  {
    files: ['**/*.{ts,tsx}'],
    extends: [reactHooks.configs.flat['recommended-latest'], reactRefresh.configs.vite],
  },

  // ---- プラットフォーム境界（仕様書 §10.4、実装計画書 T-12）----
  //
  // `src/domain/` と `src/features/` は PlatformAdapter にのみ依存し、
  // Tauri API とブラウザ API を直接呼ばない。方針を文書に書くだけでは、
  // 「ここだけ」の直接呼び出しが必ず入り込む。
  {
    files: ['src/domain/**/*.{ts,tsx}', 'src/features/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@tauri-apps/*', '@tauri-apps/**'],
              message:
                'Tauri API を直接呼ばないでください。PlatformAdapter（src/platform）を経由します。',
            },
            {
              group: ['@/platform/tauri', '@/platform/web', '**/platform/tauri', '**/platform/web'],
              message:
                '特定の実装に依存しないでください。PlatformAdapter インタフェースを使います。',
            },
          ],
        },
      ],
      // 永続化・通信に関わるブラウザ API も同様に禁じる。DOM の操作そのものは
      // 画面を描く以上避けられないため、features では許す（domain では下で禁じる）。
      'no-restricted-globals': [
        'error',
        { name: 'localStorage', message: 'PlatformAdapter を経由してください。' },
        { name: 'sessionStorage', message: 'PlatformAdapter を経由してください。' },
        { name: 'indexedDB', message: 'PlatformAdapter を経由してください。' },
        { name: 'fetch', message: 'PlatformAdapter を経由してください。' },
      ],
    },
  },
  {
    // ドメイン層は純関数のみで構成する（実装計画書 §2.3）。DOM にも触れない。
    files: ['src/domain/**/*.{ts,tsx}'],
    ignores: ['src/domain/**/*.{test,spec}.{ts,tsx}'],
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'window', message: 'ドメイン層はブラウザ API に依存しません。' },
        { name: 'document', message: 'ドメイン層はブラウザ API に依存しません。' },
        { name: 'navigator', message: 'ドメイン層はブラウザ API に依存しません。' },
        { name: 'localStorage', message: 'PlatformAdapter を経由してください。' },
        { name: 'sessionStorage', message: 'PlatformAdapter を経由してください。' },
        { name: 'indexedDB', message: 'PlatformAdapter を経由してください。' },
        { name: 'fetch', message: 'PlatformAdapter を経由してください。' },
      ],
    },
  },

  // ---- 設定ファイル（Node 環境・型情報ルールの対象外）----
  {
    files: ['**/*.js', '**/*.cjs', '**/*.mjs'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    files: ['*.config.ts'],
    languageOptions: {
      globals: globals.node,
    },
  },

  // ---- テスト ----
  {
    files: ['**/*.{test,spec}.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },

  // Prettier と競合する整形系ルールを無効化する（必ず最後）。
  prettier,
);
