// @vitest-environment jsdom

/**
 * ツールバーの検証（T-32、仕様書 §6.4）。
 *
 * ここで確かめるのは、**押した結果がストアに届くこと**と、押せない操作が
 * 押せない形で出ていることである。ファイル操作そのものは `fileService` の
 * 受け持ちであり、ここは呼んだかどうかだけを見る。
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import routeJson from '../../../data/route.json?raw';
import { createProject } from '@/domain/io';
import { loadNetworkDef, type NetworkIndex } from '@/domain/network';
import { useAppStore } from '@/store';
import { Toolbar } from './Toolbar';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const loaded = loadNetworkDef(routeJson);
if (!loaded.ok) throw new Error('route.json を読み込めません');
const network: NetworkIndex = loaded.network;

let container: HTMLDivElement;
let root: Root;
const onNew = vi.fn();

function mount(): void {
  root = createRoot(container);
  act(() => {
    root.render(
      <Toolbar
        onNew={onNew}
        onOpen={() => undefined}
        onSave={() => undefined}
        onSaveAs={() => undefined}
      />,
    );
  });
}

function button(label: string): HTMLButtonElement {
  const found = [...container.querySelectorAll('button')].find(
    (element) => element.textContent.trim() === label,
  );
  if (found === undefined) throw new Error(`「${label}」が見つかりません`);
  return found;
}

function press(label: string): void {
  act(() => {
    button(label).click();
  });
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  onNew.mockClear();

  useAppStore.getState().setNetworkDef(network.def);
  useAppStore
    .getState()
    .setProject(createProject(network, { now: new Date('2026-01-01T00:00:00Z') }));
  useAppStore.getState().setMaximizedPane(null);
  useAppStore.getState().setTool('select');
  mount();
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
});

describe('ツールバー', () => {
  it('ファイル操作を呼ぶ', () => {
    press('新規');
    expect(onNew).toHaveBeenCalledTimes(1);
  });

  it('取り消せるものが無ければ押せない', () => {
    expect(button('元に戻す').disabled).toBe(true);
    expect(button('やり直す').disabled).toBe(true);

    act(() => {
      useAppStore.getState().editProject('文書名の変更', (project) => {
        project.document.name = '試作';
      });
    });

    expect(button('元に戻す').disabled).toBe(false);
    // **何が戻るのかを押す前に出す**（仕様書 §6.7）。
    expect(button('元に戻す').title).toBe('文書名の変更 を元に戻す');
  });

  it('道具を選べる（仕様書 §6.3.3、T-30）', () => {
    expect(useAppStore.getState().ui.tool).toBe('select');
    expect(button('選択').getAttribute('aria-checked')).toBe('true');

    press('スジ作成');

    expect(useAppStore.getState().ui.tool).toBe('draw');
    expect(button('スジ作成').getAttribute('aria-checked')).toBe('true');
    expect(button('選択').getAttribute('aria-checked')).toBe('false');
  });

  it('作図で何ができるかを持ち手に出す（どちらの方向の便になるか）', () => {
    expect(button('スジ作成').title).toContain('吹田方面');
  });

  it('最大化を切り替えられる。**押し直せば 2 分割に戻る**', () => {
    press('ダイヤグラムを最大化');
    expect(useAppStore.getState().ui.maximized).toBe('diagram');
    expect(button('ダイヤグラムを最大化').getAttribute('aria-pressed')).toBe('true');

    press('ダイヤグラムを最大化');
    expect(useAppStore.getState().ui.maximized).toBeNull();
  });

  it('もう一方を押せば入れ替わる', () => {
    press('ダイヤグラムを最大化');
    press('時刻表を最大化');

    expect(useAppStore.getState().ui.maximized).toBe('timetable');
    expect(button('ダイヤグラムを最大化').getAttribute('aria-pressed')).toBe('false');
  });
});
