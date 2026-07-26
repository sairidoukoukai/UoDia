# リファクタリング記録

機能を変えずに構造だけを直した作業の記録。**何を直したかではなく、なぜ直せたのかを残す**ことを目的とする。

同じ形の重複は、一度潰しても新しい機能とともに戻ってくる。戻ってきたときに「前もこれを潰した」と気づけるよう、**重複が生まれた理由**まで書く。理由が制約（型検査の都合など）に由来する場合、その制約が続くかぎり同じ重複がまた生まれるためである。

書く対象は、複数の箇所にまたがる構造の変更に限る。1 ファイルの中で閉じた整理は履歴を読めば足りる。

---

## 2026-07-27 M2 完了時点の重複解消（T-45）

M0〜M2（T-01〜T-18）で書かれたコードから、**複数箇所に散っていた同じ形の記述**を取り除いた。振る舞いは変えていない。

きっかけは M2 の完了である。ここまでで層（`domain` / `platform` / `store` / `features`）が出揃い、各層に「その層でしか起きない定型」が何であるかが見えるようになった。層が 1 つしか無い段階で共通化すると、2 つ目の利用者が現れたときに形が合わず、結局書き直しになる。

### 1. 隣接する 2 要素の反復 — 5 箇所

**新設**: [`src/domain/util/adjacent.ts`](../src/domain/util/adjacent.ts) の `adjacentPairs`

ダイヤのデータは「隣どうしの関係」で意味が決まるものが多く、同じ形の反復が 5 箇所にあった。

| 箇所 | 何を見ていたか |
| --- | --- |
| `domain/network/validate.ts` | R-03: パターンの隣接停留所対が区間表にあるか |
| `domain/validation/validate.ts` | V-01/V-02: 前便の終着と次便の始発が繋がっているか |
| `domain/validation/validate.ts` | V-06: ある停留所を通る同方向の便の間隔 |
| `domain/block/derive.ts` | 折返し時分（直前の便の終着との差） |
| `domain/block/derive.ts` | 営業所待機（入庫回送と次の出庫回送の隙間） |

**なぜ重複したか。** `tsconfig.json` の `noUncheckedIndexedAccess` により `values[index - 1]` は `T | undefined` になる。素直に添字で書くと**到達し得ない分岐**を書く羽目になるため、どの箇所も「直前の要素を変数で持ち回り、`undefined` かどうかで先頭を見分ける」という同じ回避策を採っていた。回避策の言い訳を述べたコメントまで 2 箇所で重複していた。

この制約は今後も続く。**同じ重複はまた生まれる**ので、隣接ペアを見る処理を書くときは `adjacentPairs` を先に探すこと。

```typescript
// 変更前（各所にこれがあった）
let previous: BlockTrip | undefined;
for (const current of block.trips) {
  if (previous !== undefined) {
    /* 本題 */
  }
  previous = current;
}

// 変更後
for (const [previous, current] of adjacentPairs(block.trips)) {
  /* 本題 */
}
```

**先頭を表す印に `T | undefined` を使っていない。** `T` 自身が `undefined` を含みうる場合に「先頭である」ことと「値が `undefined` だった」ことを見分けられず、組が 1 つ落ちるため、モジュール私有の `Symbol` を印にしている。この性質はテストで固定した。

第 3 の値として `right` の位置を返すのは、R-03 の指摘が「繋がらなかった側」を指す必要があるためである。

### 2. `JSON.parse` の包み直し — 3 箇所

**新設**: [`src/domain/util/json.ts`](../src/domain/util/json.ts) の `parseJson`

`route.json`（`domain/network/load.ts`）・`.uodia`（`domain/io/load.ts`）・自動バックアップ（`domain/io/backup.ts`）の読込が、同じ try/catch を持っていた。

**なぜ重複したか。** `JSON.parse` は失敗を例外で伝え、成功した値を `any` で返す。ドメイン層はどちらも受け取らない方針（失敗は戻り値で表す・`any` を持ち込まない）であり、読込を書くたびに同じ包み直しが要る。

副次的な効果として、**`any` に触れる場所がこの 1 ファイルだけ**になった。読込の段階を型で区別する設計（`stage: 'json' | 'schema' | 'rules'`）はそのまま保っている。

### 3. 他実装のハンドルを断る — 7 箇所・3 実装

**新設**: [`src/platform/types.ts`](../src/platform/types.ts) の `foreignHandleError`

`FileHandle.ref` を解釈してよいのは、その値を作ったアダプタだけである（仕様書 §10.4）。この検査が Tauri 版に 3 箇所・Web 版に 2 箇所・インメモリ版に 2 箇所あり、**インメモリ版だけ文言がずれていた**（「このアダプタが」対「この実装が」）。

**なぜ重複したか。** `PlatformAdapter` は実装ごとに独立して書かれる。共通の土台を持たないのは意図した設計であり（実装を差し替えても振る舞いがぶれないため）、その代償として「どの実装でも同じであるべき断り方」に共通の置き場所が無かった。

例外の**型**は 3 実装とも `TypeError` で揃っており、テストもそれを見ていたため、文言の差はテストをすり抜けていた。

### 4. 問いかけの押しボタン — 7 箇所

**対象**: [`src/features/file/FileDialogHost.tsx`](../src/features/file/FileDialogHost.tsx)

`<button type="button" onClick={() => { onRespond(x); }}>` が 7 回、`fileName === '' ? UNTITLED : fileName` が 2 回書かれていた。`Answer` 部品と `displayName` に寄せた。

**このファイルにはテストが 1 つも無かった。** リファクタリング前後の `renderToStaticMarkup` が全 6 パターンで一致することを一時的な足場で確認したうえで、[`FileDialogHost.test.tsx`](../src/features/file/FileDialogHost.test.tsx)（16 件）を追加している。

固定したのは見た目ではなく**どの押しボタンがどの答えを返すか**である。選択肢と答えの対応が崩れると「破棄」を押して保存される類の事故になり、しかも画面を見ているだけでは気づけない。

> **JSX の空白の畳み込みに注意。** この作業中、復元ダイアログの本文を折り返し直したことで空白が 1 つ消えていた。改行が式（`{...}`）と接する位置では空白が落ち、テキストどうしが改行で並ぶ位置では空白が 1 つ入る。上記の照合で捕まえ、`{' '}` を明示して元に戻した。

### 5. undo と redo — 2 箇所

**対象**: [`src/store/store.ts`](../src/store/store.ts)

取り消しとやり直しは、**どの段を取り出すか**（`takeUndo` / `takeRedo`）と**どちら向きのパッチを当てるか**（逆パッチ / パッチ）しか違わない。同じ手順が 2 度書かれていると、片方だけ直した変更が「やり直しだけ壊れている」形で残る。`applyStep` に統合した。

あわせて、`create()` に渡す動作の集まりをブロック本体（`(set, get) => { ... return {...} }`）に変えている。**差分の大半はこの字下げである**（空白を無視すると 37 行の追加・26 行の削除）。動作は今後 T-19 以降で増え続けるため、私的な補助関数の置き場所を先に用意しておく。

### 6. ウィンドウの取得 — 2 箇所（Rust）

**対象**: [`src-tauri/src/commands.rs`](../src-tauri/src/commands.rs)

`get_webview_window` + `ok_or_else` が `set_window_title` と `close_window` に重複していた。`main_window` に切り出した。

### 手を付けなかったもの

- **`src/features/file/title.ts` と `windowTitle.ts`。** 名前は紛らわしいが、純粋な組み立てと状態への追従（副作用）の分離として正しい。名前だけを理由に動かさない。
- **`src/app/App.tsx`。** T-32（レイアウト）と T-37（メニュー）で置き換わる仮の画面である。捨てるものを整えない。
- **`domain/network/networkIndex.ts` の累積所要時間の積み上げ。** 隣接ペアの形をしているが、先頭要素を別に扱う必要があり（R-06 の検査と始発停留所）、`adjacentPairs` に載せても短くならない。
- **`src-tauri/` の既存の整形差分。** `cargo fmt --check` は `atomic.rs` と `add_recent_file` に差分を報告するが、いずれも本作業の対象外である。CI に Rust の整形確認が無いため既存差分として残っている。

### 検証

| 項目 | 結果 |
| --- | --- |
| `npm run typecheck` | 通過 |
| `npm run lint` | 通過 |
| `npm run format:check` | 通過 |
| `npm run test` | 797 件通過（作業前 769 件 + 新規 28 件） |
| ドメイン層カバレッジ | 100%（閾値 80%） |
| `npm run build:web` | 通過（デスクトップ対象環境込み） |
| `cargo check` / `cargo clippy -- -D warnings` | 通過 |
| `cargo test` | 20 件通過 |
