/**
 * メニューバー（仕様書 §8.1、T-37）。
 *
 * 並ぶ項目も鍵の綴りも `commands.ts` の表から作る。**メニューは表の見え方で
 * あって、別の定義ではない。**
 *
 * ## キーボードだけで辿れる（§9.4）
 *
 * <kbd>Tab</kbd> で見出しへ、<kbd>Enter</kbd> か <kbd>↓</kbd> で開き、
 * <kbd>↑</kbd><kbd>↓</kbd> で項目を選び、<kbd>←</kbd><kbd>→</kbd> で隣の
 * メニューへ移る。<kbd>Esc</kbd> で閉じ、**焦点は開いた見出しへ戻す**——閉じた
 * 拍子に焦点が画面の先頭へ飛ぶと、続けて操作できない。
 *
 * ## 使えない項目も出す
 *
 * 動きの無い操作（設定ダイアログはまだ無い、取り消せるものが無い）は、隠さずに
 * **薄く出す**。消してしまうと、メニューの並びが押すたびに変わり、位置で覚え
 * られなくなる。
 */

import { useEffect, useRef, useState, type ReactElement } from 'react';
import {
  COMMANDS,
  MENUS,
  commandsIn,
  formatAccelerator,
  type Command,
  type MenuId,
} from './commands';
import { isEnabled, type CommandActions } from './shortcuts';

/** 表に持てない項目（最近使ったファイルなど、数が動くもの）。 */
export interface MenuExtra {
  readonly menu: MenuId;
  readonly id: string;
  readonly label: string;
  readonly run: () => void;
  readonly separatorBefore?: boolean;
}

export interface MenuBarProps {
  readonly actions: CommandActions;
  readonly extra?: readonly MenuExtra[];
}

/** メニューに並ぶ 1 行（表の操作と、表に持てない項目を同じ形にする）。 */
interface Item {
  readonly key: string;
  readonly label: string;
  readonly accelerator: string | null;
  readonly enabled: boolean;
  readonly separatorBefore: boolean;
  readonly run: (() => void) | null;
}

function itemsOf(menu: MenuId, props: MenuBarProps): readonly Item[] {
  const fromTable = commandsIn(menu, COMMANDS).map((command: Command): Item => {
    const run = props.actions[command.id];
    return {
      key: command.id,
      label: command.label,
      accelerator:
        command.accelerator === undefined ? null : formatAccelerator(command.accelerator),
      enabled: isEnabled(command, props.actions),
      separatorBefore: command.separatorBefore === true,
      run: run ?? null,
    };
  });

  const extra = (props.extra ?? [])
    .filter((item) => item.menu === menu)
    .map((item, index): Item => ({
      key: `extra:${item.id}`,
      label: item.label,
      accelerator: null,
      enabled: true,
      separatorBefore: item.separatorBefore ?? index === 0,
      run: item.run,
    }));

  return [...fromTable, ...extra];
}

export function MenuBar(props: MenuBarProps): ReactElement {
  const [open, setOpen] = useState<MenuId | null>(null);
  const barRef = useRef<HTMLDivElement>(null);

  // 外を押したら閉じる。押した先の操作はそのまま通す。
  useEffect(() => {
    if (open === null) return;

    const onPointerDown = (event: Event): void => {
      const target = event.target instanceof Node ? event.target : null;
      if (target !== null && barRef.current?.contains(target) === true) return;
      setOpen(null);
    };
    window.addEventListener('pointerdown', onPointerDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open]);

  /** 見出しへ焦点を戻す。閉じたあとに続けて操作できるようにする。 */
  const focusTitle = (menu: MenuId): void => {
    barRef.current?.querySelector<HTMLElement>(`[data-menu="${menu}"]`)?.focus();
  };

  /** 隣のメニューへ移る。端では巻き戻す。 */
  const moveTo = (menu: MenuId, step: number): void => {
    const index = MENUS.findIndex((entry) => entry.id === menu);
    const next = MENUS[(index + step + MENUS.length) % MENUS.length];
    if (next === undefined) return;

    setOpen(open === null ? null : next.id);
    focusTitle(next.id);
  };

  const close = (menu: MenuId): void => {
    setOpen(null);
    focusTitle(menu);
  };

  return (
    <div className="menubar" role="menubar" aria-label="メニュー" ref={barRef}>
      {MENUS.map((menu) => (
        <div key={menu.id} className="menubar__menu">
          <button
            type="button"
            role="menuitem"
            data-menu={menu.id}
            className="menubar__title"
            aria-haspopup="menu"
            aria-expanded={open === menu.id}
            onClick={() => {
              setOpen(open === menu.id ? null : menu.id);
            }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault();
                setOpen(menu.id);
                return;
              }
              if (event.key === 'ArrowRight') {
                event.preventDefault();
                moveTo(menu.id, 1);
                return;
              }
              if (event.key === 'ArrowLeft') {
                event.preventDefault();
                moveTo(menu.id, -1);
                return;
              }
              if (event.key === 'Escape' && open !== null) {
                event.preventDefault();
                setOpen(null);
              }
            }}
            // 1 つ開いているあいだは、なぞるだけで隣が開く（普通のメニューの動き）。
            onPointerEnter={() => {
              if (open !== null) setOpen(menu.id);
            }}
          >
            {menu.label}
          </button>

          {open === menu.id && (
            <MenuPanel
              menu={menu.id}
              items={itemsOf(menu.id, props)}
              onClose={() => {
                close(menu.id);
              }}
              onMove={(step) => {
                moveTo(menu.id, step);
              }}
            />
          )}
        </div>
      ))}
    </div>
  );
}

interface MenuPanelProps {
  readonly menu: MenuId;
  readonly items: readonly Item[];
  readonly onClose: () => void;
  readonly onMove: (step: number) => void;
}

function MenuPanel(props: MenuPanelProps): ReactElement {
  const panelRef = useRef<HTMLDivElement>(null);

  // 開いたら先頭の**使える**項目へ焦点を移す。使えない項目に置くと、
  // 開いた直後に Enter を押しても何も起きない。
  useEffect(() => {
    panelRef.current?.querySelector<HTMLElement>('button:not(:disabled)')?.focus();
  }, []);

  const step = (from: HTMLElement, direction: number): void => {
    const buttons = [
      ...(panelRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled)') ?? []),
    ];
    const index = buttons.indexOf(from);
    const next = buttons[(index + direction + buttons.length) % buttons.length];
    next?.focus();
  };

  return (
    <div className="menubar__panel" role="menu" aria-label={props.menu} ref={panelRef}>
      {props.items.map((item) => (
        <div key={item.key} className={item.separatorBefore ? 'menubar__group' : undefined}>
          <button
            type="button"
            role="menuitem"
            className="menubar__item"
            disabled={!item.enabled}
            onClick={() => {
              // 先に閉じる。押した先が焦点を取る操作（ダイアログ）でも、
              // メニューが残って重ならない。
              props.onClose();
              item.run?.();
            }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault();
                step(event.currentTarget, event.key === 'ArrowDown' ? 1 : -1);
                return;
              }
              if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
                event.preventDefault();
                props.onMove(event.key === 'ArrowRight' ? 1 : -1);
                return;
              }
              if (event.key === 'Escape' || event.key === 'Tab') {
                event.preventDefault();
                props.onClose();
              }
            }}
          >
            <span className="menubar__label">{item.label}</span>
            {item.accelerator !== null && <span className="menubar__key">{item.accelerator}</span>}
          </button>
        </div>
      ))}
    </div>
  );
}
