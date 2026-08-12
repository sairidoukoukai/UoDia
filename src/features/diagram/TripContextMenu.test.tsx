// @vitest-environment jsdom

/**
 * スジの右クリックメニューの検証（T-31、仕様書 §6.3.4）。
 *
 * 受入条件は「**時刻表エディタへジャンプで該当列がスクロール表示される**」で
 * ある。列を画面へ入れるのは選択への追随（T-38）が済ませているため、ここが
 * 確かめるのは**焦点がその列へ移ること**である。
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import routeJson from '../../../data/route.json?raw';
import { createProject } from '@/domain/io';
import type { Project, Trip } from '@/domain/model';
import { loadNetworkDef, type NetworkIndex } from '@/domain/network';
import { fromHM } from '@/domain/time';
import { selectTrips, useAppStore } from '@/store';
import { TripContextMenu } from './TripContextMenu';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const loaded = loadNetworkDef(routeJson);
if (!loaded.ok) throw new Error('route.json を読み込めません');
const network: NetworkIndex = loaded.network;

function makeTrip(tripId: string, patternId: string, hours: number, blockId = 'A'): Trip {
  const pattern = network.patternIndex(patternId);
  if (pattern === undefined) throw new Error(`パターン ${patternId} がありません`);
  return {
    tripId,
    patternId,
    anchor: { stopId: pattern.originStopId, time: fromHM(hours, 0) },
    blockId,
    pullOut: false,
    pullIn: false,
  };
}

function makeProject(trips: readonly Trip[]): Project {
  const project = createProject(network, { now: new Date('2026-01-01T00:00:00Z') });
  const [service] = project.services;
  if (service === undefined) throw new Error('既定のダイヤがありません');
  return { ...project, services: [{ ...service, trips: [...trips] }] };
}

let container: HTMLDivElement;
let root: Root;
let closed = 0;
let keptFocus: boolean | undefined;

function mount(selection: readonly string[] = ['t1']): void {
  useAppStore.getState().setSeedNetworkDef(network.def);
  useAppStore
    .getState()
    .setProject(makeProject([makeTrip('t1', 'S1', 8), makeTrip('t2', 'S1', 9, 'B')]));
  useAppStore.getState().selectTrips(selection);

  root = createRoot(container);
  act(() => {
    root.render(
      <TripContextMenu
        at={{ x: 10, y: 20 }}
        onClose={(options) => {
          closed += 1;
          keptFocus = options?.keepFocus;
        }}
      />,
    );
  });
}

const trips = (): readonly Trip[] => selectTrips(useAppStore.getState());

function press(label: string): void {
  const found = [...container.querySelectorAll('button')].find(
    (button) => button.textContent.trim() === label,
  );
  if (found === undefined) throw new Error(`「${label}」が見つかりません`);
  act(() => {
    found.click();
  });
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  closed = 0;
  keptFocus = undefined;
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
});

describe('項目', () => {
  it('仕様書 §6.3.4 の 5 つを出す', () => {
    mount();
    const text = container.textContent;

    expect(text).toContain('複製');
    expect(text).toContain('削除');
    expect(text).toContain('パターン');
    expect(text).toContain('運用');
    expect(text).toContain('時刻表へジャンプ');
  });

  it('何便に効くのかを出す', () => {
    mount(['t1', 't2']);
    expect(container.textContent).toContain('2 便');
  });
});

describe('複製', () => {
  it('同じ時刻の便が増え、**複製したほうが選ばれる**', () => {
    mount();
    press('複製');

    expect(trips()).toHaveLength(3);
    const added = trips().at(-1);
    expect(added?.anchor).toEqual(trips()[0]?.anchor);
    expect(useAppStore.getState().ui.selectedTripIds).toEqual([added?.tripId]);
    expect(closed).toBe(1);
  });

  it('選んだぶんだけ増える', () => {
    mount(['t1', 't2']);
    press('複製');

    expect(trips()).toHaveLength(4);
  });
});

describe('削除', () => {
  it('選んだ便が消え、選択も解ける', () => {
    mount();
    press('削除');

    expect(trips().map((trip) => trip.tripId)).toEqual(['t2']);
    expect(useAppStore.getState().ui.selectedTripIds).toEqual([]);
  });

  it('**1 回の取り消しで戻る**', () => {
    mount(['t1', 't2']);
    press('削除');
    act(() => {
      useAppStore.getState().undo();
    });

    expect(trips()).toHaveLength(2);
  });
});

describe('パターンの変更', () => {
  it('選んだ便のパターンが変わる', () => {
    mount();
    const select = container.querySelector('select');
    if (select === null) throw new Error('パターンの選択欄がありません');

    act(() => {
      select.value = 'S3';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });

    expect(trips()[0]?.patternId).toBe('S3');
  });

  it('回送は選択肢に出さない（出区・入区でしか作らない）', () => {
    mount();
    const options = [...container.querySelectorAll('option')].map((option) => option.value);

    expect(options).toContain('S1');
    expect(options.some((value) => value.startsWith('D'))).toBe(false);
  });

  it('**まちまちの選択では値を出さない**（開いただけで揃ったように見せない）', () => {
    mount(['t1', 't2']);
    act(() => {
      useAppStore.getState().editProject('パターンを変える', (project) => {
        const trip = project.services[0]?.trips[1];
        if (trip !== undefined) trip.patternId = 'S3';
      });
    });

    expect(container.querySelector('select')?.value).toBe('');
    expect(container.textContent).toContain('まちまち');
  });
});

describe('運用番号', () => {
  it('打った番号が選んだ便に入る', () => {
    mount(['t1', 't2']);
    const input = container.querySelector<HTMLInputElement>('.trip-menu__block');
    if (input === null) throw new Error('運用番号の欄がありません');

    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )?.set?.bind(input);
      setter?.('Z');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });

    expect(trips().map((trip) => trip.blockId)).toEqual(['Z', 'Z']);
  });

  it('揃っていない選択では空欄にする', () => {
    mount(['t1', 't2']);
    expect(container.querySelector<HTMLInputElement>('.trip-menu__block')?.value).toBe('');
  });
});

describe('時刻表へジャンプ', () => {
  it('**該当列へ焦点が移る**（受入条件）', () => {
    mount();

    // 時刻表の列を模した要素を置く。列を画面へ入れるのは T-38 の仕事であり、
    // ここでするのは焦点を移すことだけである。
    const column = document.createElement('th');
    column.dataset.tripId = 't1';
    const button = document.createElement('button');
    button.className = 'timetable__column';
    column.append(button);
    document.body.append(column);

    press('時刻表へジャンプ');

    expect(document.activeElement).toBe(button);
    expect(closed).toBe(1);
    // **閉じる側に「焦点を奪い返すな」と伝える。** 伝えないと、閉じた拍子に
    // ダイヤグラムへ戻され、押した意味が消える（実機で見つけた）。
    expect(keptFocus).toBe(true);
    column.remove();
  });

  it('列が見つからなくても落ちない（消えた便・別のダイヤ）', () => {
    mount();
    expect(() => {
      press('時刻表へジャンプ');
    }).not.toThrow();
  });
});

describe('閉じ方', () => {
  it('ほかの項目では焦点をダイヤグラムへ返す', () => {
    mount();
    press('複製');

    expect(keptFocus).toBeUndefined();
  });

  it('Esc で閉じる', () => {
    mount();
    act(() => {
      container
        .querySelector('.trip-menu')
        ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });

    expect(closed).toBe(1);
  });

  it('外を押すと閉じる', () => {
    mount();
    act(() => {
      window.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    });

    expect(closed).toBe(1);
  });

  it('中を押しても閉じない', () => {
    mount();
    act(() => {
      container
        .querySelector('.trip-menu')
        ?.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    });

    expect(closed).toBe(0);
  });

  it('開いたら先頭の項目に焦点が移る（キーボードで辿れる）', () => {
    mount();
    expect(document.activeElement?.textContent).toBe('複製');
  });
});
