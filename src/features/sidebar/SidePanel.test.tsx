// @vitest-environment jsdom

/**
 * サイドパネルをストアごと通す検証（T-33、仕様書 §6.2.4、§6.4）。
 *
 * 受入条件は「**フィルタの変更がダイヤグラムに即座に反映される**」である。
 * チェックが外れたことを見るだけでは足りない——見るべきは、その先で
 * **ダイヤグラムに渡る場面（`selectDiagramScene`）から本当にスジが消えるか**
 * である。押しボタンと描画のあいだが繋がっていなければ、画面は変わらない。
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import routeJson from '../../../data/route.json?raw';
import { createProject } from '@/domain/io';
import type { Project, Trip } from '@/domain/model';
import { loadNetworkDef, type NetworkIndex } from '@/domain/network';
import { fromHM } from '@/domain/time';
import { selectDiagramScene, type SceneTheme } from '@/features/diagram';
import { selectActiveService, selectServices, selectView, useAppStore } from '@/store';
import { SidePanel } from './SidePanel';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const loaded = loadNetworkDef(routeJson);
if (!loaded.ok) throw new Error('route.json を読み込めません');
const network: NetworkIndex = loaded.network;

const THEME: SceneTheme = {
  background: '#fff',
  axis: '#000',
  grid: '#ccc',
  gridFaint: '#eee',
  label: '#333',
};

let counter = 0;

function makeTrip(
  patternId: string,
  hours: number,
  blockId: string,
  overrides: Partial<Trip> = {},
): Trip {
  const pattern = network.patternIndex(patternId);
  if (pattern === undefined) throw new Error(`パターン ${patternId} がありません`);
  counter += 1;
  return {
    tripId: `t${String(counter)}`,
    patternId,
    anchor: { stopId: pattern.originStopId, time: fromHM(hours, 0) },
    blockId,
    pullOut: false,
    pullIn: false,
    ...overrides,
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

/** S1 の 8:00（出区あり・運用 1）と T1 の 9:00（運用 2）。 */
function mount(): void {
  useAppStore.getState().setNetworkDef(network.def);
  useAppStore
    .getState()
    .setProject(makeProject([makeTrip('S1', 8, '1', { pullOut: true }), makeTrip('T1', 9, '2')]));

  root = createRoot(container);
  act(() => {
    root.render(<SidePanel />);
  });
}

/** ダイヤグラムに渡る場面。フィルタが効いているかはここで見る。 */
function scene(): ReturnType<typeof selectDiagramScene> {
  return selectDiagramScene(useAppStore.getState(), THEME);
}

function patternIds(): readonly string[] {
  return scene().trips.map((trip) => trip.patternId);
}

function checkbox(label: string): HTMLInputElement {
  const found = container.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
  if (found === null) throw new Error(`「${label}」が見つかりません`);
  return found;
}

/** `<label>` に包まれた入力欄（読み上げ名は文字そのもの）。 */
function labelled(text: string): HTMLInputElement {
  const found = [...container.querySelectorAll('label')].find(
    (label) => label.textContent.trim() === text,
  );
  const input = found?.querySelector('input');
  if (input === null || input === undefined) throw new Error(`「${text}」が見つかりません`);
  return input;
}

function toggle(label: string): void {
  const input = label.endsWith('を表示') ? checkbox(label) : labelled(label);
  act(() => {
    input.click();
  });
}

function press(label: string): void {
  const found = [...container.querySelectorAll('button')].find(
    (button) => button.textContent.trim() === label || button.getAttribute('aria-label') === label,
  );
  if (found === undefined) throw new Error(`「${label}」が見つかりません`);
  act(() => {
    found.click();
  });
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  // jsdom は showModal を実装していない。開閉そのものはブラウザの責務であり、
  // ここで確かめたいのは中身と答えである（`FileDialogHost.test.tsx` と同じ扱い）。
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement): void {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement): void {
    this.open = false;
  };
  mount();
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
});

describe('表示フィルタ', () => {
  it('**パターンを隠すとダイヤグラムからスジが消える**（受入条件）', () => {
    expect(patternIds()).toContain('S1');

    toggle('S1 を表示');

    expect(patternIds()).not.toContain('S1');
    expect(patternIds()).toContain('T1');
  });

  it('隠した営業便の出区も一緒に消える（仕様書 §6.2.4）', () => {
    // 出区の回送は S1 の便から展開された線である。
    expect(scene().trips.some((trip) => trip.isDeadhead)).toBe(true);

    toggle('S1 を表示');

    expect(scene().trips.some((trip) => trip.isDeadhead)).toBe(false);
  });

  it('もう一度押せば戻る', () => {
    toggle('S1 を表示');
    toggle('S1 を表示');

    expect(patternIds()).toContain('S1');
    expect(selectView(useAppStore.getState())?.hiddenPatternIds).toEqual([]);
  });

  it('運用を隠すとその運用の便が消える', () => {
    toggle('運用 1 を表示');

    expect(patternIds()).not.toContain('S1');
    expect(patternIds()).toContain('T1');
  });

  it('**回送のパターンは一覧に出さない**（押しても効かない切替を置かない）', () => {
    expect(container.querySelector('input[aria-label="DS-out を表示"]')).toBeNull();
    expect(container.querySelector('input[aria-label="S1 を表示"]')).not.toBeNull();
  });

  it('回送便だけを消せる', () => {
    toggle('回送便');

    expect(scene().trips.some((trip) => trip.isDeadhead)).toBe(false);
    expect(patternIds()).toContain('S1');
  });

  it('方向ごとに消せる', () => {
    const before = scene().trips.length;
    toggle('吹田方面');

    expect(scene().trips.length).toBeLessThan(before);
    expect(patternIds()).toContain('T1');
  });

  it('着色モードを変えるとスジの色が変わる', () => {
    const beforeColors = scene().trips.map((trip) => trip.color);

    const select = container.querySelector('select');
    if (select === null) throw new Error('着色モードの選択欄が見つかりません');
    act(() => {
      select.value = 'block';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });

    expect(selectView(useAppStore.getState())?.colorMode).toBe('block');
    expect(scene().trips.map((trip) => trip.color)).not.toEqual(beforeColors);
  });
});

describe('運用の一覧', () => {
  it('便数と稼働時間帯を出す（仕様書 §5.8）', () => {
    const text = container.textContent;
    // 8:00 に出る便は 7:40 に出区する（0 分折返し）。
    expect(text).toContain('1 便');
    expect(text).toMatch(/\d+:\d\d–\d+:\d\d/);
  });

  /** 運用 1 の行。 */
  function blockRow(blockId: string): HTMLElement {
    const row = [...container.querySelectorAll('.panel__row')].find((element) =>
      element.querySelector(`[aria-label="運用 ${blockId} を表示"]`),
    );
    if (row === undefined) throw new Error(`運用 ${blockId} の行がありません`);
    return row as HTMLElement;
  }

  /** 距離の行。 */
  function distanceLine(blockId: string): HTMLElement {
    const found = blockRow(blockId).querySelector<HTMLElement>('.panel__distance');
    if (found === null) throw new Error(`運用 ${blockId} の距離がありません`);
    return found;
  }

  it('**走行距離と営業距離をどちらも出す**（#185。片方を title に隠さない）', () => {
    const text = distanceLine('1').textContent;

    expect(text).toContain('走行');
    expect(text).toContain('営業');
    expect(text).toMatch(/\d+\.\d km/);
  });

  it('**「（回送込み）」と「/」を出さない**（注記のほうが数より長いのは逆である）', () => {
    const text = distanceLine('1').textContent;

    expect(text).not.toContain('回送込み');
    expect(text).not.toContain('/');
  });

  it('**距離は時間・便数と別の行に出す**（1 行に詰め込むと右端が押し出される）', () => {
    const row = blockRow('1');

    // 距離の欄は行を独り占めする（`flex-basis: 100%`）。
    expect(row.querySelector('.panel__distance')).not.toBeNull();
    // 時間と便数は距離の欄の外にある。
    expect(distanceLine('1').textContent).not.toMatch(/\d+:\d\d/);
    expect(distanceLine('1').textContent).not.toContain('便');
  });

  it('**この一覧だけを 2 段にする**（ダイヤ・パターンの一覧は 1 行のまま）', () => {
    expect(blockRow('1').className).toContain('panel__row--stacked');

    const patternRow = [...container.querySelectorAll('.panel__row')].find((element) =>
      element.querySelector('[aria-label="S1 を表示"]'),
    );
    expect(patternRow?.className).not.toContain('panel__row--stacked');
  });

  it('回送を便数に数えない（回送は営業便から展開された線）', () => {
    // 運用 1 は S1 の 1 便だけである。出区の回送を数えると 2 便に見える。
    const row = [...container.querySelectorAll('.panel__row')].find((element) =>
      element.querySelector('[aria-label="運用 1 を表示"]'),
    );
    expect(row?.textContent).toContain('1 便');
  });
});

/** 運用の色（#148）。 */
describe('運用の色', () => {
  const chosen = (): Readonly<Record<string, string>> =>
    selectView(useAppStore.getState())?.blockColors ?? {};

  /** React の管理下にある色の欄を変える。 */
  function pick(label: string, value: string): void {
    const field = container.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
    if (field === null) throw new Error(`「${label}」が見つかりません`);
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )?.set?.bind(field);
      setter?.(value);
      field.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }

  it('**色を選べる**', () => {
    pick('運用 1 の色', '#123456');

    expect(chosen()).toEqual({ '1': '#123456' });
  });

  it('**選んだ色はプロジェクトに入る**（渡した相手の画面でも同じ色で見える）', () => {
    pick('運用 1 の色', '#123456');

    expect(useAppStore.getState().project?.view.blockColors).toEqual({ '1': '#123456' });
  });

  it('**運用を足しても選んだ色は動かない**', () => {
    pick('運用 2 の色', '#123456');

    // 運用 0 を足す。**昇順では先頭に入る**ため、自動割り当てなら 2 の色がずれる。
    useAppStore.getState().editProject('便を足す', (project) => {
      const [service] = project.services;
      service?.trips.push(makeTrip('S3', 10, '0'));
    });

    expect(chosen()).toEqual({ '2': '#123456' });
    const swatch = container.querySelector<HTMLInputElement>('input[aria-label="運用 2 の色"]');
    expect(swatch?.value).toBe('#123456');
  });

  it('自動に戻せる', () => {
    pick('運用 1 の色', '#123456');
    press('運用 1 の色を自動に戻す');

    expect(chosen()).toEqual({});
  });

  it('**選んでいなければ戻す押しボタンを出さない**（押しても何も起きない印を並べない）', () => {
    expect(container.querySelector('[aria-label="運用 1 の色を自動に戻す"]')).toBeNull();
  });
});

describe('ダイヤ', () => {
  it('追加すると、そのダイヤへ移る', () => {
    press('ダイヤを追加');

    const state = useAppStore.getState();
    expect(selectServices(state)).toHaveLength(2);
    expect(selectActiveService(state)?.trips).toEqual([]);
  });

  it('切り替えると、時刻表とダイヤグラムの中身が入れ替わる', () => {
    press('ダイヤを追加');
    expect(scene().trips).toHaveLength(0);

    act(() => {
      checkbox('授業期間平日ダイヤ を編集する').click();
    });

    expect(patternIds()).toContain('S1');
  });

  it('切り替えたら選択は解く（見えていない便を選んだままにしない）', () => {
    act(() => {
      useAppStore.getState().selectTrips(['t1']);
    });
    press('ダイヤを追加');

    expect(useAppStore.getState().ui.selectedTripIds).toEqual([]);
  });

  it('名前を変えられる', () => {
    const input = container.querySelector<HTMLInputElement>('.panel__name');
    if (input === null) throw new Error('名前の欄が見つかりません');

    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )?.set?.bind(input);
      setter?.('試験期間ダイヤ');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });

    expect(selectServices(useAppStore.getState())[0]?.serviceName).toBe('試験期間ダイヤ');
  });

  it('**空の名前は書き込まない**（保存できても開けないファイルを作らない）', () => {
    const input = container.querySelector<HTMLInputElement>('.panel__name');
    if (input === null) throw new Error('名前の欄が見つかりません');

    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )?.set?.bind(input);
      setter?.('');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });

    expect(selectServices(useAppStore.getState())[0]?.serviceName).toBe('授業期間平日ダイヤ');
    // 打っている途中は画面の上だけに残す。
    expect(input.value).toBe('');

    act(() => {
      // React は `focusout` で onBlur を拾う（`blur` は伝播しない）。
      input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    });
    expect(input.value).toBe('授業期間平日ダイヤ');
  });

  it('**最後の 1 つは消せない**（便の置き場所が無くなる）', () => {
    const remove = container.querySelector<HTMLButtonElement>('.panel__icon-button');
    expect(remove?.disabled).toBe(true);
  });

  it('消したダイヤを指したままにしない', () => {
    press('ダイヤを追加');
    const added = selectActiveService(useAppStore.getState())?.serviceId;
    press('新しいダイヤ を削除');
    press('削除する');

    const state = useAppStore.getState();
    expect(selectServices(state)).toHaveLength(1);
    expect(selectView(state)?.activeServiceId).not.toBe(added);
    expect(selectActiveService(state)?.serviceId).toBe('weekday');
  });
});

/*
 * 削除の確認（T-59、#160）。
 *
 * 削除は履歴に載っており取り消せる。**それでも確認を挟むのは、戻せることが
 * 画面から読めない**ためである。ここで固定するのは「押しただけでは消えない」
 * ことと、「答えるまで何も動かない」ことの 2 つである。
 */
describe('ダイヤの削除の確認', () => {
  /** 問いの窓。開いていなければ `null`。 */
  function confirmDialog(): HTMLDialogElement | null {
    const dialog = container.querySelector<HTMLDialogElement>('dialog');
    return dialog?.open === true ? dialog : null;
  }

  beforeEach(() => {
    press('ダイヤを追加');
  });

  it('**押しただけでは消えない**', () => {
    press('新しいダイヤ を削除');

    expect(selectServices(useAppStore.getState())).toHaveLength(2);
    expect(confirmDialog()).not.toBeNull();
  });

  it('名前と便数を出す（失うものの大きさが読める）', () => {
    press('新しいダイヤ を削除');

    expect(confirmDialog()?.textContent).toContain('新しいダイヤ（0 便）');
  });

  it('**便が 0 件でも尋ねる**（出ない場合があると確認そのものを信用しなくなる）', () => {
    // 追加した直後のダイヤは 0 便である。
    expect(selectActiveService(useAppStore.getState())?.trips).toEqual([]);
    press('新しいダイヤ を削除');

    expect(confirmDialog()).not.toBeNull();
  });

  it('便が入っているダイヤでは、その便数を出す', () => {
    act(() => {
      checkbox('授業期間平日ダイヤ を編集する').click();
    });
    press('授業期間平日ダイヤ を削除');

    expect(confirmDialog()?.textContent).toContain('授業期間平日ダイヤ（2 便）');
  });

  it('「削除する」を選べば消える', () => {
    press('新しいダイヤ を削除');
    press('削除する');

    expect(selectServices(useAppStore.getState())).toHaveLength(1);
    expect(confirmDialog()).toBeNull();
  });

  it('**「キャンセル」を選ぶと状態が一切変わらない**', () => {
    const before = useAppStore.getState();
    const services = selectServices(before);
    const activeId = selectView(before)?.activeServiceId;
    const undoDepth = before.history.past.length;

    press('新しいダイヤ を削除');
    press('キャンセル');

    const after = useAppStore.getState();
    // 配列そのものが同じであること——作り直されていれば履歴も動いている。
    expect(selectServices(after)).toBe(services);
    expect(selectView(after)?.activeServiceId).toBe(activeId);
    // 履歴が 1 段でも積まれていれば、何かが書き換わっている。
    expect(after.history.past).toHaveLength(undoDepth);
    expect(confirmDialog()).toBeNull();
  });

  it('<kbd>Esc</kbd> はキャンセル扱い', () => {
    press('新しいダイヤ を削除');
    const dialog = confirmDialog();

    act(() => {
      dialog?.dispatchEvent(new Event('cancel', { bubbles: false, cancelable: true }));
    });

    expect(selectServices(useAppStore.getState())).toHaveLength(2);
    expect(confirmDialog()).toBeNull();
  });

  it('背景を押すのもキャンセル扱い', () => {
    press('新しいダイヤ を削除');
    const dialog = confirmDialog();

    act(() => {
      // 中身ではなく `<dialog>` 自身が押されたときだけ、背景を押したとみなす。
      dialog?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(selectServices(useAppStore.getState())).toHaveLength(2);
    expect(confirmDialog()).toBeNull();
  });

  it('**既定の焦点はキャンセル**（Enter を続けて押しても消えない）', () => {
    press('新しいダイヤ を削除');

    expect(document.activeElement?.textContent).toBe('キャンセル');
  });

  it('削除は今までどおり履歴に載る（取り消せる）', () => {
    press('新しいダイヤ を削除');
    press('削除する');
    expect(selectServices(useAppStore.getState())).toHaveLength(1);

    act(() => {
      useAppStore.getState().undo();
    });
    expect(selectServices(useAppStore.getState())).toHaveLength(2);
  });
});
