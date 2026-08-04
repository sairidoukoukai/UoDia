/**
 * 問いかけを画面に繋ぐ（仕様書 §6.8、§7.4.1、§9.2）。
 *
 * 手順を持つ側は「尋ねて答えを待つ」形で書かれている（`Promise` を返す）。
 * React の画面は「今どの問いを出しているか」という状態で書かれている。この
 * 間を埋める。答えを返す関数を保持しておき、利用者が押したときに解決する。
 *
 * 一度に出す問いは 1 つとする。重ねて出せる形にすると、どれに答えているのかを
 * 利用者が見失う。
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import type { ProjectWarning } from '@/domain/io';
import type { BackupDialogs, DialogAnswer, DiscardQuestion, FileDialogs } from './prompts';

/** 未保存の変更があることを伝え、保存するかを尋ねる。 */
export interface DiscardRequest {
  readonly kind: 'discard';
  /** 保存先の名前。まだ保存していなければ空文字。 */
  readonly fileName: string;
  /** このあと何が起きるかを伝える一文（T-58。`DISCARD_QUESTIONS`）。 */
  readonly question: DiscardQuestion;
}

/** 前回の編集内容が残っていることを伝え、復元するかを尋ねる。 */
export interface RecoverRequest {
  readonly kind: 'recover';
  /** 元のファイル名。保存していなかったなら空文字。 */
  readonly fileName: string;
  /** 書き出した時刻（ISO 8601）。 */
  readonly savedAt: string;
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

export type DialogRequest = DiscardRequest | RecoverRequest | WarningsRequest | ErrorRequest;

export interface FileDialogController {
  /** 手順を持つ側に渡す口。 */
  readonly dialogs: FileDialogs & BackupDialogs;
  /** 今出すべき問い。無ければ `null`。 */
  readonly request: DialogRequest | null;
  /**
   * 答える。伝えるだけの問い（警告・失敗）では選択は無視される。
   *
   * 閉じられ方が分からないとき（<kbd>Esc</kbd>・背景の押下）は `cancel` を渡す。
   */
  readonly respond: (answer: DialogAnswer) => void;
}

export function useFileDialogs(): FileDialogController {
  const pending = useRef<((answer: DialogAnswer) => void) | null>(null);
  const [request, setRequest] = useState<DialogRequest | null>(null);

  const ask = useCallback(
    (next: DialogRequest) =>
      new Promise<DialogAnswer>((resolve) => {
        // 前の問いが残っていれば取り消し扱いで閉じる。答えを待っている相手を
        // 置き去りにすると、その操作が永久に終わらない。
        pending.current?.('cancel');
        pending.current = resolve;
        setRequest(next);
      }),
    [],
  );

  const respond = useCallback((answer: DialogAnswer) => {
    const resolve = pending.current;
    pending.current = null;
    setRequest(null);
    resolve?.(answer);
  }, []);

  const dialogs = useMemo<FileDialogs & BackupDialogs>(
    () => ({
      confirmDiscard: (fileName, question) => ask({ kind: 'discard', fileName, question }),
      confirmRecover: async (fileName, savedAt) =>
        (await ask({ kind: 'recover', fileName, savedAt })) === 'recover',
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
