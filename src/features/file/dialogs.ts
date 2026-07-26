/**
 * ファイル操作の問いかけを画面に繋ぐ（仕様書 §6.8、§7.4.1）。
 *
 * `FileService` は「尋ねて答えを待つ」形で書かれている（`Promise` を返す）。
 * React の画面は「今どの問いを出しているか」という状態で書かれている。この
 * 間を埋める。答えを返す関数を保持しておき、利用者が押したときに解決する。
 *
 * 一度に出す問いは 1 つとする。重ねて出せる形にすると、どれに答えているのかを
 * 利用者が見失う。
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import type { ProjectWarning } from '@/domain/io';
import type { DiscardChoice, FileDialogs } from './fileService';

/** 未保存の変更があることを伝え、どうするかを尋ねる。 */
export interface DiscardRequest {
  readonly kind: 'discard';
  /** 保存先の名前。まだ保存していなければ空文字。 */
  readonly fileName: string;
}

/** 読込時の警告を伝える。 */
export interface WarningsRequest {
  readonly kind: 'warnings';
  readonly warnings: readonly ProjectWarning[];
}

/** 失敗を伝える。 */
export interface ErrorRequest {
  readonly kind: 'error';
  readonly message: string;
}

export type DialogRequest = DiscardRequest | WarningsRequest | ErrorRequest;

export interface FileDialogController {
  /** `FileService` に渡す口。 */
  readonly dialogs: FileDialogs;
  /** 今出すべき問い。無ければ `null`。 */
  readonly request: DialogRequest | null;
  /**
   * 答える。伝えるだけの問い（警告・失敗）では選択は無視される。
   *
   * 閉じられ方が分からないとき（<kbd>Esc</kbd>・背景の押下）は `cancel` を渡す。
   */
  readonly respond: (choice: DiscardChoice) => void;
}

export function useFileDialogs(): FileDialogController {
  const pending = useRef<((choice: DiscardChoice) => void) | null>(null);
  const [request, setRequest] = useState<DialogRequest | null>(null);

  const ask = useCallback(
    (next: DialogRequest) =>
      new Promise<DiscardChoice>((resolve) => {
        // 前の問いが残っていれば取り消し扱いで閉じる。答えを待っている相手を
        // 置き去りにすると、その操作が永久に終わらない。
        pending.current?.('cancel');
        pending.current = resolve;
        setRequest(next);
      }),
    [],
  );

  const respond = useCallback((choice: DiscardChoice) => {
    const resolve = pending.current;
    pending.current = null;
    setRequest(null);
    resolve?.(choice);
  }, []);

  const dialogs = useMemo<FileDialogs>(
    () => ({
      confirmDiscard: (fileName) => ask({ kind: 'discard', fileName }),
      showWarnings: async (warnings) => {
        await ask({ kind: 'warnings', warnings });
      },
      showError: async (message) => {
        await ask({ kind: 'error', message });
      },
    }),
    [ask],
  );

  return { dialogs, request, respond };
}
