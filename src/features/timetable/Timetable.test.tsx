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

/** 直前の操作の知らせ（方向タブと同じ行にある）。 */
function message(): string | null {
  return container.querySelector('.timetable__status')?.textContent ?? null;
}

describe('便を作る（T-52、仕様書 §6.1.2）', () => {
  it('**空の列に時刻を打つと便ができる**', () => {
    mount();
    newTrip(8, 0);

    expect(trips()).toEqual([`S3:${String(fromHM(8, 0))}`]);
    expect(columns()).toBe(1);
  });

  it('**打った行の停留所を経由するパターンになる**', () => {
    mount();
    // 吹田方面の既定 S3 は箕面学舎を経由する。工学部前の行（3 行目）に打っても
    // その停留所を通るパターンが選ばれる。
    newTrip(9, 0, 3);

    const trip = selectTrips(useAppStore.getState())[0];
    expect(trip?.patternId).toBe('S3');
    expect(trip?.anchor?.stopId).toBe('4_0');
  });

  it('**取り消すと消える**', () => {
    mount();
    newTrip(8, 0);
    undo();
    expect(trips()).toEqual([]);
  });

  it('打つたびに右へ増える', () => {
    mount();
    newTrip(8, 0);
    newTrip(9, 0);
    expect(trips()).toEqual([`S3:${String(fromHM(8, 0))}`, `S3:${String(fromHM(9, 0))}`]);
  });

  it('**「便を追加」の押しボタンは無い**', () => {
    mount();
    const labels = [...container.querySelectorAll('button')].map((b) => b.textContent.trim());
    expect(labels).not.toContain('便を追加');
    expect(labels).not.toContain('複製');
    expect(labels).not.toContain('ずらす');
    expect(labels).not.toContain('削除');
  });
});

describe('便の削除', () => {
  it('**列見出しの Delete で消え、取り消すと戻る**', () => {
    mount();
    newTrip(8, 0);
    newTrip(9, 0);
    selectColumn(0);

    const button = container.querySelector<HTMLButtonElement>('thead .timetable__column');
    act(() => {
      button?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
    });

    expect(columns()).toBe(1);
    undo();
    expect(columns()).toBe(2);
  });
});

describe('時刻を消す（T-52、仕様書 §6.1.2）', () => {
  it('**升目の Delete で便の時刻が消える**（便は残る）', () => {
    mount();
    newTrip(8, 0);

    const cell = container.querySelector<HTMLElement>('[data-cell="0:0"]');
    act(() => {
      cell?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    act(() => {
      cell?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
    });

    expect(trips()).toEqual(['S3:未']);
    expect(columns()).toBe(1);
  });

  it('取り消すと時刻が戻る', () => {
    mount();
    newTrip(8, 0);
    const cell = container.querySelector<HTMLElement>('[data-cell="0:0"]');
    act(() => {
      cell?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    act(() => {
      cell?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
    });

    undo();
    expect(trips()).toEqual([`S3:${String(fromHM(8, 0))}`]);
  });
});

describe('選んだ便がまとめて動く（T-52、仕様書 §6.1.2）', () => {
  it('**選択中の便が同じ差分だけ動く**（一括シフトの置き換え）', () => {
    mount();
    newTrip(8, 0);
    newTrip(9, 0);

    selectColumn(0);
    selectColumn(1, true);
    // 1 便目に 8:30 と打つ。30 分の差分が両方に効く。
    setTime(0, fromHM(8, 30));

    expect(trips()).toEqual([`S3:${String(fromHM(8, 30))}`, `S3:${String(fromHM(9, 30))}`]);
  });

  it('取り消すと両方とも戻る', () => {
    mount();
    newTrip(8, 0);
    newTrip(9, 0);
    selectColumn(0);
    selectColumn(1, true);
    setTime(0, fromHM(8, 30));

    undo();
    expect(trips()).toEqual([`S3:${String(fromHM(8, 0))}`, `S3:${String(fromHM(9, 0))}`]);
  });

  it('**選んでいない便は動かない**', () => {
    mount();
    newTrip(8, 0);
    newTrip(9, 0);

    selectColumn(0);
    setTime(0, fromHM(8, 30));

    expect(trips()).toEqual([`S3:${String(fromHM(8, 30))}`, `S3:${String(fromHM(9, 0))}`]);
  });

  it('**打った便が選択に無ければ、その便だけが動く**', () => {
    mount();
    newTrip(8, 0);
    newTrip(9, 0);

    selectColumn(1);
    setTime(0, fromHM(8, 30));

    expect(trips()).toEqual([`S3:${String(fromHM(8, 30))}`, `S3:${String(fromHM(9, 0))}`]);
  });

  it('**1 便でも範囲を外れるなら何も動かさない**', () => {
    mount();
    newTrip(8, 0);
    newTrip(47, 0);

    selectColumn(0);
    selectColumn(1, true);
    setTime(0, fromHM(9, 0));

    expect(trips()).toEqual([`S3:${String(fromHM(8, 0))}`, `S3:${String(fromHM(47, 0))}`]);
    expect(message()).toContain('ずらせません');
  });
});

describe('パターンの変更（T-52）', () => {
  /** その列のパターン欄で別のパターンを選ぶ。 */
  function choosePattern(index: number, patternId: string): void {
    const fields = container.querySelectorAll<HTMLSelectElement>('.timetable__pattern');
    const field = fields[index];
    if (field === undefined) throw new Error(`${String(index)} 列目のパターン欄がありません`);
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set?.call(
        field,
        patternId,
      );
      field.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }

  it('**その列のパターンが変わり、取り消すと戻る**', () => {
    mount();
    newTrip(8, 0);
    choosePattern(0, 'S1');

    expect(trips()).toEqual([`S1:${String(fromHM(8, 0))}`]);
    undo();
    expect(trips()).toEqual([`S3:${String(fromHM(8, 0))}`]);
  });

  it('**選択は要らない**（触っている列が対象である）', () => {
    mount();
    newTrip(8, 0);
    newTrip(9, 0);
    choosePattern(1, 'S1');

    expect(trips()).toEqual([`S3:${String(fromHM(8, 0))}`, `S1:${String(fromHM(9, 0))}`]);
  });
});

describe('並べ替え', () => {
  it('**始発時刻の昇順に並び、取り消すと元の並びに戻る**', () => {
    mount();
    newTrip(9, 0);
    newTrip(8, 0);

    press('始発時刻順に並べ替え');
    expect(trips()).toEqual([`S3:${String(fromHM(8, 0))}`, `S3:${String(fromHM(9, 0))}`]);

    undo();
    expect(trips()).toEqual([`S3:${String(fromHM(9, 0))}`, `S3:${String(fromHM(8, 0))}`]);
  });
});

describe('ダイヤ間コピー', () => {
  it('**選んだ便が別のダイヤへ写り、取り消すと戻る**', () => {
    mount(twoServices());
    newTrip(8, 0);
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
    newTrip(8, 0);
    selectColumn(0);
    expect(selectSelectedTripIds(useAppStore.getState())).toHaveLength(1);

    press('豊中方面');
    expect(selectSelectedTripIds(useAppStore.getState())).toHaveLength(0);
  });

  it('**押して切り替えても履歴に載らない**（取り消しは編集に効く。T-38）', () => {
    mount();
    newTrip(8, 0);
    const steps = useAppStore.getState().history.past.length;

    press('豊中方面');

    expect(useAppStore.getState().project?.view.activeDirection).toBe(1);
    expect(useAppStore.getState().history.past).toHaveLength(steps);
  });

  it('**選ばれた便の方向がひとりでに開く**（T-38）', () => {
    mount();
    newTrip(8, 0);
    const tripId = selectTrips(useAppStore.getState())[0]?.tripId;
    if (tripId === undefined) throw new Error('便がありません');

    // 豊中方面を見ているところへ、吹田方面の便が選ばれる（ダイヤグラムや
    // 検証パネルからの選択に当たる）。
    press('豊中方面');
    act(() => {
      useAppStore.getState().selectTrips([tripId]);
    });

    expect(useAppStore.getState().project?.view.activeDirection).toBe(0);
    // 追随して切り替えたときは選択を解かない（解くのは押したときだけ）。
    expect(selectSelectedTripIds(useAppStore.getState())).toEqual([tripId]);
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

/** ダイヤを 2 つ持つプロジェクト。 */
function twoServices(): Project {
  const base = newProject();
  return {
    ...base,
    services: [...base.services, { serviceId: 'saturday', serviceName: '土曜ダイヤ', trips: [] }],
  };
}

/**
 * 空の列に時刻を打って便を作る（T-52、仕様書 §6.1.2）。
 *
 * 打つ先は今ある便の右隣——最初の空の列である。**「便を追加」という操作は
 * もう無い。**
 */
function newTrip(hour: number, minute: number, row = 0): void {
  const column = container.querySelectorAll('thead .timetable__column').length;
  setTime(column, fromHM(hour, minute), row);
}

function formatForInput(time: number): string {
  return `${String(Math.floor(time / 3600))}:${String(Math.floor((time % 3600) / 60)).padStart(2, '0')}`;
}

describe('便番号（T-46、仕様書 §6.1.6）', () => {
  /** 列見出し（便番号）。 */
  function numbers(): (string | null)[] {
    return [...container.querySelectorAll('thead .timetable__column')].map((th) => th.textContent);
  }

  it('**時刻順に番号が詰め直される**', () => {
    mount();
    newTrip(9, 0);
    expect(numbers()).toEqual(['E1']);

    // あとから早い便を足すと、番号が入れ替わる。
    newTrip(8, 0);
    expect(numbers()).toEqual(['E2', 'E1']);
  });

  it('**1 便の時刻を変えても、取り消しはその 1 便で戻る**（採番が履歴に載らない）', () => {
    mount();
    newTrip(9, 0);
    newTrip(8, 0);

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
    newTrip(8, 0);
    typeBlockId(0, 'A');

    expect(selectTrips(useAppStore.getState())[0]?.blockId).toBe('A');
    expect(blockField(0).value).toBe('A');
  });

  it('**1 文字ずつ打っても、取り消しは 1 回で戻る**（仕様書 §6.7）', () => {
    mount();
    newTrip(8, 0);
    typeBlockId(0, 'A');
    typeBlockId(0, 'A1');
    typeBlockId(0, 'A12');

    undo();
    // 便を作ったときに入った番号（§6.1.5）まで戻る。
    expect(selectTrips(useAppStore.getState())[0]?.blockId).toBe('A');
  });

  it('**同じ運用の便が同じ色になり、空欄は色を持たない**', () => {
    mount();
    newTrip(8, 0);
    newTrip(9, 0);
    newTrip(10, 0);
    // 自動では A・B・C が入る。1 便目と 3 便目を同じ運用にし、2 便目は消す。
    typeBlockId(2, 'A');
    typeBlockId(1, '');

    const shadow = (i: number) => blockField(i).parentElement?.style.boxShadow ?? '';
    expect(shadow(0)).toBe(shadow(2));
    expect(shadow(0)).not.toBe('');
    expect(shadow(1)).toBe('');
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

  it('**便ができたとき、継げる運用の番号が入る**', () => {
    mount();
    // 1 便目: 吹田方面 S3（豊中 8:00 → 工学部前 8:40）。運用 A を人が付ける。
    newTrip(8, 0);
    fill('1便の運用番号', 'A');

    // 2 便目: 豊中方面 T3（工学部前 8:50 発）。工学部前で A に継げる。
    toToyonaka();
    newTrip(8, 50, ORIGIN_ROW_WESTBOUND);

    expect(blockIds()).toEqual(['A', 'A']);
  });

  it('**継げる運用が無ければ新しい運用番号が入る**（#87）', () => {
    mount();
    newTrip(8, 0);

    // 同じ方向の後続便。豊中学舎発であり、工学部前で終わる A には継げない。
    newTrip(9, 0);

    expect(blockIds()).toEqual(['A', 'B']);
  });

  it('**白紙のプロジェクトでも運用番号が付く**（#87 の症状 1）', () => {
    mount();
    newTrip(8, 0);
    expect(blockIds()).toEqual(['A']);
  });

  it('**時刻を打ち直しても、消した運用番号は書き戻さない**', () => {
    mount();
    newTrip(8, 0);
    fill('1便の運用番号', 'A');

    toToyonaka();
    newTrip(8, 50, ORIGIN_ROW_WESTBOUND);
    expect(blockIds()).toEqual(['A', 'A']);

    // 利用者が消してから、時刻を入れ直す。
    fill('1便の運用番号', '');
    setTime(0, fromHM(9, 0), ORIGIN_ROW_WESTBOUND);
    expect(blockIds()).toEqual(['A', '']);
  });

  it('**便を作るのは 1 回の取り消しで戻る**（提案も一緒に消える）', () => {
    mount();
    newTrip(8, 0);
    fill('1便の運用番号', 'A');

    toToyonaka();
    newTrip(8, 50, ORIGIN_ROW_WESTBOUND);
    expect(blockIds()).toEqual(['A', 'A']);

    undo();
    expect(blockIds()).toEqual(['A']);
  });
});

describe('出区・入区（T-51、仕様書 §6.1.7）', () => {
  /** 前運用・後運用の欄を押す。 */
  function toggle(title: string, column = 0): void {
    const buttons = container.querySelectorAll<HTMLElement>(`[aria-label$="の${title}"]`);
    const button = buttons[column];
    if (button === undefined) throw new Error(`${String(column)} 列目の${title}がありません`);
    act(() => {
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
  }

  function linkText(title: string, column = 0): string | null {
    return (
      container.querySelectorAll<HTMLElement>(`[aria-label$="の${title}"]`)[column]?.textContent ??
      null
    );
  }

  /** ダイヤの便を「パターン:出区:入区」で表す。**回送便は保存されない。** */
  function trips(): string[] {
    return selectTrips(useAppStore.getState()).map(
      (trip) => `${trip.patternId}:${String(trip.pullOut)}:${String(trip.pullIn)}`,
    );
  }

  /** 運用番号を付けた便を 1 つ作る。 */
  function addTripAt(hour: number, minute: number, blockId: string): void {
    const column = container.querySelectorAll('.timetable__block').length;
    newTrip(hour, minute);
    fill(`${String(column + 1)}便の運用番号`, blockId);
  }

  it('**押すと出区が付き、車庫発の時刻が出る**', () => {
    mount();
    addTripAt(8, 0, 'A');
    expect(linkText('前運用')).toBe('');

    toggle('前運用');

    // 車庫発は 20 分前（0 分折返し）。便は増えない。
    expect(linkText('前運用')).toBe('7:40');
    expect(trips()).toEqual(['S3:true:false']);
  });

  it('**もう一度押すと外れる**', () => {
    mount();
    addTripAt(8, 0, 'A');
    toggle('前運用');
    toggle('前運用');

    expect(linkText('前運用')).toBe('');
    expect(trips()).toEqual(['S3:false:false']);
  });

  it('**何度押しても回送は増えない**（#87）', () => {
    mount();
    addTripAt(8, 0, 'A');
    toggle('前運用');
    toggle('前運用');
    toggle('前運用');

    expect(linkText('前運用')).toBe('7:40');
    expect(trips()).toEqual(['S3:true:false']);
  });

  it('**取り消しで戻る**', () => {
    mount();
    addTripAt(8, 0, 'A');
    toggle('前運用');
    undo();

    expect(trips()).toEqual(['S3:false:false']);
    expect(linkText('前運用')).toBe('');
  });

  it('入区は終着の 20 分後に車庫へ着く', () => {
    mount();
    addTripAt(8, 0, 'A');
    toggle('後運用');

    // S3 は豊中 8:00 発・工学部前 8:40 着。
    expect(linkText('後運用')).toBe('9:00');
    expect(trips()).toEqual(['S3:false:true']);
  });

  it('**運用番号が空欄でも設定できる**（#87 の症状 1〜3）', () => {
    mount();
    newTrip(8, 0);
    toggle('前運用');

    expect(linkText('前運用')).toBe('7:40');
    expect(trips()).toEqual(['S3:true:false']);
  });

  it('**時刻をずらすと出区も動く**（導出値だから追随する）', () => {
    mount();
    addTripAt(8, 0, 'A');
    toggle('前運用');
    expect(linkText('前運用')).toBe('7:40');

    setTime(0, fromHM(9, 0));
    expect(linkText('前運用')).toBe('8:40');
  });

  it('**便を消すと出区も消える**', () => {
    mount();
    addTripAt(8, 0, 'A');
    toggle('前運用');
    selectColumn(0);

    const button = container.querySelector<HTMLButtonElement>('thead .timetable__column');
    act(() => {
      button?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
    });

    expect(trips()).toEqual([]);
  });

  it('**一度入区してから再び出区する運用を表せる**', () => {
    mount();
    addTripAt(8, 0, 'A'); // 1 便目: 豊中 8:00 → 工学部前 8:40
    addTripAt(14, 0, 'A'); // 2 便目: 豊中 14:00 → 工学部前 14:40

    toggle('後運用', 0); // 8:40 工学部前 → 9:00 車庫
    toggle('前運用', 1); // 13:40 車庫 → 14:00 豊中

    expect(linkText('後運用', 0)).toBe('9:00');
    expect(linkText('前運用', 1)).toBe('13:40');
    // 車庫を経由するため、1 便目の後運用は 2 便目を指さない。
    expect(linkText('前運用', 0)).toBe('');
    expect(linkText('後運用', 1)).toBe('');
  });

  it('回送便は列にならない', () => {
    mount();
    addTripAt(8, 0, 'A');
    toggle('前運用');

    expect(container.querySelectorAll('thead .timetable__column')).toHaveLength(1);
  });
});
