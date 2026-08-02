/**
 * 操作の表の検証（T-37、仕様書 §8.1）。
 *
 * **表そのものの整合を確かめる。** ここが 1 か所の定義である以上、同じ鍵が
 * 2 つの操作に付いていれば、どちらが走るかは並び順という**書いていない規則**で
 * 決まってしまう。
 */

import { describe, expect, it } from 'vitest';
import {
  COMMANDS,
  MENUS,
  commandsIn,
  formatAccelerator,
  matchCommand,
  type Command,
} from './commands';

/** 押された鍵。修飾を省いて書けるようにする。 */
function key(
  value: string,
  modifiers: Partial<Record<'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey', boolean>> = {},
): Parameters<typeof matchCommand>[0] {
  return {
    key: value,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    ...modifiers,
  };
}

const idOf = (command: Command | null): string | null => command?.id ?? null;

describe('表の整合', () => {
  it('操作 ID が重複しない', () => {
    const ids = COMMANDS.map((command) => command.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('**同じ鍵を 2 つの操作に付けない**（どちらが走るかが並び順で決まってしまう）', () => {
    const keys = COMMANDS.filter((command) => command.accelerator !== undefined).map((command) =>
      formatAccelerator(command.accelerator!),
    );

    expect(new Set(keys).size).toBe(keys.length);
  });

  it('すべての操作がメニューのどれかに属する', () => {
    const menus = new Set(MENUS.map((menu) => menu.id));
    for (const command of COMMANDS) expect(menus.has(command.menu)).toBe(true);
  });

  it('**どのメニューも空にしない**（押しても何も出ない見出しを作らない）', () => {
    for (const menu of MENUS) expect(commandsIn(menu.id).length).toBeGreaterThan(0);
  });

  it('鍵は小文字で書く（比べるときに揃える）', () => {
    for (const command of COMMANDS) {
      const accelerator = command.accelerator;
      if (accelerator === undefined) continue;
      expect(accelerator.key).toBe(accelerator.key.toLowerCase());
    }
  });

  it('**記入欄で横取りしない操作は、文字の編集に意味のあるものだけ**（受入条件）', () => {
    const native = COMMANDS.filter((command) => command.nativeInField === true).map(
      (command) => command.id,
    );

    expect(native).toEqual(['edit.undo', 'edit.redo', 'edit.copy', 'edit.cut', 'edit.paste']);
  });
});

describe('鍵から操作を引く', () => {
  it('仕様書 §8.1 の鍵が引ける', () => {
    expect(idOf(matchCommand(key('n', { ctrlKey: true })))).toBe('file.new');
    expect(idOf(matchCommand(key('o', { ctrlKey: true })))).toBe('file.open');
    expect(idOf(matchCommand(key('s', { ctrlKey: true })))).toBe('file.save');
    expect(idOf(matchCommand(key('z', { ctrlKey: true })))).toBe('edit.undo');
    expect(idOf(matchCommand(key('y', { ctrlKey: true })))).toBe('edit.redo');
    expect(idOf(matchCommand(key('c', { ctrlKey: true })))).toBe('edit.copy');
    expect(idOf(matchCommand(key('1', { ctrlKey: true })))).toBe('view.maximizeDiagram');
    expect(idOf(matchCommand(key('2', { ctrlKey: true })))).toBe('view.maximizeTimetable');
    expect(idOf(matchCommand(key('0', { ctrlKey: true })))).toBe('view.resetZoom');
    expect(idOf(matchCommand(key(',', { ctrlKey: true })))).toBe('settings.open');
  });

  it('**Shift の有無で別の操作になる**（保存と名前を付けて保存）', () => {
    expect(idOf(matchCommand(key('S', { ctrlKey: true, shiftKey: true })))).toBe('file.saveAs');
    expect(idOf(matchCommand(key('s', { ctrlKey: true })))).toBe('file.save');
  });

  it('macOS の Command でも引ける', () => {
    expect(idOf(matchCommand(key('s', { metaKey: true })))).toBe('file.save');
  });

  it('**修飾が足りない・多いときは引かない**（別の操作のつもりの打鍵を横取りしない）', () => {
    expect(matchCommand(key('s'))).toBeNull();
    expect(matchCommand(key('s', { ctrlKey: true, altKey: true }))).toBeNull();
    expect(matchCommand(key('1', { ctrlKey: true, shiftKey: true }))).toBeNull();
  });

  it('鍵の無い操作は引けない', () => {
    expect(matchCommand(key('backupNow', { ctrlKey: true }))).toBeNull();
    expect(matchCommand(key('9', { ctrlKey: true }))).toBeNull();
  });
});

describe('鍵の綴り', () => {
  it('画面に出す形にする', () => {
    expect(formatAccelerator({ key: 's' })).toBe('Ctrl+S');
    expect(formatAccelerator({ key: 's', shift: true })).toBe('Ctrl+Shift+S');
    expect(formatAccelerator({ key: 'd', shift: true, alt: true })).toBe('Ctrl+Shift+Alt+D');
    expect(formatAccelerator({ key: ',' })).toBe('Ctrl+,');
  });
});
