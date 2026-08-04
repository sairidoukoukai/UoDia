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

/**
 * 未保存の問いの本文（T-58、仕様書 v1.1 §3.3）。
 *
 * **選択肢ではなく本文がこのあと起きることを言う。** `ensureSaved()` を呼ぶのは
 * 新規作成・開く・最近使ったファイル・終了の 4 つであり、**選択肢に「終了」と
 * 書くと 3 つで嘘になる。**
 *
 * 表にして 1 か所へ置くのは、呼び出し元がそれぞれ文字列を書くと**同じことを
 * 違う言い方で言い始める**ためである。`open` と `openRecent` を分けないのは、
 * **利用者から見て起きることが同じ**であり、言い方を分ける理由が無いため。
 *
 * 型（`DiscardIntent` のようなもの）にしないのは、これが**文言でしかない**
 * からである。手順は 4 か所とも同じであり、分岐させるものが無い。
 */
export const DISCARD_QUESTIONS = {
  close: '保存せずに終了しますか。',
  open: '保存せずに別のファイルを開きますか。',
  new: '保存せずに新規作成しますか。',
} as const;

export interface FileDialogs {
  /**
   * 未保存の変更があることを伝え、保存するかを尋ねる（T-58、仕様書 v1.1 §3.3）。
   *
   * 「保存する」(`save`)・「保存しない」(`discard`)・「キャンセル」(`cancel`)
   * の 3 択とする。2 択にすると、続ける気が無いときにも保存か破棄かを選ばされる。
   *
   * **選択肢はこのあと何が起きるかを言わない。** この問いが決めるのは「保存するか」
   * の 1 点だけであり、そのあと何をするかは呼び出し元が既に決めている。**問いが
   * 決めていないことを選択肢に書くと、4 つの呼び出し元のうち 3 つで嘘になる**
   * （「保存して終了」と出しても、開くときも新規作成のときも終了しない）。
   *
   * @param question このあと何が起きるかを伝える一文。**呼び出し元が渡す。**
   *   選択肢が言わなくなったぶんをここが担う（{@link DISCARD_QUESTIONS}）
   */
  confirmDiscard(fileName: string, question: string): Promise<DialogAnswer>;
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
