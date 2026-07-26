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
import {
  MAX_RECENT_FILES,
  type FileHandle,
  type OpenedProject,
  type PlatformAdapter,
  type RecentFile,
} from './types';

/** この実装が作るハンドルの識別子。 */
const KIND = 'tauri';

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
 * ハンドルからパスを取り出す。解釈できなければ `null`。
 *
 * 他の環境で作られたハンドルを黙って `name` で代用すると、意図しないファイルを
 * 上書きしかねない（仕様書 §10.4）。
 */
export function toPath(handle: FileHandle): string | null {
  return handle.kind === KIND && typeof handle.ref === 'string' ? handle.ref : null;
}

export function createTauriPlatform(): PlatformAdapter {
  return {
    kind: KIND,

    async openProject(): Promise<OpenedProject | null> {
      const path = await invoke<string | null>('open_project_dialog');
      if (path === null) return null;
      const content = await invoke<string>('read_project_file', { path });
      return { handle: toHandle(path), content };
    },

    async saveProject(handle: FileHandle, content: string): Promise<void> {
      const path = toPath(handle);
      if (path === null) {
        throw new TypeError(`この実装が作ったハンドルではありません: ${handle.kind}`);
      }
      await invoke('save_project_file', { path, content });
    },

    async saveProjectAs(content: string, suggestedName: string): Promise<FileHandle | null> {
      const path = await invoke<string | null>('save_project_dialog', { suggestedName });
      if (path === null) return null;
      await invoke('save_project_file', { path, content });
      return toHandle(path);
    },

    loadNetworkDef(): Promise<string> {
      return invoke<string>('read_route_def');
    },

    async saveNetworkDef(content: string): Promise<void> {
      await invoke('write_route_def', { content });
    },

    canSaveNetworkDef(): boolean {
      // デスクトップ版は設定ディレクトリへ書き戻せる（実装計画書 §3.3）。
      return true;
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
      if (path === null) {
        throw new TypeError(`この実装が作ったハンドルではありません: ${handle.kind}`);
      }
      await invoke('add_recent_file', { path, openedAt: new Date().toISOString() });
    },
  };
}
