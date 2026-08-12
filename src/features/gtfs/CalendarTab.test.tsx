// @vitest-environment jsdom

/**
 * カレンダータブの検証（T-73、仕様書 v2 §4.5）。
 *
 * 計算そのものは `calendarEdits.test.ts` が見る。ここで確かめるのは**操作の
 * 結果**である——**範囲を 1 つ引くのに取り消しが 1 回で済むこと**（§4.5.1）、
 * **押せない日を押しても範囲が増えないこと**、**鍵盤だけで範囲を足せること**
 * （§9.4）。
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import routeJson from '../../../data/route.json?raw';
import { createProject } from '@/domain/io';
import { loadNetworkDef, type NetworkIndex } from '@/domain/network';
import type { ServiceCalendar } from '@/domain/model';
import { useAppStore } from '@/store';
import { CalendarTab } from './CalendarTab';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const loaded = loadNetworkDef(routeJson);
if (!loaded.ok) throw new Error('route.json を読み込めません');
const network: NetworkIndex = loaded.network;

let container: HTMLDivElement;
let root: Root;

const CALENDAR: ServiceCalendar = {
  startDate: '2026-04-01',
  endDate: '2027-03-31',
  weekdays: ['mon', 'tue', 'wed', 'thu', 'fri'],
  closedRanges: [],
};

/** いま画面が見ているダイヤのカレンダー。 */
function calendarNow(): ServiceCalendar | undefined {
  return useAppStore.getState().project?.services[0]?.calendar;
}

/** `null` を渡すと、運行日を持たないダイヤになる。 */
function mount(calendar: ServiceCalendar | null = CALENDAR): void {
  useAppStore.getState().setSeedNetworkDef(network.def);
  useAppStore
    .getState()
    .setProject(createProject(network, { now: new Date('2026-01-01T00:00:00Z') }));
  if (calendar !== null) {
    useAppStore.getState().editProject('運行日を置く', (project) => {
      const [service] = project.services;
      if (service !== undefined) service.calendar = calendar;
    });
  }

  root = createRoot(container);
  act(() => {
    root.render(<CalendarTab today="2026-08-09" />);
  });
}

/** 読み上げ名で押しボタンを引く。 */
function dayButton(date: string): HTMLButtonElement {
  const found = container.querySelector<HTMLButtonElement>(`[aria-label^="${date}"]`);
  if (found === null) throw new Error(`${date} の升目がありません`);
  return found;
}

function button(label: string): HTMLButtonElement {
  const found = [...container.querySelectorAll('button')].find(
    (item) => item.textContent.trim() === label,
  );
  if (found === undefined) throw new Error(`「${label}」がありません`);
  return found;
}

/** 掴んで引いて離す。**離すのは窓で受ける**（実装と同じ経路を通す）。 */
function drag(from: string, to: string): void {
  act(() => {
    dayButton(from).dispatchEvent(new Event('pointerdown', { bubbles: true }));
  });
  act(() => {
    dayButton(to).dispatchEvent(new Event('pointermove', { bubbles: true }));
  });
  act(() => {
    window.dispatchEvent(new Event('pointerup'));
  });
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  // jsdom は PointerEvent を持たないが、React は `on*` を Event で受け取れる。
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
  vi.restoreAllMocks();
});

describe('カレンダーを持たないダイヤ', () => {
  it('**落ちない**', () => {
    mount(null);
    expect(container.textContent).toContain('運行日を持っていません');
  });

  it('作る手立てを置く', () => {
    mount(null);
    act(() => {
      button('運行日を設定する').click();
    });
    expect(calendarNow()?.weekdays).toEqual(['mon', 'tue', 'wed', 'thu', 'fri']);
  });
});

describe('範囲を引く', () => {
  it('**引いた範囲が運行なしになる**', () => {
    mount();
    drag('2026-04-06', '2026-04-08');

    expect(calendarNow()?.closedRanges).toEqual([{ from: '2026-04-06', to: '2026-04-08' }]);
  });

  it('**取り消しが 1 回で済む**（引いている最中は積まない）', () => {
    mount();
    drag('2026-04-06', '2026-04-10');

    act(() => {
      useAppStore.getState().undo();
    });
    expect(calendarNow()?.closedRanges).toEqual([]);
  });

  it('逆向きに引いても同じ範囲になる', () => {
    mount();
    drag('2026-04-08', '2026-04-06');

    expect(calendarNow()?.closedRanges).toEqual([{ from: '2026-04-06', to: '2026-04-08' }]);
  });

  it('**曜日で外れている日は掴めない**（押しても範囲が増えない）', () => {
    mount();
    // 2026-04-04 は土曜。月〜金しか走らないため押せない。**押せないことが
    // 仕掛けである**——`disabled` な押しボタンにはポインタの出来事が届かない。
    expect(dayButton('2026-04-04').disabled).toBe(true);
    expect(dayButton('2026-04-05').disabled).toBe(true);
  });

  it('**表の外で離しても掴んだ状態が残らない**（次に押した日から伸びない）', () => {
    mount();
    // 掴んだまま表の外へ出て、そこで離した。
    act(() => {
      dayButton('2026-04-06').dispatchEvent(new Event('pointerdown', { bubbles: true }));
    });
    act(() => {
      window.dispatchEvent(new Event('pointerup'));
    });
    expect(calendarNow()?.closedRanges).toEqual([{ from: '2026-04-06', to: '2026-04-06' }]);

    // 続けて別の日を押して離す。**前の起点から伸びない。**
    act(() => {
      dayButton('2026-04-08').dispatchEvent(new Event('pointerdown', { bubbles: true }));
    });
    act(() => {
      window.dispatchEvent(new Event('pointerup'));
    });
    expect(calendarNow()?.closedRanges[1]).toEqual({ from: '2026-04-08', to: '2026-04-08' });
  });

  it('**鍵盤だけで範囲を足せる**（§9.4）', () => {
    mount();
    act(() => {
      dayButton('2026-04-06').dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
      );
    });

    expect(calendarNow()?.closedRanges).toEqual([{ from: '2026-04-06', to: '2026-04-06' }]);
  });
});

describe('走る曜日', () => {
  it('外すと走る日が減る', () => {
    mount();
    const monday = container.querySelectorAll<HTMLInputElement>('.gtfs__weekdays input')[0];
    act(() => {
      monday?.click();
    });

    expect(calendarNow()?.weekdays).toEqual(['tue', 'wed', 'thu', 'fri']);
  });

  it('**最後の 1 つは押せない**（保存できないカレンダーを作らせない）', () => {
    mount({ ...CALENDAR, weekdays: ['mon'] });
    const monday = container.querySelectorAll<HTMLInputElement>('.gtfs__weekdays input')[0];

    expect(monday?.disabled).toBe(true);
  });
});

describe('月送り（§4.5.2）', () => {
  it('**有効期間の外へは出ない**', () => {
    mount({ ...CALENDAR, startDate: '2026-04-01', endDate: '2026-04-30' });

    const back = container.querySelector<HTMLButtonElement>('[aria-label="前の月"]');
    const forward = container.querySelector<HTMLButtonElement>('[aria-label="次の月"]');
    expect(back?.disabled).toBe(true);
    expect(forward?.disabled).toBe(true);
  });

  it('期間の中では送れる', () => {
    mount();
    const forward = container.querySelector<HTMLButtonElement>('[aria-label="次の月"]');
    expect(forward?.disabled).toBe(false);

    act(() => {
      forward?.click();
    });
    expect(container.textContent).toContain('2026 年 5 月');
  });
});

describe('運行なしの期間の一覧', () => {
  it('範囲を足せる', () => {
    mount();
    act(() => {
      button('範囲を足す').click();
    });
    expect(calendarNow()?.closedRanges).toHaveLength(1);
  });

  it('消せる', () => {
    mount({ ...CALENDAR, closedRanges: [{ from: '2026-05-01', to: '2026-05-01' }] });
    act(() => {
      button('削除').click();
    });
    expect(calendarNow()?.closedRanges).toEqual([]);
  });

  it('注記を書ける（半年後に自分の入力を読み返すため）', () => {
    mount({ ...CALENDAR, closedRanges: [{ from: '2026-08-06', to: '2026-09-30' }] });
    const note = container.querySelector<HTMLInputElement>('.gtfs__ranges input');
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )?.set?.bind(note);
      setter?.('夏季休業');
      note?.dispatchEvent(new Event('input', { bubbles: true }));
    });

    expect(calendarNow()?.closedRanges[0]?.note).toBe('夏季休業');
  });
});

describe('走る日の数', () => {
  it('画面に出す', () => {
    mount({ ...CALENDAR, startDate: '2026-04-01', endDate: '2026-04-07' });
    // 4/1 水・2 木・3 金・6 月・7 火 の 5 日。
    expect(container.textContent).toContain('走る日は 5 日です');
  });
});
