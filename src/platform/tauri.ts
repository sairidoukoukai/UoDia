/**
 * デスクトップ版（Tauri）の実装（仕様書 §10.4、§10.3）。
 *
 * ファイルの実体はパス文字列であり、`FileHandle.ref` にそれを入れる。
 * 実際の読み書きは Rust 側のコマンドが行う（`src-tauri/src/commands.rs`）。
 * 保存をアトミックにする必要があり、それは OS のファイルシステムに近い側でしか
 * 正しく書けないためである。
 *
 * このファイルは `@tauri-apps/api` を直接 import してよい**唯一の場所**の 1 つで
 * ある（もう 1 つは Web 版の `web.ts`）。`src/domain` と `src/features` からの
 * 直接呼び出しは ESLint が禁じている。
 */

import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { toBase64 } from './base64';
import { loadBundledFont } from './fonts';
import { loadBundledNetworkDef } from './networkSeed';
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

/** この実装が作るハンドルの識別子。 */
const KIND = 'tauri';

/**
 * Rust 側が「閉じようとしている」と知らせてくるイベント。
 *
 * Rust は閉じる操作を**必ず一度止める**。未保存の変更があるかを知っているのは
 * フロントエンドだけであり、Rust 側で判断できないためである。閉じてよいと
 * 決まったら `close_window` を呼び直す。
 */
const CLOSE_REQUESTED_EVENT = 'uodia://close-requested';

/** Rust 側が返す履歴の 1 件。 */
interface RecentEntry {
  readonly path: string;
  readonly openedAt: string;
}

/**
 * パスからファイル名を取り出す。
 *
 * `/` と `\` の両方を区切りとして扱う。Windows のパスを WSL 上のテストで
 * 扱えるようにするためであり、実行環境の区切り文字に依存させない。
 */
export function basename(path: string): string {
  const separator = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return separator < 0 ? path : path.slice(separator + 1);
}

/** パスからハンドルを作る。 */
export function toHandle(path: string): FileHandle {
  return { kind: KIND, name: basename(path), ref: path };
}

/**
 * ハンドルからパスを取り出す。解釈できなければ `null`
 * （呼び出し側が {@link foreignHandleError} で断る）。
 */
export function toPath(handle: FileHandle): string | null {
  return handle.kind === KIND && typeof handle.ref === 'string' ? handle.ref : null;
}

/** デスクトップ版はすべてを備える。設定ディレクトリへ自由に読み書きできる。 */
const CAPABILITIES: PlatformCapabilities = {
  saveInPlace: true,
  recentFiles: true,
};

export function createTauriPlatform(): PlatformAdapter {
  return {
    kind: KIND,
    capabilities: CAPABILITIES,

    async openProject(): Promise<OpenedProject | null> {
      const path = await invoke<string | null>('open_project_dialog');
      if (path === null) return null;
      const content = await invoke<string>('read_project_file', { path });
      return { handle: toHandle(path), content };
    },

    readProject(handle: FileHandle): Promise<string> {
      const path = toPath(handle);
      if (path === null) return Promise.reject(foreignHandleError(handle));
      return invoke<string>('read_project_file', { path });
    },

    async saveProject(handle: FileHandle, content: string): Promise<void> {
      const path = toPath(handle);
      if (path === null) throw foreignHandleError(handle);
      await invoke('save_project_file', { path, content });
    },

    async saveProjectAs(content: string, suggestedName: string): Promise<FileHandle | null> {
      const path = await invoke<string | null>('save_project_dialog', { suggestedName });
      if (path === null) return null;
      await invoke('save_project_file', { path, content });
      return toHandle(path);
    },

    /**
     * 書き出したものを保存する（仕様書 v2 §5.3）。
     *
     * **base64 にして渡す。** Tauri のコマンド引数は JSON であり、バイト列を
     * そのまま載せられない（`base64.ts`）。書き込みは Rust 側がアトミックに行う
     * ——プロジェクトの保存と同じ扱いにする。
     */
    async saveExport(content: Uint8Array, suggestedName: string): Promise<boolean> {
      const path = await invoke<string | null>('save_export_dialog', { suggestedName });
      if (path === null) return false;
      await invoke('save_export_file', { path, contentBase64: toBase64(content) });
      return true;
    },

    /**
     * PDF に埋めるフォントを読む（T-77）。
     *
     * **Rust を通さない。** フォントは画面の資産として同梱されており
     * （`fonts.ts`）、`route.json` のように設定ディレクトリへ複製する必要が無い
     * ——利用者が書き換えるものではないからである。
     */
    loadExportFont(): Promise<Uint8Array> {
      return loadBundledFont();
    },

    /** 新しい文書を始めるための路線（T-96）。**Web 版と同じ道を通る。** */
    loadNetworkDef(): Promise<string> {
      return loadBundledNetworkDef();
    },

    readSettings(): Promise<string | null> {
      return invoke<string | null>('read_settings');
    },

    async writeSettings(content: string): Promise<void> {
      await invoke('write_settings', { content });
    },

    async writeBackup(content: string): Promise<void> {
      await invoke('write_backup', { content });
    },

    readBackup(): Promise<string | null> {
      return invoke<string | null>('read_backup');
    },

    async clearBackup(): Promise<void> {
      await invoke('clear_backup');
    },

    async setWindowTitle(title: string): Promise<void> {
      await invoke('set_window_title', { title });
    },

    async listRecentFiles(): Promise<readonly RecentFile[]> {
      const entries = await invoke<RecentEntry[]>('list_recent_files');
      // 上限は Rust 側でも守っているが、古い履歴ファイルが残っている場合に
      // 備えて読む側でも切り詰める。
      return entries
        .slice(0, MAX_RECENT_FILES)
        .map((entry) => ({ handle: toHandle(entry.path), openedAt: entry.openedAt }));
    },

    async addRecentFile(handle: FileHandle): Promise<void> {
      const path = toPath(handle);
      if (path === null) throw foreignHandleError(handle);
      await invoke('add_recent_file', { path, openedAt: new Date().toISOString() });
    },

    onCloseRequested(handler: CloseHandler): () => void {
      const listening = listen(CLOSE_REQUESTED_EVENT, () => {
        void (async () => {
          if (await handler.confirmClose()) await invoke('close_window');
        })();
      });

      return () => {
        void listening.then((stop) => {
          stop();
        });
      };
    },
  };
}
