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
import { selectNetwork, useAppStore } from '@/store';
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
  useAppStore.getState().setNetworkDef(network.def);
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

describe('書き戻せない環境（§6.5.5）', () => {
  it('**制約を画面に出し、書き出しを提げる**', () => {
    mount(false);

    expect(text()).toContain('書き戻せません');
    expect(button('route.json を書き出す')).toBeDefined();
  });

  it('書き戻せる環境では書き戻すと言う', () => {
    mount(true);
    expect(button('route.json に書き戻す')).toBeDefined();
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
