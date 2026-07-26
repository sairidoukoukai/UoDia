# UoDia

大阪大学の学内連絡バス（通称「再履バス」）のダイヤグラム設計ソフト。

デスクトップ版（Tauri v2）と Web 版を同一のコードベースから提供する。

> [!IMPORTANT]
> **本ソフトウェアは大阪大学および運行事業者の公式なものではありません。** 有志による非公式のツールです。
>
> 本リポジトリに含まれるダイヤデータは設計・検討用であり、**実際の運行時刻を保証するものではありません。** 乗車の際は必ず[大学の公式時刻表](https://www.osaka-u.ac.jp/ja/access/bus)をご確認ください。

## ドキュメント

| 文書 | 内容 |
| --- | --- |
| [仕様書](docs/specification.md) | データモデル・機能仕様・非機能要件。**実装前に必読。** |
| [実装計画書](docs/implementation-plan.md) | タスク分解（T-01〜T-42）・技術的な設計判断・リスク |
| [リファクタリング記録](docs/refactoring-log.md) | 構造だけを直した作業と、**その重複が生まれた理由** |

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
| `npm run dev:desktop` | デスクトップ版の開発起動（WSL は自動判定） |
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

**追加の操作は要らない。** アプリ自身が WSL を判定し、必要な描画設定を入れてから起動する（`src-tauri/src/rendering.rs`）。

設定を起動スクリプトで渡す方式ではなく**アプリ側に持たせている**のは、配布したバイナリ（.deb / AppImage）を直接実行したときにも効かせるためである。利用者は開発用のスクリプトなど使わない。

WSLg の既定経路（Wayland）では WebKitGTK の EGL 初期化が失敗し、**ウィンドウは作られるのに何も描かれない**という分かりにくい壊れ方をする。タスクバーには項目が現れるため、起動していないのか描けていないのかも判別しにくい。

```
MESA: error: ZINK: failed to choose pdev
libEGL warning: egl: failed to create dri2 screen
```

`GDK_BACKEND=x11` で X11（Xwayland）経由にすると描画される。あわせてソフトウェアレンダリングに倒し、`libEGL warning: DRI3 error` が出続けないようにしている。既に設定されている環境変数は上書きしないため、意図して指定した設定は奪われない。

Web 版（`npm run dev`）は WSL でもそのまま動作する。ブラウザで確認するだけなら、こちらの方が起動が速い。

## 進め方

作業は GitHub issue（T-01〜T-42）単位で行う。

- `develop` から `feat/T-xx-<slug>` ブランチを切る
- PR は CI（型チェック・Lint・テスト・ビルド）通過を必須とする
- コミット接頭辞: `feat:` / `fix:` / `refactor:` / `test:` / `chore:` / `docs:`
