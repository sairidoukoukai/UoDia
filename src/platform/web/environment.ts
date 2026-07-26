/**
 * Web 版が使う環境機能の口（実装計画書 T-14）。
 *
 * ブラウザ API を直接呼ぶ代わりに、この口を通す。**アダプタの振る舞いを
 * ブラウザ抜きで確かめられるようにするため**である。File System Access API も
 * IndexedDB も jsdom には無く、口を設けないと「実際に動かして目で見る」以外の
 * 確かめ方が無くなる。
 *
 * 口の粒度は「1 回の利用者操作」に合わせている。`showOpenFilePicker` のような
 * 生の API をそのまま並べると、権限の確認や読み出しの手順がアダプタ側に漏れる。
 */

/** 鍵と値の保存。既定は IndexedDB。 */
export interface KeyValueStore {
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: unknown): Promise<void>;
  remove(key: string): Promise<void>;
}

/** 開いたファイル。`ref` は環境ごとの実体。 */
export interface PickedFile {
  readonly ref: unknown;
  readonly name: string;
  readonly content: string;
}

/**
 * File System Access API。対応していないブラウザでは用意しない。
 *
 * 取り消しは `null`。権限を拒否された場合は例外を投げる（取り消しとは違い、
 * 利用者に伝えるべき失敗であるため）。
 */
export interface FileSystemAccess {
  open(): Promise<PickedFile | null>;
  /** 既に持っている参照から読み直す。最近使ったファイルを開くのに使う。 */
  read(ref: unknown): Promise<string>;
  /** 開いたファイルへ上書きする。 */
  save(ref: unknown, content: string): Promise<void>;
  /** 保存先を選ばせて書く。 */
  saveAs(content: string, suggestedName: string): Promise<{ ref: unknown; name: string } | null>;
  /** 保存した参照を後から使えるか（権限が残っているか）。 */
  isUsable(ref: unknown): Promise<boolean>;
}

/**
 * File System Access API を持たないブラウザ向けの読み書き。
 *
 * 読込は `<input type="file">`、保存はダウンロード。**上書き保存はできない。**
 * ブラウザがファイルの場所を覚えないためであり、実装で補える種類の制約ではない。
 */
export interface FallbackIo {
  open(): Promise<{ name: string; content: string } | null>;
  download(content: string, name: string): void;
}

/** Web 版が必要とする環境一式。 */
export interface WebEnvironment {
  readonly store: KeyValueStore;
  /** 非対応ブラウザでは `null`。 */
  readonly fileSystem: FileSystemAccess | null;
  readonly fallback: FallbackIo;
  /** 同梱の `route.json` を読む。 */
  loadBundledNetworkDef(): Promise<string>;
  /** タブの題名を変える。 */
  setWindowTitle(title: string): void;
  /**
   * タブを閉じる操作に割り込む。
   *
   * `canClose` が `false` を返すとブラウザ既定の確認が出る。**独自の確認は
   * 出せない。** `beforeunload` は同期で答えることしか許していない。
   */
  onBeforeUnload(canClose: () => boolean): () => void;
}
