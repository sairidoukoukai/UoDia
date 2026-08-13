/**
 * メニューバー（仕様書§8.1、T-37）。
 *
 * 並ぶ項目も鍵の綴りも`commands.ts`の表から作る。メニューは表を2種類の幅へ
 * 映したものであり、操作の定義は増やさない。
 *
 * ## キーボードだけで辿れる（§9.4）
 *
 * <kbd>Tab</kbd>で見出しへ、<kbd>Enter</kbd>か<kbd>↓</kbd>で開き、
 * <kbd>↑</kbd><kbd>↓</kbd>で項目を選ぶ。広い画面では<kbd>←</kbd><kbd>→</kbd>で
 * 隣のメニューへ移る。<kbd>Esc</kbd>で閉じ、焦点は開いたボタンへ戻す。
 *
 * ## 使えない項目も出す
 *
 * 動きの無い操作は薄く出す。消すとメニューの並びが状態によって変わり、位置で
 * 覚えられなくなる。
 */

import { useEffect, useRef, useState, type KeyboardEvent, type ReactElement } from 'react';
import {
  COMMANDS,
  MENUS,
  commandsIn,
  formatAccelerator,
  type Command,
  type CommandId,
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
  /** 印を付ける操作（作図の道具・最大化。#144）。 */
  readonly checked?: Readonly<Partial<Record<CommandId, boolean>>>;
}

/** メニューに並ぶ1行。表の操作と、数が動く項目を同じ形にする。 */
interface Item {
  readonly key: string;
  readonly label: string;
  readonly accelerator: string | null;
  readonly enabled: boolean;
  readonly separatorBefore: boolean;
  readonly run: (() => void) | null;
  /** 印を付ける項目なら現在の状態。印を付けない項目では`null`。 */
  readonly checked: boolean | null;
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
      checked: command.checkable === true ? (props.checked?.[command.id] ?? false) : null,
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
      checked: null,
    }));

  return [...fromTable, ...extra];
}

type OpenMenu = MenuId | 'compact' | null;

const NARROW_QUERY = '(max-width: 48rem)';

export function MenuBar(props: MenuBarProps): ReactElement {
  const [open, setOpen] = useState<OpenMenu>(null);
  const compactOpen = open === 'compact';
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

  // 幅の境を跨いだら、隠れるメニューに焦点を残さない。
  useEffect(() => {
    const narrow = window.matchMedia(NARROW_QUERY);
    const onChange = (event: MediaQueryListEvent): void => {
      const bar = barRef.current;
      const focusIsInBar = bar?.contains(document.activeElement) === true;
      if (open === null && !focusIsInBar) return;

      setOpen(null);
      const selector = event.matches
        ? '.menubar__compact-trigger'
        : `[data-menu="${MENUS[0]?.id ?? 'file'}"]`;
      bar?.querySelector<HTMLElement>(selector)?.focus();
    };

    narrow.addEventListener('change', onChange);
    return () => {
      narrow.removeEventListener('change', onChange);
    };
  }, [open]);

  /** 見出しへ焦点を戻す。閉じたあとに続けて操作できるようにする。 */
  const focusTitle = (menu: MenuId): void => {
    barRef.current?.querySelector<HTMLElement>(`[data-menu="${menu}"]`)?.focus();
  };

  const focusCompactTrigger = (): void => {
    barRef.current?.querySelector<HTMLElement>('.menubar__compact-trigger')?.focus();
  };

  /** 隣のメニューへ移る。端では巻き戻す。 */
  const moveTo = (menu: MenuId, step: number): void => {
    const index = MENUS.findIndex((entry) => entry.id === menu);
    const next = MENUS[(index + step + MENUS.length) % MENUS.length];
    if (next === undefined) return;

    setOpen(open === null || open === 'compact' ? null : next.id);
    focusTitle(next.id);
  };

  const close = (menu: MenuId): void => {
    setOpen(null);
    focusTitle(menu);
  };

  const closeCompact = (): void => {
    setOpen(null);
    focusCompactTrigger();
  };

  const leaveMenu = (backwards: boolean): void => {
    setOpen(null);
    requestAnimationFrame(() => {
      if (backwards) {
        focusCompactTrigger();
        return;
      }
      focusAfter(barRef.current);
    });
  };

  return (
    <div className="menubar" role="menubar" aria-label="メニュー" ref={barRef}>
      <button
        type="button"
        role="menuitem"
        className="menubar__compact-trigger"
        aria-haspopup="menu"
        aria-expanded={compactOpen}
        onClick={() => {
          setOpen(compactOpen ? null : 'compact');
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            setOpen('compact');
            return;
          }
          if (event.key === 'Escape' && compactOpen) {
            event.preventDefault();
            setOpen(null);
          }
        }}
      >
        メニュー
        <span className="menubar__compact-mark" aria-hidden="true">
          {compactOpen ? '▲' : '▼'}
        </span>
      </button>

      {compactOpen && <CompactMenu props={props} onClose={closeCompact} onLeave={leaveMenu} />}

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
              if (event.key === 'Escape' && open === menu.id) {
                event.preventDefault();
                setOpen(null);
              }
            }}
            onPointerEnter={() => {
              if (open !== null && open !== 'compact') setOpen(menu.id);
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

  useEffect(() => {
    panelRef.current?.querySelector<HTMLElement>('button:not(:disabled)')?.focus();
  }, []);

  const move = (event: KeyboardEvent<HTMLButtonElement>): void => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      stepFocus(panelRef.current, event.currentTarget, event.key === 'ArrowDown' ? 1 : -1);
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
  };

  return (
    <div className="menubar__panel" role="menu" aria-label={props.menu} ref={panelRef}>
      {props.items.map((item) => (
        <div key={item.key} className={item.separatorBefore ? 'menubar__group' : undefined}>
          <MenuItemButton item={item} onSelect={props.onClose} onKeyDown={move} />
        </div>
      ))}
    </div>
  );
}

interface CompactMenuProps {
  readonly props: MenuBarProps;
  readonly onClose: () => void;
  readonly onLeave: (backwards: boolean) => void;
}

function CompactMenu({ props, onClose, onLeave }: CompactMenuProps): ReactElement {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    panelRef.current?.querySelector<HTMLElement>('button:not(:disabled)')?.focus();
  }, []);

  const move = (event: KeyboardEvent<HTMLButtonElement>): void => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      stepFocus(panelRef.current, event.currentTarget, event.key === 'ArrowDown' ? 1 : -1);
      return;
    }
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      focusEdge(panelRef.current, event.key === 'Home' ? 0 : -1);
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key === 'Tab') {
      event.preventDefault();
      onLeave(event.shiftKey);
    }
  };

  return (
    <div className="menubar__compact-panel" role="menu" aria-label="メニュー" ref={panelRef}>
      {MENUS.map((menu) => {
        const headingId = `menubar-compact-${menu.id}`;
        return (
          <div
            key={menu.id}
            className="menubar__compact-group"
            role="group"
            aria-labelledby={headingId}
          >
            <div id={headingId} className="menubar__compact-heading">
              {menu.label}
            </div>
            {itemsOf(menu.id, props).map((item) => (
              <div key={item.key} className={item.separatorBefore ? 'menubar__group' : undefined}>
                <MenuItemButton item={item} onSelect={onClose} onKeyDown={move} />
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

interface MenuItemButtonProps {
  readonly item: Item;
  readonly onSelect: () => void;
  readonly onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
}

function MenuItemButton({ item, onSelect, onKeyDown }: MenuItemButtonProps): ReactElement {
  return (
    <button
      type="button"
      role={item.checked === null ? 'menuitem' : 'menuitemradio'}
      aria-checked={item.checked ?? undefined}
      className="menubar__item"
      disabled={!item.enabled}
      onClick={() => {
        onSelect();
        item.run?.();
      }}
      onKeyDown={onKeyDown}
    >
      {item.checked !== null && (
        <span className="menubar__check" aria-hidden="true">
          {item.checked ? '●' : ''}
        </span>
      )}
      <span className="menubar__label">{item.label}</span>
      {item.accelerator !== null && <span className="menubar__key">{item.accelerator}</span>}
    </button>
  );
}

function stepFocus(panel: HTMLElement | null, from: HTMLElement, direction: number): void {
  const buttons = [...(panel?.querySelectorAll<HTMLElement>('button:not(:disabled)') ?? [])];
  if (buttons.length === 0) return;
  const index = buttons.indexOf(from);
  const next = buttons[(index + direction + buttons.length) % buttons.length];
  next?.focus();
}

function focusEdge(panel: HTMLElement | null, edge: 0 | -1): void {
  const buttons = [...(panel?.querySelectorAll<HTMLElement>('button:not(:disabled)') ?? [])];
  const target = edge === 0 ? buttons[0] : buttons.at(-1);
  target?.focus();
}

function focusAfter(container: HTMLElement | null): void {
  const focusable = [
    ...document.querySelectorAll<HTMLElement>(
      'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
    ),
  ];
  let lastInside = -1;
  focusable.forEach((element, index) => {
    if (container?.contains(element) === true) lastInside = index;
  });
  focusable
    .slice(lastInside + 1)
    .find((element) => !element.hidden)
    ?.focus();
}
