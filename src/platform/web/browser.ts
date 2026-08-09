/**
 * ブラウザ API による [`WebEnvironment`] の実装。
 *
 * このファイルと `idb.ts` が、Web 版でブラウザ API を直接触る唯一の場所である。
 * ここに閉じ込めておけば、対応状況が変わったときに直す先が 1 箇所で済む。
 */

import { openKeyValueStore } from './idb';
import type { FallbackIo, FileSystemAccess, PickedFile, WebEnvironment } from './environment';

/** `.uodia` を選ばせるための指定。 */
const PICKER_TYPES = [
  { description: 'UoDia プロジェクト', accept: { 'application/json': ['.uodia'] } },
];

/** 書き出した zip を選ばせるための指定（T-74）。 */
const EXPORT_TYPES = [{ description: 'zip 書庫', accept: { 'application/zip': ['.zip'] } }];

/** 取り消しを表す例外の名前。ブラウザは取り消しも例外で伝えてくる。 */
const ABORT_ERROR = 'AbortError';

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === ABORT_ERROR;
}

/** File System Access API を使えるか。 */
export function hasFileSystemAccess(): boolean {
  return typeof window !== 'undefined' && 'showOpenFilePicker' in window;
}

/** ブラウザが提供する File System Access API。使えない環境では `null`。 */
export function createFileSystemAccess(): FileSystemAccess | null {
  if (!hasFileSystemAccess()) return null;

  return {
    async open(): Promise<PickedFile | null> {
      try {
        const [handle] = await window.showOpenFilePicker({ types: PICKER_TYPES });
        if (handle === undefined) return null;
        const file = await handle.getFile();
        return { ref: handle, name: handle.name, content: await file.text() };
      } catch (error) {
        if (isAbort(error)) return null;
        throw error;
      }
    },

    async read(ref: unknown): Promise<string> {
      const handle = ref as FileSystemFileHandle;
      // 読むだけでも権限は要る。一覧に出す時点では求めていない（isUsable）ため、
      // 実際に開くこの場で求める。
      const permission = await handle.requestPermission({ mode: 'read' });
      if (permission !== 'granted') {
        throw new Error('ファイルの読み取りが許可されませんでした');
      }
      return (await handle.getFile()).text();
    },

    async save(ref: unknown, content: string): Promise<void> {
      const handle = ref as FileSystemFileHandle;
      // 権限は時間が経つと失われる。書く直前に確かめ、必要なら求め直す。
      // ここを省くと、しばらく編集したあとの保存だけが失敗する。
      const permission = await handle.requestPermission({ mode: 'readwrite' });
      if (permission !== 'granted') {
        throw new Error('ファイルへの書き込みが許可されませんでした');
      }
      const writable = await handle.createWritable();
      await writable.write(content);
      await writable.close();
    },

    async saveAs(
      content: string,
      suggestedName: string,
    ): Promise<{ ref: unknown; name: string } | null> {
      try {
        const handle = await window.showSaveFilePicker({ suggestedName, types: PICKER_TYPES });
        const writable = await handle.createWritable();
        await writable.write(content);
        await writable.close();
        return { ref: handle, name: handle.name };
      } catch (error) {
        if (isAbort(error)) return null;
        throw error;
      }
    },

    async saveBytesAs(bytes: Uint8Array, suggestedName: string): Promise<boolean> {
      try {
        const handle = await window.showSaveFilePicker({ suggestedName, types: EXPORT_TYPES });
        const writable = await handle.createWritable();
        await writable.write(zipBlob(bytes));
        await writable.close();
        return true;
      } catch (error) {
        if (isAbort(error)) return false;
        throw error;
      }
    },

    async isUsable(ref: unknown): Promise<boolean> {
      try {
        const handle = ref as FileSystemFileHandle;
        // 権限を求め直さず、今の状態だけを見る。一覧を出すだけで許可を
        // 求められるのは煩わしい。
        return (await handle.queryPermission({ mode: 'read' })) !== 'denied';
      } catch {
        return false;
      }
    },
  };
}

/** 非対応ブラウザ向けの読み書き。 */
export function createFallbackIo(): FallbackIo {
  return {
    open(): Promise<{ name: string; content: string } | null> {
      return new Promise((resolve, reject) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.uodia,application/json';

        input.addEventListener('change', () => {
          const file = input.files?.[0];
          if (file === undefined) {
            resolve(null);
            return;
          }
          file.text().then(
            (content) => {
              resolve({ name: file.name, content });
            },
            (error: unknown) => {
              reject(error instanceof Error ? error : new Error(String(error)));
            },
          );
        });

        // 取り消しを拾う。change が起きないまま閉じられた場合に、呼び出し側が
        // 待ち続けないようにする。
        input.addEventListener('cancel', () => {
          resolve(null);
        });

        input.click();
      });
    },

    download(content: string, name: string): void {
      save(new Blob([content], { type: 'application/json' }), name);
    },

    downloadBytes(bytes: Uint8Array, name: string): void {
      save(zipBlob(bytes), name);
    },
  };
}

/**
 * バイト列を zip の `Blob` にする。
 *
 * **写してから包む。** `Blob` も `FileSystemWritableFileStream` も
 * `SharedArrayBuffer` に載ったバイト列を受け取らない。型のうえではどちらに
 * 載っているか分からないため、普通の `ArrayBuffer` に載せ替える。写しは
 * 書き出し 1 回につき 1 度だけである。
 */
function zipBlob(bytes: Uint8Array): Blob {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return new Blob([copy], { type: 'application/zip' });
}

/** 中身をダウンロードさせる。 */
function save(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * 同梱の `route.json` を読む。
 *
 * ビルド時にアセットとして出力させ、その URL を取得する。`public/` へ複製する
 * 方式を採らないのは、`data/route.json` を唯一の置き場所に保つためである。
 */
async function loadBundledNetworkDef(): Promise<string> {
  const url = (await import('../../../data/route.json?url')).default;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`route.json を取得できません: ${String(response.status)}`);
  }
  return response.text();
}

/** ブラウザ環境一式を組み立てる。 */
export function createBrowserEnvironment(): WebEnvironment {
  return {
    store: openKeyValueStore(),
    fileSystem: createFileSystemAccess(),
    fallback: createFallbackIo(),
    loadBundledNetworkDef,
    setWindowTitle(title: string): void {
      document.title = title;
    },
    onBeforeUnload(canClose: () => boolean): () => void {
      const listener = (event: BeforeUnloadEvent): void => {
        if (canClose()) return;
        // 文言はブラウザが決める。指定しても無視される。
        event.preventDefault();
      };
      window.addEventListener('beforeunload', listener);
      return () => {
        window.removeEventListener('beforeunload', listener);
      };
    },
  };
}
