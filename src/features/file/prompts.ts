/**
 * 利用者に尋ねる口（仕様書 §6.8、§7.4.1、§9.2）。
 *
 * 手順を持つ側（`fileService` / `backupService`）と、見た目を持つ側
 * （`dialogs` / `FileDialogHost`）の両方がここを見る。**手順そのものは
 * どの画面でも同じ**であり、React を立ち上げずに確かめられる形にしておきたい。
 *
 * 答えを 1 つの型にまとめているのは、問いを出す仕掛けが 1 つしか無いため
 * である（一度に出す問いは 1 つ。重ねると、どれに答えているのかを利用者が
 * 見失う）。どの問いでどの答えが返るかは、それぞれの口が示す。
 */

import type { ProjectWarning } from '@/domain/io';

/**
 * 問いへの答え。
 *
 * **受け取る側は、想定していない答えを「やめる」として扱うこと。** 問いと
 * 答えの組み合わせが増えたときに、黙って別の動作へ倒れるのを防ぐ。
 */
export type DialogAnswer = 'save' | 'discard' | 'cancel' | 'recover';

export interface FileDialogs {
  /**
   * 未保存の変更があることを伝え、どうするかを尋ねる。
   *
   * 「保存して続ける」(`save`)・「破棄して続ける」(`discard`)・「やめる」
   * (`cancel`) の 3 択とする。2 択にすると、続ける気が無いときにも保存か
   * 破棄かを選ばされる。
   */
  confirmDiscard(fileName: string): Promise<DialogAnswer>;
  /** 読込時の警告を伝える（仕様書 §7.4.1）。 */
  showWarnings(warnings: readonly ProjectWarning[]): Promise<void>;
  /** 失敗を伝える。 */
  showError(message: string): Promise<void>;
}

export interface BackupDialogs {
  /**
   * 前回の編集内容が残っていることを伝え、復元するかを尋ねる。
   *
   * @param fileName 元のファイル名。保存していなかったなら空文字
   * @param savedAt 書き出した時刻（ISO 8601）
   * @returns 復元するなら `true`。**しないと答えたらバックアップは捨てる**
   */
  confirmRecover(fileName: string, savedAt: string): Promise<boolean>;
}
