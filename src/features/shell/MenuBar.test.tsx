// @vitest-environment jsdom

/**
 * メニューバーの検証（T-37、仕様書 §8.1、§9.4）。
 *
 * 受入条件は「**すべての主要機能がキーボードのみで操作できる**」である。ここが
 * 確かめるのは、開く・辿る・選ぶ・閉じるが鍵だけでできること、そして**並ぶ内容
 * が表そのものである**こと（手で書いた一覧を持たない）である。
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { COMMANDS, MENUS, commandsIn, formatAccelerator } from './commands';
import { MenuBar, type MenuExtra } from './MenuBar';
import type { CommandActions } from './shortcuts';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

function mount(actions: CommandActions, extra: readonly MenuExtra[] = []): void {
  root = createRoot(container);
  act(() => {
    root.render(<MenuBar actions={actions} extra={extra} />);
  });
}

/** メニューの見出し。 */
function title(label: string): HTMLButtonElement {
  const found = [...container.querySelectorAll('.menubar__title')].find(
    (button) => button.textContent === label,
  );
  if (!(found instanceof HTMLButtonElement)) throw new Error(`「${label}」がありません`);
  return found;
}

/** 開いているメニューの項目。 */
function items(): HTMLButtonElement[] {
  return [...container.querySelectorAll<HTMLButtonElement>('.menubar__item')];
}

function labels(): (string | null)[] {
  return items().map((item) => item.querySelector('.menubar__label')?.textContent ?? null);
}

function press(element: Element, key: string): void {
  act(() => {
    element.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  });
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
});

describe('並び', () => {
  it('仕様書 §8.1 の 5 つの見出しを出す', () => {
    mount({});
    expect([...container.querySelectorAll('.menubar__title')].map((b) => b.textContent)).toEqual(
      MENUS.map((menu) => menu.label),
    );
  });

  it('**項目も鍵の綴りも表から作る**（手で書いた一覧を持たない）', () => {
    mount({});
    act(() => {
      title('ファイル').click();
    });

    const commands = commandsIn('file', COMMANDS);
    expect(labels()).toEqual(commands.map((command) => command.label));
    expect(items()[0]?.querySelector('.menubar__key')?.textContent).toBe(
      formatAccelerator(commands[0]?.accelerator ?? { key: '' }),
    );
  });

  it('**数の動くものは足せる**（最近使ったファイル）', () => {
    const open = vi.fn();
    mount({}, [{ menu: 'file', id: 'recent', label: '再履ダイヤ.uodia', run: open }]);
    act(() => {
      title('ファイル').click();
    });

    expect(labels()).toContain('再履ダイヤ.uodia');
    act(() => {
      items().at(-1)?.click();
    });
    expect(open).toHaveBeenCalledTimes(1);
  });
});

describe('押す', () => {
  it('項目を押すと動きが走り、メニューが閉じる', () => {
    const save = vi.fn();
    mount({ 'file.save': save });
    act(() => {
      title('ファイル').click();
    });
    act(() => {
      items()[2]?.click();
    });

    expect(save).toHaveBeenCalledTimes(1);
    expect(items()).toHaveLength(0);
  });

  it('**使えない操作は薄く出す**（消すと並びが押すたびに変わる）', () => {
    mount({ 'file.save': null });
    act(() => {
      title('ファイル').click();
    });

    expect(labels()).toContain('上書き保存');
    expect(items()[2]?.disabled).toBe(true);
  });

  it('開いた見出しをもう一度押すと閉じる', () => {
    mount({});
    act(() => {
      title('表示').click();
    });
    expect(items().length).toBeGreaterThan(0);

    act(() => {
      title('表示').click();
    });
    expect(items()).toHaveLength(0);
  });

  it('外を押すと閉じる', () => {
    mount({});
    act(() => {
      title('表示').click();
    });
    act(() => {
      window.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    });

    expect(items()).toHaveLength(0);
  });
});

describe('キーボードだけで辿れる（§9.4）', () => {
  it('**↓ で開き、先頭の使える項目へ焦点が移る**', () => {
    mount({ 'file.new': () => undefined });
    press(title('ファイル'), 'ArrowDown');

    expect(document.activeElement).toBe(items()[0]);
  });

  it('開いた直後の焦点は使える項目に置く（押しても何も起きない場所に置かない）', () => {
    mount({ 'file.new': null, 'file.open': () => undefined });
    press(title('ファイル'), 'ArrowDown');

    expect(document.activeElement).toBe(items()[1]);
  });

  it('↑↓ で項目を辿り、端では巻き戻る', () => {
    mount({ 'view.maximizeDiagram': () => undefined, 'view.resetZoom': () => undefined });
    press(title('表示'), 'ArrowDown');
    const usable = items().filter((item) => !item.disabled);

    press(usable[0]!, 'ArrowDown');
    expect(document.activeElement).toBe(usable[1]);

    press(usable[1]!, 'ArrowUp');
    expect(document.activeElement).toBe(usable[0]);

    press(usable[0]!, 'ArrowUp');
    expect(document.activeElement).toBe(usable.at(-1));
  });

  it('**→← で隣のメニューへ移る**（項目の上からでも）', () => {
    mount({ 'file.new': () => undefined });
    press(title('ファイル'), 'ArrowDown');
    press(items()[0]!, 'ArrowRight');

    expect(document.activeElement).toBe(title('編集'));
    expect(container.querySelector('[aria-label="edit"]')).not.toBeNull();
  });

  it('端まで来たら巻き戻る', () => {
    mount({});
    press(title('ファイル'), 'ArrowLeft');
    expect(document.activeElement).toBe(title('ヘルプ'));
  });

  it('**Esc で閉じ、焦点は見出しへ戻る**（続けて操作できる）', () => {
    mount({ 'file.new': () => undefined });
    press(title('ファイル'), 'ArrowDown');
    press(items()[0]!, 'Escape');

    expect(items()).toHaveLength(0);
    expect(document.activeElement).toBe(title('ファイル'));
  });

  it('Tab でも閉じる（メニューが開いたまま先へ進まない）', () => {
    mount({ 'file.new': () => undefined });
    press(title('ファイル'), 'ArrowDown');
    press(items()[0]!, 'Tab');

    expect(items()).toHaveLength(0);
  });
});
