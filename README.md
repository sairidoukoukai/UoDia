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
| [仕様書 v1.1（追補）](docs/specification-v1.1.md) | v1.0 リリース後の issue（#158〜#168）に対する追補。**草案。** |
| [実装計画書](docs/implementation-plan.md) | タスク分解（T-01〜T-42）・技術的な設計判断・リスク |
| [実装計画書 v1.1](docs/implementation-plan-v1.1.md) | v1.1 のタスク分解（T-56〜T-69）。issue #158〜#168 に対応 |
| [仕様書 v2（追補）](docs/specification-v2.md) | 書き出し・運行日カレンダー・GTFS 出力。issue #163・#192〜#198 に対応。**草案（未確定事項ゼロ）。** |
| [実装計画書 v2](docs/implementation-plan-v2.md) | v2 のタスク分解（T-70〜T-83） |
| [実装計画書 v2.1](docs/implementation-plan-v2.1.md) | v2.0.0 を配ったあとに出た指摘（#219〜#222）に対するタスク分解（T-84〜T-88） |
| [仕様書（ポータブル版）](docs/specification-portable.md) | インストーラーを使わない配り方。**草案。** |
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
| `npm run preview` | ビルドした Web 版を手元で開く（http://localhost:4173） |
| `npm run build:web:dist` | Web 版のビルド + 事前圧縮（配布用） |
| `npm run build:desktop` | デスクトップ版のビルド（配布物も作る） |
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

## 配布物を作る（T-41）

```
npm run build:desktop            # 3 OS それぞれの機械で走らせる
node scripts/check-bundle-size.mjs   # 出来た配布物と実行ファイルの大きさ
```

| OS | 出来るもの |
| --- | --- |
| Linux | `.deb` / `.rpm` / `.AppImage` |
| Windows | `.msi` / `.exe`（NSIS） |
| macOS | `.dmg` / `.app` |

**`route.json` は同梱される**（`bundle.resources`）。初回起動時に設定ディレクトリへ複製し、以後はそちらを読む——インストール先が書き込み不可のことがあり、隠し設定からの書き戻し（T-36）ができなくなるためである（`src-tauri/src/paths.rs`）。

**アイコンの版元は `src-tauri/icons/source.svg`** である。描き直したら次の 2 つで作り直す。

```
convert -background none src-tauri/icons/source.svg -resize 1024x1024 /tmp/uodia.png
npx tauri icon /tmp/uodia.png
```

## 手元で動かす

**どこにも置かない**（2026-08-03 決定。仕様書 Q-3）。Web 版もデスクトップ版も、**手元で動かす**ものとする。GitHub Pages を含め、静的ホスティングへの配置と自動デプロイは行わない。

| 版 | 動かし方 |
| --- | --- |
| Web | `npm run build:web` の後 `npm run preview` で http://localhost:4173 が開く。**サーバの用意も配置も要らない**。書きながら見るなら `npm run dev` |
| デスクトップ | `npm run build:desktop` で出来た配布物を入れる。作らずに動かすなら `npm run dev:desktop` |

**それでも「どこにでも置ける成果物」は作り続ける。**

| 決め | 内容 |
| --- | --- |
| 置き場所 | **どこでもよい。** 資産は相対で書き出してあり、`https://例/tools/uodia/` のようなサブディレクトリでも動く |
| 絶対パスにしたいとき | `UODIA_BASE=/uodia/ npm run build:web` |
| 圧縮 | `npm run build:web:dist` で `.gz` と `.br` も作る。対応するサーバはそれを配る |
| 初回に落ちる量 | **約 107KB**（gzip 後。目標は 1MB 以内） |

置き場所が決まったときに作り直す羽目にならないためである。**置かないことと、置けないことは違う。**

### 配布物

**タグを打ったときだけ** CI が 3 OS でビルドし、GitHub Releases に**下書き**として上げる（`.github/workflows/ci.yml`）。

```
git tag v1.2.0 && git push origin v1.2.0
```

自動で公開しないのは、公開が取り消せない操作だからである。下書きのまま置いておけば、中身は関係者だけが取れる。

> [!IMPORTANT]
> **v1.1 のリリースノートには、Windows で「旧版を削除してから入れる」ことを書くこと。**
>
> v1.1 で `bundle.publisher` を `再履同好会` から `再履バス同好会` に直した（#158）。NSIS は既定のインストール先を `%LOCALAPPDATA%\<publisher>\<product>` に取り、アンインストール情報のレジストリキーもここから作るため、**インストーラから見て v1.0.0 とは別の製品になる。** 上書きされず、「プログラムの追加と削除」に 2 つ並ぶ。
>
> 旧版を掃除する仕組みは入れていない。**掃除を書けば、その掃除の正しさを確かめる手立てが要る。** 入れている人数が数えられる規模であるため、手で消してもらう（[仕様書 v1.1 §3.1.1](docs/specification-v1.1.md)）。
>
> macOS と Linux では起きない。`.app` は差し替えであり、`.deb` / `.rpm` はパッケージ名（`uodia`）で同一性が決まる。

**タグを打つ前に、ワークフローがタグで起動することを確かめること。** `on.push` に `branches` だけを書くと、タグの push ではワークフローそのものが起動せず、`refs/tags/v*` を見るジョブは一度も動かない（2026-08-03 に踏んだ）。

### タグを打たずに配布物を取る

`develop` / `main` へのマージでも 3 OS のビルドは走っており、成果物は artifact に残る（**14 日**）。

```
gh run download -n uodia-Windows -D <保存先>   # nsis/*.exe と msi/*.msi
gh run download -n uodia-Linux   -D <保存先>   # .deb / .rpm / .AppImage
gh run download -n uodia-macOS   -D <保存先>   # .dmg / .app
```

## 進め方

作業は GitHub issue（T-01〜T-42）単位で行う。

- `develop` から `feat/T-xx-<slug>` ブランチを切る
- PR は CI（型チェック・Lint・テスト・ビルド）通過を必須とする
- コミット接頭辞: `feat:` / `fix:` / `refactor:` / `test:` / `chore:` / `docs:`
