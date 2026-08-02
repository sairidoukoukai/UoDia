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

/**
 * 別の実装が作ったハンドルを渡されたことを表す例外。
 *
 * 解釈できないハンドルを黙って `name` で代用してはならない。名前が同じだけの
 * 別のファイルを上書きしかねないためである（仕様書 §10.4）。**どの実装でも同じ
 * 型・同じ文で断る**ことにして、呼び出し側が実装ごとの見分け方を持たずに済ま
 * せる。
 */
export function foreignHandleError(handle: FileHandle): TypeError {
  return new TypeError(`この実装が作ったハンドルではありません: ${handle.kind}`);
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
  /** この環境でできること。 */
  readonly capabilities: PlatformCapabilities;

  /** ファイルを選ばせて開く。取り消されたら `null`。 */
  openProject(): Promise<OpenedProject | null>;
  /**
   * 既に分かっているハンドルから読む。最近使ったファイルを開くのに使う。
   *
   * 読めなければ例外を投げる。消された・移動された・権限を失った、のいずれも
   * 利用者に伝えるべき失敗であり、取り消しとは違う。
   */
  readProject(handle: FileHandle): Promise<string>;
  /** 既存のファイルへ上書き保存する。 */
  saveProject(handle: FileHandle, content: string): Promise<void>;
  /** 名前を付けて保存する。取り消されたら `null`。 */
  saveProjectAs(content: string, suggestedName: string): Promise<FileHandle | null>;

  /** `route.json` を読む。 */
  loadNetworkDef(): Promise<string>;
  /**
   * `route.json` を書き戻す。
   *
   * 対応していない環境（{@link PlatformCapabilities.networkDefWritable} が
   * `false`）で呼ぶと例外を投げる。仕様書 §6.5.5。
   */
  saveNetworkDef(content: string): Promise<void>;

  /**
   * 設定を読む。まだ保存していなければ `null`（仕様書 §6.5、T-39）。
   *
   * **プロジェクトとは別に置く。** 設定は「この道具の使い方」であり、開いた
   * ファイルによって変わるものではない。
   */
  readSettings(): Promise<string | null>;
  /** 設定を書く。 */
  writeSettings(content: string): Promise<void>;

  /** 自動バックアップを書く（仕様書 §6.8）。 */
  writeBackup(content: string): Promise<void>;
  /** 自動バックアップを読む。無ければ `null`。 */
  readBackup(): Promise<string | null>;
  /** 自動バックアップを消す。正常終了時に呼ぶ。 */
  clearBackup(): Promise<void>;

  /**
   * ウィンドウ（Web 版はタブ）の題名を変える（仕様書 §6.8）。
   *
   * `document.title` では足りない。デスクトップ版の題名は OS のウィンドウが
   * 持っており、中の文書からは触れないためである。
   */
  setWindowTitle(title: string): Promise<void>;

  /** 最近使ったファイル。新しい順。 */
  listRecentFiles(): Promise<readonly RecentFile[]>;
  /** 最近使ったファイルに加える。既にあれば先頭へ移す。 */
  addRecentFile(handle: FileHandle): Promise<void>;

  /**
   * 閉じる操作に割り込む。
   *
   * @returns 割り込みをやめる関数
   */
  onCloseRequested(handler: CloseHandler): () => void;
}

/**
 * 閉じる操作への割り込み（仕様書 §6.8）。
 *
 * 同期と非同期の 2 つを持たせているのは、**ブラウザが待ってくれない**ためである。
 * `beforeunload` の中で確認ダイアログを出して答えを待つことはできず、
 * 「閉じてよいか」に同期で答えるしかない（その結果、ブラウザ既定の確認が出る）。
 * デスクトップ版は閉じる操作をいったん止められるため、こちらの確認を出せる。
 */
export interface CloseHandler {
  /** 今すぐ閉じてよいか。Web 版はこちらだけを使う。 */
  canCloseNow(): boolean;
  /** 閉じてよいかを尋ねる。デスクトップ版はこちらを使う。 */
  confirmClose(): Promise<boolean>;
}

/** 最近使ったファイルの保持件数（仕様書 §6.8）。 */
export const MAX_RECENT_FILES = 10;

/**
 * その環境で何ができるか（仕様書 §10.4）。
 *
 * 真偽値を並べているのは、**できないことを UI が事前に知る必要がある**ため。
 * 呼んでから失敗するのでは、メニューを出してよいかを判断できず、利用者は
 * 押してから断られることになる。
 *
 * ブラウザの種類ではなく**機能の有無**で表す。「Firefox かどうか」で分岐すると、
 * 対応状況が変わるたびに判定を書き直すことになる。
 */
export interface PlatformCapabilities {
  /**
   * 開いたファイルへ**上書き保存**できるか。
   *
   * `false` の環境（File System Access API 非対応のブラウザ）では、保存は
   * ダウンロードになる。同じ場所へ書き戻すことはできない。
   */
  readonly saveInPlace: boolean;
  /**
   * 最近使ったファイルを保持できるか。
   *
   * ファイルへの参照を永続化できない環境では保持できない。
   */
  readonly recentFiles: boolean;
  /** `route.json` を書き戻せるか（仕様書 §6.5.5）。 */
  readonly networkDefWritable: boolean;
}
