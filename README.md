# UoDia

大阪大学の学内連絡バス（通称「再履バス」）のダイヤグラム設計ソフト。

デスクトップ版（Tauri v2）と Web 版を同一のコードベースから提供する。

## ドキュメント

| 文書 | 内容 |
| --- | --- |
| [仕様書](docs/specification.md) | データモデル・機能仕様・非機能要件。**実装前に必読。** |
| [実装計画書](docs/implementation-plan.md) | タスク分解（T-01〜T-42）・技術的な設計判断・リスク |

## 開発環境

| 要件 | バージョン |
| --- | --- |
| Node.js | 20 以上 |
| Rust | 1.77.2 以上（デスクトップ版のみ） |
| Linux の追加依存 | WebKitGTK 4.1 |

## セットアップ

```bash
npm install
```

## コマンド

| コマンド | 内容 |
| --- | --- |
| `npm run dev` | Web 版の開発サーバ（http://localhost:1420） |
| `npm run dev:desktop` | デスクトップ版の開発起動 |
| `npm run dev:desktop:wsl` | 同上（WSL 用。後述） |
| `npm run build:web` | Web 版のビルド |
| `npm run build:desktop` | デスクトップ版のビルド |
| `npm run test` | テスト実行 |
| `npm run test:coverage` | カバレッジ付きテスト |
| `npm run lint` | ESLint |
| `npm run typecheck` | 型チェック |
| `npm run format` | Prettier で整形 |

## アーキテクチャ

```
src/
├── domain/      ドメインロジック（純関数。UI・プラットフォーム非依存）
├── platform/    プラットフォーム抽象化（Tauri / ブラウザ）
├── store/       状態管理と Undo/Redo コマンドスタック
├── features/    画面ごとの機能
├── components/  汎用 UI 部品
└── app/         レイアウト・メニュー・ショートカット
```

守るべき制約は 3 つ。

1. **`src/domain/` は React・Tauri・ブラウザ API を import しない。** 純関数のみで構成し、単体テストをモックなしで書けるようにする。
2. **Rust 側にドメインロジックを置かない。** 責務はファイル I/O のみ（仕様書 §10.3）。Web 版と同じ TypeScript のコードを動かすため。
3. **描画関数は `(ctx, scene, viewport)` の 3 引数で完結させる。** ストア・DOM を直接参照しない（実装計画書 §3.5）。将来の画像・PDF 書き出しがこの形に依存する。

## WSL でデスクトップ版を動かす場合

WSLg は DRI3 に対応していないため、WebKitGTK が GPU 合成に失敗してウィンドウが正しく表示されないことがある。その場合はソフトウェアレンダリングを強制する。

```bash
npm run dev:desktop:wsl
```

これでも表示されない場合は、Windows 側にネイティブインストールした Node.js / Rust で実行するとよい。Web 版（`npm run dev`）は WSL でも問題なく動作する。

## 進め方

作業は GitHub issue（T-01〜T-42）単位で行う。

- `develop` から `feat/T-xx-<slug>` ブランチを切る
- PR は CI（型チェック・Lint・テスト・ビルド）通過を必須とする
- コミット接頭辞: `feat:` / `fix:` / `refactor:` / `test:` / `chore:` / `docs:`
