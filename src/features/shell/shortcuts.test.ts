// @vitest-environment jsdom

/**
 * ショートカットの検証（T-37、仕様書 §8.1）。
 *
 * 窓に張った受け口が、押した鍵を**表に照らして**渡された動きに繋ぐところまでを
 * 見る。どの鍵がどの操作かは `commands.test.ts` が確かめている。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { COMMANDS } from './commands';
import { attachShortcuts, isEnabled, isTypingInField, type CommandActions } from './shortcuts';

/** 窓の代わり。張った受け口を呼び出せるようにする。 */
class FakeTarget {
  private readonly listeners = new Set<EventListener>();

  readonly addEventListener = (_type: string, listener: EventListener): void => {
    this.listeners.add(listener);
  };

  readonly removeEventListener = (_type: string, listener: EventListener): void => {
    this.listeners.delete(listener);
  };

  get count(): number {
    return this.listeners.size;
  }

  /** 押された鍵を届ける。既定の動きを止めたかを返す。 */
  press(
    key: string,
    modifiers: Record<string, boolean> = { ctrlKey: true },
    target: EventTarget | null = null,
  ): boolean {
    let prevented = false;
    const event = {
      key,
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      shiftKey: false,
      ...modifiers,
      target,
      preventDefault: () => {
        prevented = true;
      },
    };
    for (const listener of this.listeners) listener(event as unknown as Event);
    return prevented;
  }
}

let target: FakeTarget;
let actions: Record<string, ReturnType<typeof vi.fn>>;
let detach: () => void;

beforeEach(() => {
  target = new FakeTarget();
  actions = {
    'file.save': vi.fn(),
    'file.saveAs': vi.fn(),
    'edit.undo': vi.fn(),
    'edit.copy': vi.fn(),
    'view.maximizeDiagram': vi.fn(),
  };
  detach = attachShortcuts({ actions: actions as CommandActions, target });
});

describe('鍵から動きへ', () => {
  it('表に載っている鍵で、渡された動きが走る', () => {
    target.press('s');
    expect(actions['file.save']).toHaveBeenCalledTimes(1);

    target.press('1');
    expect(actions['view.maximizeDiagram']).toHaveBeenCalledTimes(1);
  });

  it('**Shift を伴えば別の動きになる**（保存と名前を付けて保存）', () => {
    target.press('S', { ctrlKey: true, shiftKey: true });

    expect(actions['file.saveAs']).toHaveBeenCalledTimes(1);
    expect(actions['file.save']).not.toHaveBeenCalled();
  });

  it('既定の動きに渡さない（ブラウザの保存を開かせない）', () => {
    expect(target.press('s')).toBe(true);
  });

  it('関わりのない鍵には触れない', () => {
    expect(target.press('q')).toBe(false);
    expect(target.press('s', { ctrlKey: false })).toBe(false);
  });

  it('**動きの無い操作では既定も止めない**（設定ダイアログはまだ無い）', () => {
    expect(target.press(',')).toBe(false);

    // 「今は使えない」と明示したものも同じ。
    detach();
    detach = attachShortcuts({ actions: { 'edit.undo': null }, target });
    expect(target.press('z')).toBe(false);
  });

  it('繋ぎを解けば効かなくなる', () => {
    detach();
    expect(target.count).toBe(0);

    target.press('s');
    expect(actions['file.save']).not.toHaveBeenCalled();
  });
});

describe('記入欄の中（受入条件）', () => {
  it('**Ctrl+Z は文字の取り消しに渡す**（便の取り消しとして横取りしない）', () => {
    const field = document.createElement('input');

    expect(target.press('z', { ctrlKey: true }, field)).toBe(false);
    expect(actions['edit.undo']).not.toHaveBeenCalled();
  });

  it('写す・貼るも同じ（そこでのコピーは文字のコピー）', () => {
    const field = document.createElement('input');

    target.press('c', { ctrlKey: true }, field);
    expect(actions['edit.copy']).not.toHaveBeenCalled();
  });

  it('**保存や最大化は記入欄の中でも効く**（文字の編集に意味を持たない）', () => {
    const field = document.createElement('input');

    target.press('s', { ctrlKey: true }, field);
    target.press('1', { ctrlKey: true }, field);

    expect(actions['file.save']).toHaveBeenCalledTimes(1);
    expect(actions['view.maximizeDiagram']).toHaveBeenCalledTimes(1);
  });

  it('記入欄かどうかを見分ける', () => {
    expect(isTypingInField(document.createElement('input'))).toBe(true);
    expect(isTypingInField(document.createElement('textarea'))).toBe(true);
    expect(isTypingInField(document.createElement('button'))).toBe(false);
    expect(isTypingInField(null)).toBe(false);
  });
});

describe('使えるかどうか', () => {
  it('動きがあれば使え、無ければ使えない', () => {
    const command = COMMANDS[0];
    if (command === undefined) throw new Error('操作がありません');

    expect(isEnabled(command, { [command.id]: () => undefined })).toBe(true);
    expect(isEnabled(command, { [command.id]: null })).toBe(false);
    expect(isEnabled(command, {})).toBe(false);
  });
});
