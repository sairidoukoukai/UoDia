// @vitest-environment jsdom

/**
 * 便の操作をストアごと通す検証（T-21、仕様書 §6.1.4）。
 *
 * 受入条件の「**各操作が Undo で戻る**」は、操作そのものを試すだけでは
 * 確かめられない。純関数（`domain/service/operations.ts`）が正しくても、
 * 画面が履歴に載せ損ねれば戻らない。ここでは本物のストアを繋ぎ、押して、
 * 取り消して、元の並びに戻ることを見る。
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import routeJson from '../../../data/route.json?raw';
import type { Project } from '@/domain/model';
import { createProject } from '@/domain/io';
import { loadNetworkDef, type NetworkIndex } from '@/domain/network';
import { fromHM } from '@/domain/time';
import { selectSelectedTripIds, selectTrips, useAppStore } from '@/store';
import { Timetable } from './Timetable';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const loaded = loadNetworkDef(routeJson);
if (!loaded.ok) throw new Error('route.json を読み込めません');
const network: NetworkIndex = loaded.network;

let container: HTMLDivElement;
let root: Root;

function newProject(): Project {
  return createProject(network, { now: new Date('2026-01-01T00:00:00Z') });
}

function mount(project: Project = newProject()): void {
  useAppStore.getState().setNetworkDef(network.def);
  useAppStore.getState().setProject(project);

  root = createRoot(container);
  act(() => {
    root.render(<Timetable />);
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

function press(label: string): void {
  const found = [...container.querySelectorAll('button')].find(
    (button) => button.textContent.trim() === label,
  );
  if (found === undefined) throw new Error(`「${label}」の押しボタンがありません`);
  act(() => {
    found.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

/** 列見出しを押して便を選ぶ。 */
function selectColumn(index: number, additive = false): void {
  const buttons = container.querySelectorAll<HTMLButtonElement>('thead .timetable__column');
  const button = buttons[index];
  if (button === undefined) throw new Error(`${String(index)} 列目がありません`);
  act(() => {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: additive }));
  });
}

/** `<select>` や `<input>` に値を入れる。React が変化として拾える形で送る。 */
function fill(ariaLabel: string, value: string): void {
  const field = container.querySelector<HTMLInputElement | HTMLSelectElement>(
    `[aria-label="${ariaLabel}"]`,
  );
  if (field === null) throw new Error(`「${ariaLabel}」がありません`);
  act(() => {
    const prototype = field instanceof HTMLInputElement ? HTMLInputElement : HTMLSelectElement;
    Object.getOwnPropertyDescriptor(prototype.prototype, 'value')?.set?.call(field, value);
    field.dispatchEvent(
      new Event(field instanceof HTMLInputElement ? 'input' : 'change', {
        bubbles: true,
      }),
    );
  });
}

function undo(): void {
  act(() => {
    useAppStore.getState().undo();
  });
}

/** 編集中のダイヤの便を、パターンと始発時刻で表す。 */
function trips(): string[] {
  return selectTrips(useAppStore.getState()).map(
    (trip) => `${trip.patternId}:${trip.anchor === null ? '未' : String(trip.anchor.time)}`,
  );
}

/** 表に出ている列の数。 */
function columns(): number {
  return container.querySelectorAll('thead .timetable__column').length;
}

/** 操作列の伝言。 */
function message(): string | null {
  return container.querySelector('.timetable__toolbar-status')?.textContent ?? null;
}

describe('便の追加', () => {
  it('**既定パターンの、時刻の入っていない便が増える**', () => {
    mount();
    press('便を追加');

    expect(trips()).toEqual(['S3:未']);
    expect(columns()).toBe(1);
  });

  it('追加した便が選ばれる（続けて操作できる）', () => {
    mount();
    press('便を追加');
    expect(selectSelectedTripIds(useAppStore.getState())).toHaveLength(1);
  });

  it('**取り消すと消える**', () => {
    mount();
    press('便を追加');
    undo();
    expect(trips()).toEqual([]);
  });
});

describe('便の複製', () => {
  it('**5 分後の便が隣に増える**', () => {
    mount();
    press('便を追加');
    press('複製');

    // 時刻が未入力の便は、未入力のまま複製される。
    expect(trips()).toEqual(['S3:未', 'S3:未']);
  });

  it('時刻の入った便は、指定した分だけずれて複製される', () => {
    mount();
    press('便を追加');
    setTime(0, fromHM(8, 0));
    fill('ずらす分', '30');
    selectColumn(0);
    press('複製');

    expect(trips()).toEqual([`S3:${String(fromHM(8, 0))}`, `S3:${String(fromHM(8, 30))}`]);
  });

  it('取り消すと元の 1 便に戻る', () => {
    mount();
    press('便を追加');
    press('複製');
    undo();
    expect(trips()).toEqual(['S3:未']);
  });

  it('選んでいなければ押せない', () => {
    mount();
    expect(disabled('複製')).toBe(true);
  });
});

describe('便の削除', () => {
  it('選んだ便が消え、取り消すと戻る', () => {
    mount();
    press('便を追加');
    press('便を追加');
    selectColumn(0);
    press('削除');

    expect(columns()).toBe(1);
    undo();
    expect(columns()).toBe(2);
  });

  it('**列見出しの Delete でも消える**', () => {
    mount();
    press('便を追加');
    selectColumn(0);

    const button = container.querySelector<HTMLButtonElement>('thead .timetable__column');
    act(() => {
      button?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
    });
    expect(columns()).toBe(0);
  });
});

describe('一括シフト', () => {
  it('**選んだ便だけが動き、取り消すと戻る**', () => {
    mount();
    press('便を追加');
    setTime(0, fromHM(8, 0));
    press('便を追加');
    setTime(1, fromHM(9, 0));

    selectColumn(0);
    fill('ずらす分', '15');
    press('ずらす');

    expect(trips()).toEqual([`S3:${String(fromHM(8, 15))}`, `S3:${String(fromHM(9, 0))}`]);
    undo();
    expect(trips()).toEqual([`S3:${String(fromHM(8, 0))}`, `S3:${String(fromHM(9, 0))}`]);
  });

  it('**表せる範囲を外れるときは、理由を伝えて何もしない**', () => {
    mount();
    press('便を追加');
    setTime(0, fromHM(47, 0));

    selectColumn(0);
    fill('ずらす分', '30');
    press('ずらす');

    expect(trips()).toEqual([`S3:${String(fromHM(47, 0))}`]);
    expect(message()).toContain('ずらせません');
  });
});

describe('パターンの変更', () => {
  it('**選んだ便のパターンが変わり、取り消すと戻る**', () => {
    mount();
    press('便を追加');
    setTime(0, fromHM(8, 0));
    selectColumn(0);
    fill('停車パターン', 'S1');

    expect(trips()).toEqual([`S1:${String(fromHM(8, 0))}`]);
    undo();
    expect(trips()).toEqual([`S3:${String(fromHM(8, 0))}`]);
  });
});

describe('並べ替え', () => {
  it('**始発時刻の昇順に並び、取り消すと元の並びに戻る**', () => {
    mount();
    press('便を追加');
    setTime(0, fromHM(9, 0));
    press('便を追加');
    setTime(1, fromHM(8, 0));

    press('始発時刻順に並べ替え');
    expect(trips()).toEqual([`S3:${String(fromHM(8, 0))}`, `S3:${String(fromHM(9, 0))}`]);

    undo();
    expect(trips()).toEqual([`S3:${String(fromHM(9, 0))}`, `S3:${String(fromHM(8, 0))}`]);
  });
});

describe('ダイヤ間コピー', () => {
  function twoServices(): Project {
    const base = newProject();
    return {
      ...base,
      services: [...base.services, { serviceId: 'saturday', serviceName: '土曜ダイヤ', trips: [] }],
    };
  }

  it('**選んだ便が別のダイヤへ写り、取り消すと戻る**', () => {
    mount(twoServices());
    press('便を追加');
    setTime(0, fromHM(8, 0));
    selectColumn(0);
    fill('複製先のダイヤ', 'saturday');

    const saturday = useAppStore.getState().project?.services[1];
    expect(saturday?.trips).toHaveLength(1);
    expect(saturday?.trips[0]?.anchor?.time).toBe(fromHM(8, 0));
    // 写し元は変わらない。
    expect(trips()).toEqual([`S3:${String(fromHM(8, 0))}`]);
    expect(message()).toContain('土曜ダイヤ');

    undo();
    expect(useAppStore.getState().project?.services[1]?.trips).toHaveLength(0);
  });

  it('ダイヤが 1 つしかなければ、写し先の選択肢を出さない', () => {
    mount();
    expect(container.querySelector('[aria-label="複製先のダイヤ"]')).toBeNull();
  });
});

describe('方向の切り替え', () => {
  it('**見えなくなる便の選択を解く**', () => {
    mount();
    press('便を追加');
    expect(selectSelectedTripIds(useAppStore.getState())).toHaveLength(1);

    press('豊中方面');
    expect(selectSelectedTripIds(useAppStore.getState())).toHaveLength(0);
  });
});

/**
 * その列の升目に時刻を入れる。行は既定で 0（吹田方面では豊中学舎＝始発）。
 *
 * 豊中方面では行の並びが変わり、0 行目は終着の豊中学舎になる。始発を指したい
 * ときは行を明示する。
 */
function setTime(column: number, time: number, row = 0): void {
  const cell = container.querySelector<HTMLElement>(
    `[data-cell="${String(row)}:${String(column)}"]`,
  );
  if (cell === null) throw new Error(`${String(column)} 列目がありません`);

  act(() => {
    cell.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  });
  act(() => {
    cell.dispatchEvent(new KeyboardEvent('keydown', { key: 'F2', bubbles: true }));
  });
  fill('時刻', formatForInput(time));
  act(() => {
    container
      .querySelector('.timetable__input')
      ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  });
}

function formatForInput(time: number): string {
  return `${String(Math.floor(time / 3600))}:${String(Math.floor((time % 3600) / 60)).padStart(2, '0')}`;
}

/** その押しボタンが押せない状態か。 */
function disabled(label: string): boolean {
  const found = [...container.querySelectorAll('button')].find(
    (button) => button.textContent.trim() === label,
  );
  return found?.disabled ?? false;
}

describe('便番号（T-46、仕様書 §6.1.6）', () => {
  /** 列見出し（便番号）。 */
  function numbers(): (string | null)[] {
    return [...container.querySelectorAll('thead .timetable__column')].map((th) => th.textContent);
  }

  it('**時刻を入れると番号が付き、時刻順に詰め直される**', () => {
    mount();
    press('便を追加');
    expect(numbers()).toEqual(['―']);

    setTime(0, fromHM(9, 0));
    expect(numbers()).toEqual(['E1']);

    // あとから早い便を足すと、番号が入れ替わる。
    press('便を追加');
    setTime(1, fromHM(8, 0));
    expect(numbers()).toEqual(['E2', 'E1']);
  });

  it('**1 便の時刻を変えても、取り消しはその 1 便で戻る**（採番が履歴に載らない）', () => {
    mount();
    press('便を追加');
    setTime(0, fromHM(9, 0));
    press('便を追加');
    setTime(1, fromHM(8, 0));

    const before = selectTrips(useAppStore.getState());
    // 1 便目を 7:00 へ動かすと、番号が入れ替わる。
    setTime(0, fromHM(7, 0));
    expect(numbers()).toEqual(['E1', 'E2']);

    undo();
    const after = selectTrips(useAppStore.getState());
    expect(after[0]?.anchor?.time).toBe(fromHM(9, 0));
    // 動かしていない便は**同じ参照のまま**である。全便を書き換えていない証拠。
    expect(after[1]).toBe(before[1]);
    expect(numbers()).toEqual(['E2', 'E1']);
  });

  it('回送便は営業便と別に数える', () => {
    mount();
    press('便を追加');
    setTime(0, fromHM(8, 0));
    selectColumn(0);
    fill('停車パターン', 'DT-in');

    // 列見出しには回送の印も並ぶ。
    expect(numbers()).toEqual(['D1回送']);
  });
});

describe('運用番号の記入（T-22）', () => {
  /** その列の運用番号欄。 */
  function blockField(index: number): HTMLInputElement {
    const fields = container.querySelectorAll<HTMLInputElement>('.timetable__block');
    const field = fields[index];
    if (field === undefined) throw new Error(`${String(index)} 列目の運用番号欄がありません`);
    return field;
  }

  function typeBlockId(index: number, text: string): void {
    const field = blockField(index);
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(field, text);
      field.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }

  it('**記入した運用番号が便に入る**', () => {
    mount();
    press('便を追加');
    typeBlockId(0, 'A');

    expect(selectTrips(useAppStore.getState())[0]?.blockId).toBe('A');
    expect(blockField(0).value).toBe('A');
  });

  it('**1 文字ずつ打っても、取り消しは 1 回で戻る**（仕様書 §6.7）', () => {
    mount();
    press('便を追加');
    typeBlockId(0, 'A');
    typeBlockId(0, 'A1');
    typeBlockId(0, 'A12');

    undo();
    expect(selectTrips(useAppStore.getState())[0]?.blockId).toBe('');
  });

  it('**同じ運用の便が同じ色になり、空欄は色を持たない**', () => {
    mount();
    press('便を追加');
    press('便を追加');
    press('便を追加');
    typeBlockId(0, 'A');
    typeBlockId(2, 'A');

    const shadow = (i: number) => blockField(i).parentElement?.style.boxShadow ?? '';
    expect(shadow(0)).toBe(shadow(2));
    expect(shadow(0)).not.toBe('');
    expect(shadow(1)).toBe('');
  });

  it('複製した便は運用番号を引き継ぐ（T-21 と繋がる）', () => {
    mount();
    press('便を追加');
    typeBlockId(0, 'A');
    press('複製');

    expect(selectTrips(useAppStore.getState()).map((trip) => trip.blockId)).toEqual(['A', 'A']);
  });
});

describe('運用番号の自動採番（T-23、仕様書 §6.1.5）', () => {
  function blockIds(): (string | undefined)[] {
    return selectTrips(useAppStore.getState()).map((trip) => trip.blockId);
  }

  /** 豊中方面のタブに切り替える。 */
  function toToyonaka(): void {
    press('豊中方面');
  }

  /**
   * 豊中方面の行: 営業所・工学部前・人間科学部前・箕面・豊中（T-48）。
   * 進行方向に並ぶため、始発の工学部前は上から 2 行目にある。
   */
  const ORIGIN_ROW_WESTBOUND = 1;

  it('**初めて時刻を入れたとき、継げる運用の番号が入る**', () => {
    mount();
    // 1 便目: 吹田方面 S3（豊中 8:00 → 工学部前 8:40）。運用 A を人が付ける。
    press('便を追加');
    setTime(0, fromHM(8, 0));
    fill('1便の運用番号', 'A');

    // 2 便目: 豊中方面 T3（工学部前 8:50 発）。工学部前で A に継げる。
    toToyonaka();
    press('便を追加');
    setTime(0, fromHM(8, 50), ORIGIN_ROW_WESTBOUND);

    expect(blockIds()).toEqual(['A', 'A']);
  });

  it('**継げる運用が無ければ空欄のまま**', () => {
    mount();
    press('便を追加');
    setTime(0, fromHM(8, 0));
    fill('1便の運用番号', 'A');

    // 同じ方向の後続便。豊中学舎発であり、工学部前で終わる A には継げない。
    press('便を追加');
    setTime(1, fromHM(9, 0));

    expect(blockIds()).toEqual(['A', '']);
  });

  it('**時刻を打ち直しても、消した運用番号は書き戻さない**', () => {
    mount();
    press('便を追加');
    setTime(0, fromHM(8, 0));
    fill('1便の運用番号', 'A');

    toToyonaka();
    press('便を追加');
    setTime(0, fromHM(8, 50), ORIGIN_ROW_WESTBOUND);
    expect(blockIds()).toEqual(['A', 'A']);

    // 利用者が消してから、時刻を入れ直す。
    fill('1便の運用番号', '');
    setTime(0, fromHM(9, 0), ORIGIN_ROW_WESTBOUND);
    expect(blockIds()).toEqual(['A', '']);
  });

  it('**提案と時刻は 1 回の取り消しでまとめて戻る**', () => {
    mount();
    press('便を追加');
    setTime(0, fromHM(8, 0));
    fill('1便の運用番号', 'A');

    toToyonaka();
    press('便を追加');
    setTime(0, fromHM(8, 50), ORIGIN_ROW_WESTBOUND);

    undo();
    const trips = selectTrips(useAppStore.getState());
    expect(trips[1]?.blockId).toBe('');
    expect(trips[1]?.anchor).toBeNull();
  });
});
