/**
 * プラットフォーム抽象化（仕様書 §10.4）。
 *
 * デスクトップ版（Tauri）と Web 版を同一のコードベースから提供するため、環境に
 * よって実装が変わる処理をこのインタフェースに集約する。**`src/domain/` と
 * `src/features/` はこのインタフェースにのみ依存し、Tauri API とブラウザ API を
 * 直接呼ばない。** この境界は ESLint の `no-restricted-imports` / `no-restricted-globals`
 * で機械的に守られる（`eslint.config.js`）。
 *
 * ここに置くのは**環境によって実装が変わるものだけ**である。ファイルの内容を
 * どう解釈するかはドメイン層（`src/domain/io`）の責務であり、アダプタが扱うのは
 * 文字列までとする。そうしておけば、アダプタの実装を差し替えてもデータの解釈が
 * ぶれない。
 */

/**
 * 開いているファイルへの参照。
 *
 * 実体は環境によって違う（Tauri はパス文字列、Web は `FileSystemFileHandle`）。
 * **`ref` を解釈してよいのは、その値を作ったアダプタだけである。** 別の環境の
 * ハンドルを渡されたことに気づけるよう、`kind` で作り主を名乗らせている。
 */
export interface FileHandle {
  /** 実体を作ったアダプタの識別子。例: `tauri` / `web` / `memory` */
  readonly kind: string;
  /** 利用者に見せる名前。ウィンドウタイトルや履歴の表示に使う。 */
  readonly name: string;
  /** アダプタだけが解釈する実体。 */
  readonly ref: unknown;
}

/** 最近使ったファイル（仕様書 §6.8）。 */
export interface RecentFile {
  readonly handle: FileHandle;
  /** 最後に開いた時刻。ISO 8601。 */
  readonly openedAt: string;
}

/** 開いたファイルの中身。 */
export interface OpenedProject {
  readonly handle: FileHandle;
  readonly content: string;
}

/**
 * 環境依存処理の窓口。
 *
 * 「取り消し」を例外ではなく `null` で表す。利用者がダイアログを閉じるのは
 * 正常な操作であり、異常として扱うと呼び出し側が毎回 try/catch を書くことになる。
 * 例外は本当に失敗したとき（読めない・書けない）だけに残す。
 */
export interface PlatformAdapter {
  /** この実装の識別子。作る `FileHandle` の `kind` と一致する。 */
  readonly kind: string;

  /** ファイルを選ばせて開く。取り消されたら `null`。 */
  openProject(): Promise<OpenedProject | null>;
  /** 既存のファイルへ上書き保存する。 */
  saveProject(handle: FileHandle, content: string): Promise<void>;
  /** 名前を付けて保存する。取り消されたら `null`。 */
  saveProjectAs(content: string, suggestedName: string): Promise<FileHandle | null>;

  /** `route.json` を読む。 */
  loadNetworkDef(): Promise<string>;
  /**
   * `route.json` を書き戻す。
   *
   * Web 版では書き戻せないため、対応の有無を {@link canSaveNetworkDef} で問う
   * （仕様書 §6.5.5）。対応していない実装で呼ぶと例外を投げる。
   */
  saveNetworkDef(content: string): Promise<void>;
  /** `route.json` を書き戻せる環境か。 */
  canSaveNetworkDef(): boolean;

  /** 自動バックアップを書く（仕様書 §6.8）。 */
  writeBackup(content: string): Promise<void>;
  /** 自動バックアップを読む。無ければ `null`。 */
  readBackup(): Promise<string | null>;
  /** 自動バックアップを消す。正常終了時に呼ぶ。 */
  clearBackup(): Promise<void>;

  /** 最近使ったファイル。新しい順。 */
  listRecentFiles(): Promise<readonly RecentFile[]>;
  /** 最近使ったファイルに加える。既にあれば先頭へ移す。 */
  addRecentFile(handle: FileHandle): Promise<void>;
}

/** 最近使ったファイルの保持件数（仕様書 §6.8）。 */
export const MAX_RECENT_FILES = 10;
