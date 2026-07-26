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
  /** `route.json` を書き戻せる環境として振る舞うか。 */
  readonly canSaveNetworkDef?: boolean;
  /** 時刻。履歴の記録に使う。 */
  readonly now?: () => Date;
}

/** インメモリ実装。テストから中身を覗けるように、状態を公開している。 */
export interface MemoryPlatform extends PlatformAdapter {
  readonly kind: 'memory';
  /** 保存されているファイル。 */
  readonly files: Map<string, string>;
  /** 最後に書き戻された `route.json`。書き戻されていなければ `null`。 */
  networkDef: string;
  savedNetworkDef: string | null;
  backup: string | null;
  /** 次の「開く」で選ばれるファイル名。`null` なら取り消し。 */
  openTarget: string | null;
  /** 次の「名前を付けて保存」で選ばれるファイル名。`null` なら取り消し。 */
  saveAsTarget: string | null;
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
    networkDefWritable: options.canSaveNetworkDef ?? true,
  };

  const platform: MemoryPlatform = {
    kind: 'memory',
    capabilities,
    files: new Map(Object.entries(options.files ?? {})),
    networkDef: options.networkDef ?? '',
    savedNetworkDef: null,
    backup: null,
    openTarget: null,
    saveAsTarget: null,
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

    loadNetworkDef(): Promise<string> {
      return Promise.resolve(platform.networkDef);
    },

    saveNetworkDef(content: string): Promise<void> {
      if (!capabilities.networkDefWritable) {
        return Promise.reject(new Error('この環境では route.json を書き戻せません'));
      }
      platform.savedNetworkDef = content;
      platform.networkDef = content;
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
