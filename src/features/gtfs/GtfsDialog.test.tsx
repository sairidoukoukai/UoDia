// @vitest-environment jsdom

/**
 * GTFS 画面の検証（T-72、仕様書 v2 §3）。
 *
 * 計算そのものは `gtfs.test.ts` が見る。ここで確かめるのは**画面の作り**である
 * ——タブが 4 つあること、車庫にも欄が出ること、**適用するまで状態に触れない**
 * こと（§6.5.1）、**書き戻せない環境でそう伝えること**（§6.5.5）。
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import routeJson from '../../../data/route.json?raw';
import { createProject } from '@/domain/io';
import { loadNetworkDef, type NetworkIndex } from '@/domain/network';
import type { PlatformAdapter } from '@/platform';
import { useAppStore } from '@/store';
import { GtfsDialog } from './GtfsDialog';

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

function mount(writable = true): void {
  // **毎回同じところから始める。** ストアは 1 つしかなく、前の検証で変えた定義が
  // 残ると、順番によって結果が変わる。
  useAppStore.getState().setNetworkDef(network.def);
  useAppStore
    .getState()
    .setProject(createProject(network, { now: new Date('2026-01-01T00:00:00Z') }));

  root = createRoot(container);
  act(() => {
    root.render(<GtfsDialog open platform={makePlatform(writable)} onClose={onClose} />);
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

/** 読み上げ名で入力欄を引く。 */
function field(label: string): HTMLInputElement {
  const found = container.querySelector<HTMLInputElement>(`[aria-label="${label}"]`);
  if (found === null) throw new Error(`「${label}」の欄がありません`);
  return found;
}

/** 欄に打つ。 */
function type(input: HTMLInputElement, value: string): void {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.bind(
      input,
    );
    setter?.(value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  HTMLDialogElement.prototype.showModal = vi.fn();
  HTMLDialogElement.prototype.close = vi.fn();
  onClose.mockClear();
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
});

describe('GtfsDialog', () => {
  it('**タブが 4 つある**（事業者・停留所・カレンダー・書き出し）', () => {
    mount();
    const tabs = [...container.querySelectorAll('[role="tab"]')].map((t) => t.textContent);
    expect(tabs).toEqual(['事業者', '停留所', 'カレンダー', '書き出し']);
  });

  it('設定ダイアログとは別のダイアログである', () => {
    mount();
    expect(container.querySelector('dialog')?.getAttribute('aria-label')).toBe('GTFS');
  });

  it('**まだ作っていないタブは、何が入るかを書いておく**', () => {
    mount();
    act(() => {
      button('カレンダー').click();
    });
    expect(container.textContent).toContain('T-73');
  });
});

describe('事業者タブ', () => {
  it('route.json の値を出す', () => {
    mount();
    expect(field('事業者名').value).toBe('国立大学法人大阪大学');
  });

  it('**必須が空なら適用できない**', () => {
    mount();
    type(field('事業者名'), '');
    expect(button('適用して route.json に書き戻す').disabled).toBe(true);
    expect(container.textContent).toContain('事業者の必須項目が空です');
  });

  it('**開いただけでは適用できない**（変更が無ければ route.json を触らない）', () => {
    mount();
    expect(button('適用して route.json に書き戻す').disabled).toBe(true);
    expect(container.textContent).toContain('変更はありません');
  });

  it('打ち直すと適用できるようになる', () => {
    mount();
    type(field('事業者名'), '大阪大学');
    expect(button('適用して route.json に書き戻す').disabled).toBe(false);
  });

  it('**打っただけでは状態に触れない**（適用するまで route.json は変わらない）', () => {
    mount();
    type(field('事業者名'), '打ちかけ');
    expect(useAppStore.getState().networkDef?.agency?.agencyName).toBe('国立大学法人大阪大学');
  });
});

describe('停留所タブ', () => {
  it('**車庫にも欄が出る**（stops.txt に出す以上、座標が要る）', () => {
    mount();
    act(() => {
      button('停留所').click();
    });
    expect(field('千里営業所の緯度')).toBeTruthy();
  });

  it('微生物研究所前にも欄が出る（時刻表に出ないことと、GTFS に出ないことは別）', () => {
    mount();
    act(() => {
      button('停留所').click();
    });
    expect(field('微生物研究所前の緯度')).toBeTruthy();
  });

  it('**読めない値を打つと適用できない**', () => {
    mount();
    act(() => {
      button('停留所').click();
    });
    type(field('豊中学舎の緯度'), '北緯 34 度');

    expect(button('適用して route.json に書き戻す').disabled).toBe(true);
    expect(container.textContent).toContain('読めません');
  });

  it('読めない欄を読み上げにも伝える（色だけで示さない）', () => {
    mount();
    act(() => {
      button('停留所').click();
    });
    type(field('豊中学舎の緯度'), '999');

    expect(field('豊中学舎の緯度').getAttribute('aria-invalid')).toBe('true');
  });
});

describe('書き戻せない環境（§6.5.5）', () => {
  it('ボタンの言葉が「書き出す」になる', () => {
    mount(false);
    expect(button('適用して route.json を書き出す')).toBeTruthy();
  });

  it('**書き戻せないことを画面に書く**', () => {
    mount(false);
    expect(container.textContent).toContain('この環境では route.json を書き戻せません');
  });
});
