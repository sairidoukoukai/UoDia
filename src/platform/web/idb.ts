/**
 * IndexedDB による鍵と値の保存。
 *
 * `localStorage` を使わないのは、**`FileSystemFileHandle` を保存できない**ため
 * である。`localStorage` は文字列しか置けず、ハンドルは構造化複製でしか運べない。
 * 最近使ったファイル（仕様書 §6.8）が成り立たなくなる。
 *
 * 外部ライブラリを入れていないのは、必要なのが 3 つの操作だけだからである。
 */

import type { KeyValueStore } from './environment';

const DATABASE_NAME = 'uodia';
const DATABASE_VERSION = 1;
const STORE_NAME = 'keyValue';

/** `IDBRequest` を待つ。 */
function awaitRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.addEventListener('success', () => {
      resolve(request.result);
    });
    request.addEventListener('error', () => {
      reject(request.error ?? new Error('IndexedDB の操作に失敗しました'));
    });
  });
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);

    request.addEventListener('upgradeneeded', () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
    });
    request.addEventListener('success', () => {
      resolve(request.result);
    });
    request.addEventListener('error', () => {
      reject(request.error ?? new Error('IndexedDB を開けません'));
    });
  });
}

/** 1 回の操作ごとに接続を開いて閉じる。編集のたびに走る処理ではないため。 */
async function withStore<T>(
  mode: IDBTransactionMode,
  operate: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const database = await openDatabase();
  try {
    const store = database.transaction(STORE_NAME, mode).objectStore(STORE_NAME);
    return await awaitRequest(operate(store));
  } finally {
    database.close();
  }
}

export function openKeyValueStore(): KeyValueStore {
  return {
    async get<T>(key: string): Promise<T | null> {
      const value = await withStore<unknown>('readonly', (store) => store.get(key));
      return value === undefined ? null : (value as T);
    },

    async set(key: string, value: unknown): Promise<void> {
      await withStore('readwrite', (store) => store.put(value, key));
    },

    async remove(key: string): Promise<void> {
      await withStore('readwrite', (store) => store.delete(key));
    },
  };
}
