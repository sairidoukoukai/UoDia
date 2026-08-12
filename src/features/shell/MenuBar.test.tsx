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
let narrowMatches: boolean;
let mediaChange: ((event: MediaQueryListEvent) => void) | null;

function mount(
  actions: CommandActions,
  extra: readonly MenuExtra[] = [],
  checked: Readonly<Partial<Record<string, boolean>>> = {},
): void {
  root = createRoot(container);
  act(() => {
    root.render(<MenuBar actions={actions} extra={extra} checked={checked} />);
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

function compactTrigger(): HTMLButtonElement {
  const found = container.querySelector('.menubar__compact-trigger');
  if (!(found instanceof HTMLButtonElement)) throw new Error('「メニュー」がありません');
  return found;
}

function compactItems(): HTMLButtonElement[] {
  return [
    ...container.querySelectorAll<HTMLButtonElement>('.menubar__compact-panel .menubar__item'),
  ];
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

function flushAnimationFrame(): void {
  act(() => {
    vi.runAllTimers();
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  container = document.createElement('div');
  document.body.append(container);
  narrowMatches = false;
  mediaChange = null;
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query): MediaQueryList =>
      ({
        matches: narrowMatches,
        media: query,
        onchange: null,
        addEventListener: (_type: 'change', listener: (event: MediaQueryListEvent) => void) => {
          mediaChange = listener;
        },
        removeEventListener: (_type: 'change', listener: (event: MediaQueryListEvent) => void) => {
          if (mediaChange === listener) mediaChange = null;
        },
        addListener: () => undefined,
        removeListener: () => undefined,
        dispatchEvent: () => false,
      }) as MediaQueryList,
  );
});

function crossBreakpoint(matches: boolean): void {
  narrowMatches = matches;
  act(() => {
    mediaChange?.({ matches } as MediaQueryListEvent);
  });
}

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
  vi.useRealTimers();
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

describe('狭幅画面のメニュー', () => {
  it('1個のボタンから全区分を開く', () => {
    mount({});
    act(() => {
      compactTrigger().click();
    });

    expect(
      [...container.querySelectorAll('.menubar__compact-heading')].map(
        (heading) => heading.textContent,
      ),
    ).toEqual(MENUS.map((menu) => menu.label));
    expect(compactItems()).toHaveLength(COMMANDS.length);
  });

  it('表の操作と最近使ったファイルを同じ面に並べる', () => {
    mount({}, [
      {
        menu: 'file',
        id: 'recent',
        label: '再履ダイヤ.uodia',
        run: () => undefined,
      },
    ]);
    act(() => {
      compactTrigger().click();
    });

    const labels = compactItems().map((item) => item.querySelector('.menubar__label')?.textContent);
    expect(labels).toContain('新規');
    expect(labels).toContain('再履ダイヤ.uodia');
  });

  it('項目を押すと動きが走り、面が閉じる', () => {
    const save = vi.fn();
    mount({ 'file.save': save });
    act(() => {
      compactTrigger().click();
    });
    const saveItem = compactItems().find(
      (item) => item.querySelector('.menubar__label')?.textContent === '上書き保存',
    );
    act(() => {
      saveItem?.click();
    });

    expect(save).toHaveBeenCalledTimes(1);
    expect(compactItems()).toHaveLength(0);
  });

  it('Escで閉じ、焦点をボタンへ戻す', () => {
    mount({ 'file.new': () => undefined });
    press(compactTrigger(), 'ArrowDown');
    expect(document.activeElement).toBe(compactItems()[0]);

    press(compactItems()[0]!, 'Escape');

    expect(compactItems()).toHaveLength(0);
    expect(document.activeElement).toBe(compactTrigger());
  });

  it('Tabで閉じ、次の操作へ焦点を進める', () => {
    const after = document.createElement('button');
    container.after(after);
    mount({ 'file.new': () => undefined });
    press(compactTrigger(), 'ArrowDown');

    press(compactItems()[0]!, 'Tab');
    flushAnimationFrame();

    expect(compactItems()).toHaveLength(0);
    expect(document.activeElement).toBe(after);
    after.remove();
  });

  it('Shift+Tabで閉じ、ボタンへ焦点を戻す', () => {
    mount({ 'file.new': () => undefined });
    press(compactTrigger(), 'ArrowDown');
    act(() => {
      compactItems()[0]?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }),
      );
      vi.runAllTimers();
    });

    expect(compactItems()).toHaveLength(0);
    expect(document.activeElement).toBe(compactTrigger());
  });

  it('同時に開く面は1個だけにする', () => {
    mount({ 'file.new': () => undefined });
    press(title('ファイル'), 'ArrowDown');
    expect(container.querySelector('[aria-label="file"]')).not.toBeNull();

    act(() => {
      compactTrigger().click();
    });

    expect(container.querySelector('[aria-label="file"]')).toBeNull();
    expect(compactItems().length).toBeGreaterThan(0);
  });

  it('狭幅へ切り替わると開いた面を閉じ、見えるボタンへ焦点を移す', () => {
    mount({ 'file.new': () => undefined });
    press(title('ファイル'), 'ArrowDown');

    crossBreakpoint(true);

    expect(container.querySelector('[aria-label="file"]')).toBeNull();
    expect(document.activeElement).toBe(compactTrigger());
  });

  it('広い幅へ切り替わると先頭の見出しへ焦点を移す', () => {
    narrowMatches = true;
    mount({ 'file.new': () => undefined });
    press(compactTrigger(), 'ArrowDown');

    crossBreakpoint(false);

    expect(compactItems()).toHaveLength(0);
    expect(document.activeElement).toBe(title('ファイル'));
  });

  it('使えない項目と選択中の項目を保つ', () => {
    mount({ 'file.save': null, 'edit.drawTool': () => undefined }, [], { 'edit.drawTool': true });
    act(() => {
      compactTrigger().click();
    });

    const save = compactItems().find(
      (item) => item.querySelector('.menubar__label')?.textContent === '上書き保存',
    );
    const draw = compactItems().find(
      (item) => item.querySelector('.menubar__label')?.textContent === 'スジ作成',
    );
    expect(save?.disabled).toBe(true);
    expect(draw?.getAttribute('role')).toBe('menuitemradio');
    expect(draw?.getAttribute('aria-checked')).toBe('true');
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

/**
 * 印を付ける項目（#144）。
 *
 * ツールバーを畳んだため、**いまどちらの道具を持っているか**を知る場所は
 * メニューとステータスバーだけになった。
 */
describe('印', () => {
  it('**今その状態の項目に印を付ける**（読み上げにも伝わる）', () => {
    mount({ 'edit.selectTool': () => undefined, 'edit.drawTool': () => undefined }, [], {
      'edit.drawTool': true,
    });
    act(() => {
      title('編集').click();
    });

    const draw = items().find(
      (item) => item.querySelector('.menubar__label')?.textContent === 'スジ作成',
    );
    const select = items().find(
      (item) => item.querySelector('.menubar__label')?.textContent === '選択',
    );

    expect(draw?.getAttribute('role')).toBe('menuitemradio');
    expect(draw?.getAttribute('aria-checked')).toBe('true');
    expect(select?.getAttribute('aria-checked')).toBe('false');
  });

  it('**印を付けない項目は `menuitem` のまま**（状態ではなく操作である）', () => {
    mount({ 'edit.copy': () => undefined });
    act(() => {
      title('編集').click();
    });

    const copy = items().find(
      (item) => item.querySelector('.menubar__label')?.textContent === 'コピー',
    );
    expect(copy?.getAttribute('role')).toBe('menuitem');
    expect(copy?.getAttribute('aria-checked')).toBeNull();
  });

  it('作図の道具はメニューから選べる（ツールバーが無い）', () => {
    const setTool = vi.fn();
    mount({ 'edit.drawTool': setTool });
    act(() => {
      title('編集').click();
    });
    const draw = items().find(
      (item) => item.querySelector('.menubar__label')?.textContent === 'スジ作成',
    );
    act(() => {
      draw?.click();
    });

    expect(setTool).toHaveBeenCalledTimes(1);
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
