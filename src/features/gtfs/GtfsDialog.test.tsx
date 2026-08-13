// @vitest-environment jsdom

/**
 * GTFS 画面の検証（T-72・T-85、仕様書 v2 §3）。
 *
 * 計算そのものは `gtfs.test.ts` が見る。ここで確かめるのは**画面の作り**である
 * ——**タブが 2 つであること**（#221）、それぞれが開くこと、そして**`route.json`
 * へ書き戻す道がこの画面から消えていること**。
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import routeJson from '../../../data/route.json?raw';
import dialogSource from './GtfsDialog.tsx?raw';
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
const saveNetworkDef = vi.fn().mockResolvedValue(undefined);

function makePlatform(): PlatformAdapter {
  return {
    kind: 'test',
    capabilities: { saveInPlace: true, recentFiles: true, networkDefWritable: true },
    saveNetworkDef,
    saveProjectAs: vi.fn().mockResolvedValue({ kind: 'test', name: 'route.json' }),
  } as unknown as PlatformAdapter;
}

function mount(): void {
  // **毎回同じところから始める。** ストアは 1 つしかなく、前の検証で変えた定義が
  // 残ると、順番によって結果が変わる。
  useAppStore.getState().setSeedNetworkDef(network.def);
  useAppStore
    .getState()
    .setProject(createProject(network, { now: new Date('2026-01-01T00:00:00Z') }));

  root = createRoot(container);
  act(() => {
    root.render(<GtfsDialog open platform={makePlatform()} onClose={onClose} />);
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

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  HTMLDialogElement.prototype.showModal = vi.fn();
  HTMLDialogElement.prototype.close = vi.fn();
  onClose.mockClear();
  saveNetworkDef.mockClear();
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
});

describe('GtfsDialog', () => {
  it('**タブが 2 つある**（カレンダー・書き出し。#221 で事業者と停留所を外した）', () => {
    mount();
    const tabs = [...container.querySelectorAll('[role="tab"]')].map((t) => t.textContent);
    expect(tabs).toEqual(['カレンダー', '書き出し']);
  });

  it('設定ダイアログとは別のダイアログである', () => {
    mount();
    expect(container.querySelector('dialog')?.getAttribute('aria-label')).toBe('GTFS');
  });

  it('**開くとカレンダーが出る**（最初のタブ）', () => {
    mount();
    expect(button('カレンダー').getAttribute('aria-selected')).toBe('true');
  });

  it('**書き出しタブが開く**（T-81 で入った）', () => {
    // 中身の振る舞いは `ExportTab.test.tsx` が見る。ここで確かめるのは
    // **タブを押すとそれが出ること**である。
    mount();
    act(() => {
      button('書き出し').click();
    });
    expect(container.textContent).toContain('GTFS を書き出す');
  });
});

describe('route.json を触らない（T-85 受入条件）', () => {
  it('**どのタブを開いても書き戻さない**', () => {
    mount();
    act(() => {
      button('書き出し').click();
    });
    act(() => {
      button('カレンダー').click();
    });

    expect(saveNetworkDef).not.toHaveBeenCalled();
  });

  /*
    **押して確かめられない。** 書き戻す押しボタンそのものを外したため、呼ばれない
    ことを操作から示す道が無い。**書き戻しを呼ぶ道が無いこと**を原文で固定する
    ——これが戻れば、次に欄を足した人がここで気づく。
  */
  it('**`saveNetworkDef` を呼ぶ道が無い**（原文に出てこない）', () => {
    // 冒頭の解説では「書き戻し」に触れている。**呼び出しの名前だけ**を見る。
    expect(dialogSource).not.toContain('saveNetworkDef');
  });
});
