/**
 * Web 版の `PlatformAdapter`（仕様書 §10.4）。
 *
 * ブラウザ API は [`WebEnvironment`] を通してのみ触る。ここに書くのは
 * **どちらの経路でも同じであるべき振る舞い**である。
 *
 * File System Access API がある場合と無い場合で、できることが変わる。それを
 * 実装の中で分岐させて隠すのではなく、[`PlatformCapabilities`] として表に出す。
 * 「保存」を押してからダウンロードが始まるのと、最初からダウンロードだと
 * 分かっているのとでは、利用者にとって別の体験である。
 */

import {
  MAX_RECENT_FILES,
  type FileHandle,
  type OpenedProject,
  type PlatformAdapter,
  type PlatformCapabilities,
  type RecentFile,
} from '../types';
import type { WebEnvironment } from './environment';

/** この実装が作るハンドルの識別子。 */
const KIND = 'web';

/** 保存の仕方。ハンドルに埋め込み、後から経路を取り違えないようにする。 */
type SaveMode = 'inPlace' | 'download';

interface WebRef {
  readonly mode: SaveMode;
  /** `inPlace` のときだけ意味を持つ、環境が返した実体。 */
  readonly ref: unknown;
}

/** `route.json` の編集分を置く鍵。 */
const NETWORK_DEF_KEY = 'networkDef';
/** 自動バックアップの鍵。 */
const BACKUP_KEY = 'backup';
/** 最近使ったファイルの鍵。 */
const RECENT_KEY = 'recentFiles';

/** 保存されている履歴の 1 件。 */
interface StoredRecent {
  readonly ref: unknown;
  readonly name: string;
  readonly openedAt: string;
}

function toHandle(mode: SaveMode, ref: unknown, name: string): FileHandle {
  return { kind: KIND, name, ref: { mode, ref } satisfies WebRef };
}

/** ハンドルから実体を取り出す。解釈できなければ `null`。 */
function toRef(handle: FileHandle): WebRef | null {
  if (handle.kind !== KIND) return null;
  const ref: unknown = handle.ref;
  if (typeof ref !== 'object' || ref === null) return null;
  const { mode } = ref as { mode?: unknown };
  return mode === 'inPlace' || mode === 'download' ? (ref as WebRef) : null;
}

export function createWebPlatform(environment: WebEnvironment): PlatformAdapter {
  const { store, fileSystem, fallback } = environment;

  const capabilities: PlatformCapabilities = {
    // 上書き保存も履歴も File System Access API に依存する。ファイルの場所を
    // 覚えられない環境では、どちらも成り立たない。
    saveInPlace: fileSystem !== null,
    recentFiles: fileSystem !== null,
    // route.json はブラウザから元の場所へ書き戻せない。編集分は手元に保存し、
    // 書き出しは利用者に委ねる（仕様書 §6.5.5）。
    networkDefWritable: false,
  };

  async function readRecent(): Promise<StoredRecent[]> {
    if (fileSystem === null) return [];
    const stored = await store.get<StoredRecent[]>(RECENT_KEY);
    return stored ?? [];
  }

  return {
    kind: KIND,
    capabilities,

    async openProject(): Promise<OpenedProject | null> {
      if (fileSystem !== null) {
        const picked = await fileSystem.open();
        return picked === null
          ? null
          : { handle: toHandle('inPlace', picked.ref, picked.name), content: picked.content };
      }

      const picked = await fallback.open();
      return picked === null
        ? null
        : { handle: toHandle('download', null, picked.name), content: picked.content };
    },

    async saveProject(handle: FileHandle, content: string): Promise<void> {
      const target = toRef(handle);
      if (target === null) {
        throw new TypeError(`この実装が作ったハンドルではありません: ${handle.kind}`);
      }

      // 上書きできない経路では、黙ってダウンロードに倒す。ここで失敗させると
      // 「保存」がまったく効かない環境になってしまう。何が起きるかは
      // capabilities.saveInPlace で事前に伝えている。
      if (target.mode === 'download' || fileSystem === null) {
        fallback.download(content, handle.name);
        return;
      }
      await fileSystem.save(target.ref, content);
    },

    async saveProjectAs(content: string, suggestedName: string): Promise<FileHandle | null> {
      if (fileSystem === null) {
        fallback.download(content, suggestedName);
        // ダウンロードした先をブラウザは教えてくれない。以降の「上書き保存」に
        // 使えるハンドルが作れないため、名前だけを持つものを返す。
        return toHandle('download', null, suggestedName);
      }

      const saved = await fileSystem.saveAs(content, suggestedName);
      return saved === null ? null : toHandle('inPlace', saved.ref, saved.name);
    },

    async loadNetworkDef(): Promise<string> {
      // 編集分があればそれを使う。無ければ同梱のものを読む。
      const edited = await store.get<string>(NETWORK_DEF_KEY);
      return edited ?? (await environment.loadBundledNetworkDef());
    },

    saveNetworkDef(): Promise<void> {
      return Promise.reject(
        new Error('Web 版では route.json を書き戻せません。書き出して差し替えてください'),
      );
    },

    async writeBackup(content: string): Promise<void> {
      await store.set(BACKUP_KEY, content);
    },

    readBackup(): Promise<string | null> {
      return store.get<string>(BACKUP_KEY);
    },

    async clearBackup(): Promise<void> {
      await store.remove(BACKUP_KEY);
    },

    async listRecentFiles(): Promise<readonly RecentFile[]> {
      if (fileSystem === null) return [];

      const stored = await readRecent();
      // 権限を失った参照は落とす。一覧に出しておいて開けないより、出さない方が
      // 分かりやすい。
      const usable = await Promise.all(stored.map((entry) => fileSystem.isUsable(entry.ref)));
      return stored
        .filter((_, index) => usable[index] === true)
        .slice(0, MAX_RECENT_FILES)
        .map((entry) => ({
          handle: toHandle('inPlace', entry.ref, entry.name),
          openedAt: entry.openedAt,
        }));
    },

    async addRecentFile(handle: FileHandle): Promise<void> {
      const target = toRef(handle);
      if (target === null) {
        throw new TypeError(`この実装が作ったハンドルではありません: ${handle.kind}`);
      }
      // 覚えられない環境では黙って何もしない。呼び出し側に環境ごとの分岐を
      // 書かせないため。できないことは capabilities.recentFiles で伝えている。
      if (fileSystem === null || target.mode !== 'inPlace') return;

      const stored = await readRecent();
      const entry: StoredRecent = {
        ref: target.ref,
        name: handle.name,
        openedAt: new Date().toISOString(),
      };
      const next = [entry, ...stored.filter((e) => e.name !== handle.name)].slice(
        0,
        MAX_RECENT_FILES,
      );
      await store.set(RECENT_KEY, next);
    },
  };
}
