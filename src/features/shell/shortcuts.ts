/**
 * キーボードショートカット（仕様書 §8.1、T-37）。
 *
 * **窓に張る。** ショートカットはどこに焦点があっても効くべきものであり、要素
 * ごとに張ると、焦点の位置によって効いたり効かなかったりする。
 *
 * どの鍵がどの操作かは `commands.ts` の表が決める。ここがするのは、押された鍵を
 * その表に照らし、渡された動きを呼ぶことだけである——**メニューと同じ表を読む**
 * ため、片方だけが古くなることが起こらない。
 */

import { matchCommand, type Command, type CommandId } from './commands';

/**
 * 操作に対する動き。
 *
 * `null` は「今は使えない」を表す（取り消せるものが無い、設定ダイアログがまだ
 * 無い、など）。使えないものは**何もせず、既定の動きも止めない**。
 */
export type CommandActions = Readonly<Partial<Record<CommandId, (() => void) | null>>>;

export interface ShortcutOptions {
  readonly actions: CommandActions;
  /** 受け口を張る先。既定は `window`（テストで差し替える）。 */
  readonly target?: Pick<Window, 'addEventListener' | 'removeEventListener'>;
}

/** ショートカットを繋ぐ。返った関数を呼ぶと繋ぎを解く。 */
export function attachShortcuts(options: ShortcutOptions): () => void {
  const target = options.target ?? window;

  const onKeyDown = (event: KeyboardEvent): void => {
    const command = matchCommand(event);
    if (command === null) return;
    if (isTypingInField(event.target) && command.nativeInField === true) return;

    const run = options.actions[command.id];
    if (run === undefined || run === null) return;

    // 既定の動きに渡さない。Ctrl+S でブラウザの保存が開いては困る。
    event.preventDefault();
    run();
  };

  target.addEventListener('keydown', onKeyDown as EventListener);
  return () => {
    target.removeEventListener('keydown', onKeyDown as EventListener);
  };
}

/**
 * 文字を打っている最中か。
 *
 * 記入欄の中では、取り消しも写しも**文字が相手**である（仕様書 §6.1.4、
 * T-37 の受入条件）。表の操作として横取りすると、打ち間違いを 1 文字だけ戻す
 * ことができなくなる。
 */
export function isTypingInField(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
}

/** その操作が今使えるか。 */
export function isEnabled(command: Command, actions: CommandActions): boolean {
  const run = actions[command.id];
  return run !== undefined && run !== null;
}
