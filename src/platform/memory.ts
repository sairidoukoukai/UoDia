/**
 * インメモリのプラットフォーム実装。
 *
 * テストと、実装が揃う前の画面開発に使う。ファイル・バックアップ・履歴を
 * すべてメモリ上に持ち、ダイアログの結果はあらかじめ仕込んでおく。
 *
 * **ダイアログの結果を差し替えられるようにしてあるのが要点である。** 「開く」を
 * 取り消したとき・保存先を選んだときの振る舞いは、実装が違っても同じでなければ
 * ならない。それを確かめられる場所がここにしか無い。
 */

import {
  MAX_RECENT_FILES,
  foreignHandleError,
  type CloseHandler,
  type FileHandle,
  type OpenedProject,
  type PlatformAdapter,
  type PlatformCapabilities,
  type RecentFile,
} from './types';

export interface MemoryPlatformOptions {
  /** `loadNetworkDef` が返す内容。 */
  readonly networkDef?: string;
  /** 最初から存在するファイル。名前から内容への対応。 */
  readonly files?: Readonly<Record<string, string>>;
  /** 時刻。履歴の記録に使う。 */
  readonly now?: () => Date;
  /** `loadExportFont` が返すバイト列（T-77）。 */
  readonly exportFont?: Uint8Array;
}

/** インメモリ実装。テストから中身を覗けるように、状態を公開している。 */
export interface MemoryPlatform extends PlatformAdapter {
  readonly kind: 'memory';
  /** 保存されているファイル。 */
  readonly files: Map<string, string>;
  /** 最後に書き戻された `route.json`。書き戻されていなければ `null`。 */
  networkDef: string;
  backup: string | null;
  /** 保存されている設定（T-39）。 */
  settings: string | null;
  /** 次の「開く」で選ばれるファイル名。`null` なら取り消し。 */
  openTarget: string | null;
  /** 次の「名前を付けて保存」で選ばれるファイル名。`null` なら取り消し。 */
  saveAsTarget: string | null;
  /** 書き出されたもの。名前からバイト列への対応（T-74）。 */
  readonly exports: Map<string, Uint8Array>;
  /** PDF に埋めるフォント（T-77）。既定は空——読み込みだけを試すため。 */
  exportFont: Uint8Array;
  /**
   * 次の「書き出し」が保存先を選ばれるか。`false` なら取り消し。
   *
   * 名前ではなく真偽値にしてあるのは、**書き出しがハンドルを返さない**ため
   * である（`PlatformAdapter.saveExport`）。名前は呼び出し側が決める。
   */
  exportAccepted: boolean;
  /** 最後に設定されたウィンドウ題名。 */
  windowTitle: string;
  /** 閉じる操作に割り込んでいる相手。テストから閉じる操作を起こせる。 */
  closeHandler: CloseHandler | null;
}

export function createMemoryPlatform(options: MemoryPlatformOptions = {}): MemoryPlatform {
  const now = options.now ?? ((): Date => new Date());
  const recent: RecentFile[] = [];

  const capabilities: PlatformCapabilities = {
    saveInPlace: true,
    recentFiles: true,
  };

  const platform: MemoryPlatform = {
    kind: 'memory',
    capabilities,
    files: new Map(Object.entries(options.files ?? {})),
    networkDef: options.networkDef ?? '',
    backup: null,
    settings: null,
    openTarget: null,
    saveAsTarget: null,
    exports: new Map(),
    exportAccepted: true,
    exportFont: options.exportFont ?? new Uint8Array(0),
    windowTitle: '',
    closeHandler: null,

    openProject(): Promise<OpenedProject | null> {
      const name = platform.openTarget;
      if (name === null) return Promise.resolve(null);
      const content = platform.files.get(name);
      if (content === undefined) {
        return Promise.reject(new Error(`ファイルがありません: ${name}`));
      }
      return Promise.resolve({ handle: makeHandle(name), content });
    },

    readProject(handle: FileHandle): Promise<string> {
      const name = nameOf(handle);
      if (name === null) return Promise.reject(foreignHandleError(handle));
      const content = platform.files.get(name);
      return content === undefined
        ? Promise.reject(new Error(`ファイルがありません: ${name}`))
        : Promise.resolve(content);
    },

    saveProject(handle: FileHandle, content: string): Promise<void> {
      const name = nameOf(handle);
      if (name === null) return Promise.reject(foreignHandleError(handle));
      platform.files.set(name, content);
      return Promise.resolve();
    },

    saveProjectAs(content: string): Promise<FileHandle | null> {
      const name = platform.saveAsTarget;
      if (name === null) return Promise.resolve(null);
      platform.files.set(name, content);
      return Promise.resolve(makeHandle(name));
    },

    saveExport(content: Uint8Array, suggestedName: string): Promise<boolean> {
      if (!platform.exportAccepted) return Promise.resolve(false);
      platform.exports.set(suggestedName, content);
      return Promise.resolve(true);
    },

    loadExportFont(): Promise<Uint8Array> {
      return Promise.resolve(platform.exportFont);
    },

    loadNetworkDef(): Promise<string> {
      return Promise.resolve(platform.networkDef);
    },

    readSettings(): Promise<string | null> {
      return Promise.resolve(platform.settings);
    },

    writeSettings(content: string): Promise<void> {
      platform.settings = content;
      return Promise.resolve();
    },

    writeBackup(content: string): Promise<void> {
      platform.backup = content;
      return Promise.resolve();
    },

    readBackup(): Promise<string | null> {
      return Promise.resolve(platform.backup);
    },

    clearBackup(): Promise<void> {
      platform.backup = null;
      return Promise.resolve();
    },

    setWindowTitle(title: string): Promise<void> {
      platform.windowTitle = title;
      return Promise.resolve();
    },

    listRecentFiles(): Promise<readonly RecentFile[]> {
      return Promise.resolve([...recent]);
    },

    addRecentFile(handle: FileHandle): Promise<void> {
      const name = nameOf(handle);
      const existing = recent.findIndex((r) => r.handle.name === name);
      if (existing >= 0) recent.splice(existing, 1);
      recent.unshift({ handle, openedAt: now().toISOString() });
      recent.splice(MAX_RECENT_FILES);
      return Promise.resolve();
    },

    onCloseRequested(handler: CloseHandler): () => void {
      platform.closeHandler = handler;
      return () => {
        platform.closeHandler = null;
      };
    },
  };

  return platform;
}

function makeHandle(name: string): FileHandle {
  return { kind: 'memory', name, ref: name };
}

/**
 * ハンドルからファイル名を取り出す。解釈できなければ `null`
 * （呼び出し側が {@link foreignHandleError} で断る）。
 *
 * ここで例外を投げずに `null` を返すのは、呼び出し側が `Promise` を返す約束を
 * しているためである。同期的に投げると `.catch()` で受けられない。
 */
function nameOf(handle: FileHandle): string | null {
  return handle.kind === 'memory' && typeof handle.ref === 'string' ? handle.ref : null;
}
