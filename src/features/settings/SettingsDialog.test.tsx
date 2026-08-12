// @vitest-environment jsdom

/**
 * 設定ダイアログの検証（T-35、仕様書 §6.5）。
 *
 * 計算そのものは `segments.test.ts` が見る。ここで確かめるのは**打った値が
 * すぐには効かないこと**（適用の前に何便に効くかを出す。§6.5.1）と、
 * **書き戻せない環境でそう伝えること**（§6.5.5）である。
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import routeJson from '../../../data/route.json?raw';
import { createProject } from '@/domain/io';
import type { Trip } from '@/domain/model';
import { loadNetworkDef, type NetworkIndex } from '@/domain/network';
import type { PlatformAdapter } from '@/platform';
import { fromHM } from '@/domain/time';
import { selectNetwork, selectTrips, useAppStore } from '@/store';
import { SettingsDialog } from './SettingsDialog';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const loaded = loadNetworkDef(routeJson);
if (!loaded.ok) throw new Error('route.json を読み込めません');
const network: NetworkIndex = loaded.network;

let container: HTMLDivElement;
let root: Root;
const onClose = vi.fn();

function makePlatform(networkDefWritable: boolean): PlatformAdapter {
  return {
    kind: 'test',
    capabilities: { saveInPlace: true, recentFiles: true, networkDefWritable },
    saveNetworkDef: vi.fn().mockResolvedValue(undefined),
    saveProjectAs: vi.fn().mockResolvedValue({ kind: 'test', name: 'route.json' }),
  } as unknown as PlatformAdapter;
}

function makeTrip(tripId: string, patternId: string, hours: number): Trip {
  const pattern = network.patternIndex(patternId);
  if (pattern === undefined) throw new Error(`パターン ${patternId} がありません`);
  return {
    tripId,
    patternId,
    anchor: { stopId: pattern.originStopId, time: fromHM(hours, 0) },
    blockId: 'A',
    pullOut: false,
    pullIn: false,
  };
}

function mount(writable = true): void {
  // **毎回同じところから始める。** ストアは 1 つしかなく、前の検証で変えた設定が
  // 残ると、順番によって結果が変わる。
  useAppStore.getState().setSettings({ theme: 'system' });
  useAppStore.getState().setSeedNetworkDef(network.def);
  useAppStore
    .getState()
    .setProject(createProject(network, { now: new Date('2026-01-01T00:00:00Z') }));
  useAppStore.getState().editProject('便を置く', (project) => {
    const [service] = project.services;
    if (service !== undefined) service.trips = [makeTrip('t1', 'S3', 8), makeTrip('t2', 'T1', 10)];
  });

  root = createRoot(container);
  act(() => {
    root.render(<SettingsDialog open platform={makePlatform(writable)} onClose={onClose} />);
  });
}

/** 名前で押しボタンを引く。 */
function button(label: string): HTMLButtonElement {
  const found = [...container.querySelectorAll('button')].find(
    (item) => item.textContent.trim() === label,
  );
  if (found === undefined) throw new Error(`「${label}」がありません`);
  return found;
}

/** 区間の入力欄。 */
function minutesField(label: string): HTMLInputElement {
  const found = container.querySelector<HTMLInputElement>(
    `[aria-label="${label} の所要時間（分）"]`,
  );
  if (found === null) throw new Error(`「${label}」の欄がありません`);
  return found;
}

/** 停留所の線種の選択欄。 */
function gridStyleField(shortName: string): HTMLSelectElement {
  const found = container.querySelector<HTMLSelectElement>(`[aria-label="${shortName} の線種"]`);
  if (found === null) throw new Error(`「${shortName}」の線種の欄がありません`);
  return found;
}

/** React の管理下にある選択欄を選び直す。 */
function choose(field: HTMLSelectElement, value: string): void {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set?.bind(
      field,
    );
    setter?.(value);
    field.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

/** React の管理下にある入力欄へ打つ。 */
function type(field: HTMLInputElement, text: string): void {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.bind(
      field,
    );
    setter?.(text);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

const text = (): string => container.textContent;
const runMinutes = (): number | undefined =>
  selectNetwork(useAppStore.getState())?.runMinutes('1_0', '2_0');

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  // jsdom は showModal を実装していない。開閉そのものはブラウザの責務であり、
  // ここで確かめたいのは中身と、押した結果である。
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement): void {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement): void {
    this.open = false;
  };
  onClose.mockClear();
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
});

describe('区間所要時間タブ（§6.5.1）', () => {
  it('区間表を一覧に出す', () => {
    mount();

    expect(text()).toContain('豊中 → 箕面');
    expect(minutesField('豊中 → 箕面').value).toBe('20');
  });

  it('**打っただけでは効かない**（適用するまで状態に触れない）', () => {
    mount();
    type(minutesField('豊中 → 箕面'), '30');

    expect(runMinutes()).toBe(20);
  });

  it('**適用の前に何便に効くかを出す**', () => {
    mount();
    type(minutesField('豊中 → 箕面'), '30');

    // S3（豊中 → 箕面 → …）だけが通る。
    expect(text()).toContain('1 便');
  });

  it('**押してから確かめる**（確認を挟んでから履歴に載る）', () => {
    mount();
    type(minutesField('豊中 → 箕面'), '30');

    act(() => {
      button('変更を適用').click();
    });
    expect(runMinutes()).toBe(20);
    expect(text()).toContain('よろしいですか');

    act(() => {
      button('適用する').click();
    });
    expect(runMinutes()).toBe(30);
  });

  it('やめれば何も起きない', () => {
    mount();
    type(minutesField('豊中 → 箕面'), '30');
    act(() => {
      button('変更を適用').click();
    });
    act(() => {
      button('やめる').click();
    });

    expect(runMinutes()).toBe(20);
  });

  it('**5 の倍数でない値では適用できない**（受入条件）', () => {
    mount();
    type(minutesField('豊中 → 箕面'), '21');

    expect(minutesField('豊中 → 箕面').getAttribute('aria-invalid')).toBe('true');
    expect(button('変更を適用').disabled).toBe(true);
    expect(text()).toContain('5 の倍数');
  });

  it('変更が無ければ適用できない', () => {
    mount();
    expect(button('変更を適用').disabled).toBe(true);
  });

  it('入力を元に戻せる', () => {
    mount();
    type(minutesField('豊中 → 箕面'), '30');
    act(() => {
      button('入力を元に戻す').click();
    });

    expect(minutesField('豊中 → 箕面').value).toBe('20');
    expect(runMinutes()).toBe(20);
  });
});

describe('書き戻す先が無い（T-92、#235）', () => {
  it('**`route.json` の押しボタンが出ない**', () => {
    mount();
    // 環境で分かれていた 2 つの文言が、どちらも消えている。
    expect(text()).not.toContain('route.json に書き戻す');
    expect(text()).not.toContain('route.json を書き出す');
    expect(text()).not.toContain('書き戻せません');
  });

  it('**変更が文書に入ることを伝える**', () => {
    mount();
    expect(text()).toContain('編集中の文書に入ります');
    // 画面に出す文には印付けを混ぜない（そのまま字として出る）。
    expect(text()).not.toContain('**');
  });
});

describe('動作タブ（§6.5.2）', () => {
  it('取り消しの段数を変えられる', () => {
    mount();
    act(() => {
      button('動作').click();
    });

    const field = container.querySelector<HTMLInputElement>('input[type="number"]');
    if (field === null) throw new Error('欄がありません');
    type(field, '50');

    expect(useAppStore.getState().history.limit).toBe(50);
  });

  it('**範囲の外は収める**（10〜1000）', () => {
    mount();
    act(() => {
      button('動作').click();
    });

    const field = container.querySelector<HTMLInputElement>('input[type="number"]');
    if (field === null) throw new Error('欄がありません');
    type(field, '5');

    expect(useAppStore.getState().history.limit).toBe(10);
  });

  it('自動バックアップの間隔を分で扱う', () => {
    mount();
    act(() => {
      button('動作').click();
    });

    const fields = container.querySelectorAll<HTMLInputElement>('input[type="number"]');
    const interval = fields[1];
    if (interval === undefined) throw new Error('欄がありません');
    expect(interval.value).toBe('5');

    type(interval, '10');
    expect(useAppStore.getState().settings.backupIntervalMs).toBe(10 * 60_000);
  });
});

describe('表示タブ（§6.5.3）', () => {
  it('**テーマを選べる**（T-39）', () => {
    mount();
    act(() => {
      button('表示').click();
    });

    const dark = container.querySelector<HTMLInputElement>('input[type="radio"][value="dark"]');
    if (dark === null) throw new Error('テーマの選択がありません');

    act(() => {
      dark.click();
    });
    expect(useAppStore.getState().settings.theme).toBe('dark');
  });

  it('既定は「システムに従う」（起動した瞬間に驚かせない）', () => {
    mount();
    act(() => {
      button('表示').click();
    });

    const system = container.querySelector<HTMLInputElement>('input[type="radio"][value="system"]');
    expect(system?.checked).toBe(true);
  });

  it('既定の拡大率を変えられる', () => {
    mount();
    act(() => {
      button('表示').click();
    });

    const field = container.querySelector<HTMLInputElement>('input[type="number"]');
    if (field === null) throw new Error('欄がありません');
    type(field, '6');

    expect(useAppStore.getState().settings.defaultDiagramView.pxPerMinute).toBe(6);
  });

  /** 停留所の線種（#133）。 */
  describe('停留所の線種', () => {
    // **上書きは文書にある**（T-90、#235）。
    const overrides = (): Readonly<Record<string, string>> =>
      useAppStore.getState().project?.view.stopGridStyles ?? {};

    function openDisplayTab(): void {
      mount();
      act(() => {
        button('表示').click();
      });
    }

    it('**縦軸に出る停留所だけを並べる**（出ない停留所の線種を選んでも効かない）', () => {
      openDisplayTab();

      expect(() => gridStyleField('豊中')).not.toThrow();
      // 微生物研究所前（`hiddenInEditor`）と千里営業所は縦軸に出ない。
      expect(() => gridStyleField('微研')).toThrow();
    });

    it('**route.json の値を選択肢に出す**（何を上書きするのかが分かる）', () => {
      openDisplayTab();

      // 豊中は route.json では太線。
      expect(gridStyleField('豊中').options[0]?.textContent).toBe('上書きしない（太線）');
    });

    it('選ぶと上書きが入る', () => {
      openDisplayTab();
      choose(gridStyleField('豊中'), 'dashed');

      expect(overrides()).toEqual({ '1_0': 'dashed' });
    });

    it('**「上書きしない」を選ぶと上書きが外れる**（選び直せる）', () => {
      openDisplayTab();
      choose(gridStyleField('豊中'), 'dashed');
      choose(gridStyleField('豊中'), '');

      expect(overrides()).toEqual({});
    });

    it('全部やめられる', () => {
      openDisplayTab();
      choose(gridStyleField('豊中'), 'dashed');
      choose(gridStyleField('箕面'), 'normal');
      act(() => {
        button('すべての上書きをやめる').click();
      });

      expect(overrides()).toEqual({});
    });

    it('**上書きが無ければ戻す押しボタンは押せない**（押しても何も起きない操作を出さない）', () => {
      openDisplayTab();

      expect(button('すべての上書きをやめる').disabled).toBe(true);
      choose(gridStyleField('豊中'), 'dashed');
      expect(button('すべての上書きをやめる').disabled).toBe(false);
    });

    it('いくつ上書きしているかを言う', () => {
      openDisplayTab();
      expect(text()).toContain('上書きはありません');

      choose(gridStyleField('豊中'), 'dashed');
      expect(text()).toContain('1 停留所を上書きしています');
    });
  });
});

/** 停車パターンの色と線種（#147）。 */
describe('区間距離（#161）', () => {
  /** 区間タブは既定で開いている。 */
  function distanceInput(label: string): HTMLInputElement {
    const found = container.querySelector<HTMLInputElement>(`[aria-label="${label} の距離（km）"]`);
    if (found === null) throw new Error(`「${label} の距離」が見つかりません`);
    return found;
  }

  beforeEach(() => {
    mount();
  });

  it('**距離の欄が出る**（所要時間と同じ表に並べる）', () => {
    expect(distanceInput('豊中 → 箕面').value).toBe('6.4');
  });

  it('**距離を変えても便の時刻は動かない**（時刻を決めるのは所要時間だけ）', () => {
    const before = selectTrips(useAppStore.getState()).map((t) => t.anchor?.time);

    type(distanceInput('豊中 → 箕面'), '9.9');
    act(() => {
      button('変更を適用').click();
    });
    act(() => {
      button('適用する').click();
    });

    expect(selectTrips(useAppStore.getState()).map((t) => t.anchor?.time)).toEqual(before);
    expect(
      useAppStore.getState().project?.network.segments.find((s) => s.toStopId === '2_0')
        ?.distanceMeters,
    ).toBe(9900);
  });

  it('**5 の倍数の縛りは掛けない**（5 分刻みはダイヤの側の決まりである）', () => {
    type(distanceInput('豊中 → 箕面'), '1.3');
    expect(distanceInput('豊中 → 箕面').getAttribute('aria-invalid')).toBe('false');
  });

  it('受け取れない距離は伝える', () => {
    type(distanceInput('豊中 → 箕面'), 'あ');
    expect(container.textContent).toContain('距離は 0 以上の数で入れてください');
  });
});

describe('停車パターンの色と線種', () => {
  function openDisplayTab(): void {
    mount();
    act(() => {
      button('表示').click();
    });
  }

  const styles = (): unknown => useAppStore.getState().project?.view.patternStyles;

  it('**回送のパターンも並べる**（#179）', () => {
    openDisplayTab();

    expect(container.querySelector('[aria-label="S1 の色"]')).not.toBeNull();
    // 運用で着色すると回送は元の便と同じ色になり、太さの違いだけが手掛かりに
    // なる。そこを補えるようにする。
    expect(container.querySelector('[aria-label="DT-out の線種"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="DT-out の色"]')).not.toBeNull();
  });

  it('**route.json の線種を選択肢に出す**（何を上書きするのかが分かる）', () => {
    openDisplayTab();

    const select = container.querySelector<HTMLSelectElement>('[aria-label="S1 の線種"]');
    // S1（直行吹田）は通過タイプであり、既定は破線である（#114）。
    expect(select?.options[0]?.textContent).toBe('上書きしない（破線）');
  });

  it('線種を選ぶと上書きが入る', () => {
    openDisplayTab();
    const select = container.querySelector<HTMLSelectElement>('[aria-label="S1 の線種"]');
    if (select === null) throw new Error('欄がありません');
    choose(select, 'dashDot');

    expect(styles()).toEqual({ S1: { dash: 'dashDot' } });
  });

  it('**色と線種を別々に変えられる**', () => {
    openDisplayTab();
    const select = container.querySelector<HTMLSelectElement>('[aria-label="S1 の線種"]');
    const color = container.querySelector<HTMLInputElement>('[aria-label="S1 の色"]');
    if (select === null || color === null) throw new Error('欄がありません');

    choose(select, 'solid');
    type(color, '#123456');

    expect(styles()).toEqual({ S1: { color: '#123456', dash: 'solid' } });
  });

  it('そのパターンだけ上書きをやめられる', () => {
    openDisplayTab();
    const select = container.querySelector<HTMLSelectElement>('[aria-label="S1 の線種"]');
    if (select === null) throw new Error('欄がありません');
    choose(select, 'solid');

    act(() => {
      button('↺').click();
    });

    expect(styles()).toEqual({});
  });
});

describe('隠し設定（§6.5.4、T-36。受入条件）', () => {
  it('**通常の操作では到達できない**（タブが無い）', () => {
    mount();

    expect(container.textContent).not.toContain('停車パターン');
    expect(() => button('停車パターン')).toThrow();
  });

  it('有効にすればタブが出て、パターンを直せる', () => {
    useAppStore.getState().setSettings({ patternsUnlocked: true });
    mount();

    act(() => {
      button('停車パターン').click();
    });

    expect(container.textContent).toContain('S3');
    expect(container.textContent).toContain('豊中 → 箕面 → コンベ前');
  });

  it('**区間表にない停留所対を作ると、足りない区間を名指しして止める**', () => {
    useAppStore.getState().setSettings({ patternsUnlocked: true });
    mount();
    act(() => {
      button('停車パターン').click();
    });

    // S3（豊中 → 箕面 → コンベ前 → 微研 → 工学部）から、コンベ前と微研を外す。
    act(() => {
      const list = [
        ...container.querySelectorAll<HTMLButtonElement>('.settings__pattern-list button'),
      ];
      list.find((item) => item.textContent.startsWith('S3'))?.click();
    });
    act(() => {
      container.querySelector<HTMLButtonElement>('[aria-label="3_0 を外す"]')?.click();
    });
    act(() => {
      container.querySelector<HTMLButtonElement>('[aria-label="6_0 を外す"]')?.click();
    });

    expect(container.textContent).toContain('[R-03]');
    expect(container.textContent).toContain('2_0→4_0');
    expect(button('変更を適用').disabled).toBe(true);
  });
});

describe('閉じる', () => {
  it('閉じるを押すと知らせる', () => {
    mount();
    act(() => {
      button('閉じる').click();
    });

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
