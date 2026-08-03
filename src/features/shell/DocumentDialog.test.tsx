// @vitest-environment jsdom

/**
 * 文書情報のダイアログの検証（#144）。
 *
 * ツールバーの隅にあった文書名の記入欄を引き取った場所である。確かめるのは
 * **打った時点で効くこと**と、**連続した打鍵が 1 回の取り消しにまとまること**。
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import routeJson from '../../../data/route.json?raw';
import { createProject } from '@/domain/io';
import { loadNetworkDef, type NetworkIndex } from '@/domain/network';
import { useAppStore } from '@/store';
import { DocumentDialog } from './DocumentDialog';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const loaded = loadNetworkDef(routeJson);
if (!loaded.ok) throw new Error('route.json を読み込めません');
const network: NetworkIndex = loaded.network;

let container: HTMLDivElement;
let root: Root;
const onClose = vi.fn();

function mount(open = true): void {
  root = createRoot(container);
  act(() => {
    root.render(<DocumentDialog open={open} onClose={onClose} />);
  });
}

function field(label: string): HTMLInputElement | HTMLTextAreaElement {
  const found = [...container.querySelectorAll('label')].find((element) =>
    element.textContent.startsWith(label),
  );
  const input = found?.querySelector('input, textarea');
  if (input === null || input === undefined) throw new Error(`「${label}」がありません`);
  return input as HTMLInputElement | HTMLTextAreaElement;
}

/** React の管理下にある記入欄へ打つ。 */
function type(element: HTMLInputElement | HTMLTextAreaElement, text: string): void {
  act(() => {
    const proto =
      element instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(element, text);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

const document_ = () => useAppStore.getState().project?.document;

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement): void {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement): void {
    this.open = false;
  };
  onClose.mockClear();

  useAppStore.getState().setNetworkDef(network.def);
  useAppStore
    .getState()
    .setProject(createProject(network, { now: new Date('2026-01-01T00:00:00Z') }));
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
});

describe('文書情報', () => {
  it('**打った時点で効く**（適用は要らない。直しても他の値は動かない）', () => {
    mount();
    type(field('文書名'), '授業期間平日');

    expect(document_()?.name).toBe('授業期間平日');
  });

  it('作成者とメモも直せる', () => {
    mount();
    type(field('作成者'), '再履同好会');
    type(field('メモ'), '2026 年度前期');

    expect(document_()?.author).toBe('再履同好会');
    expect(document_()?.comment).toBe('2026 年度前期');
  });

  it('**続けて打っても取り消しは 1 回**（1 文字ずつ戻らない）', () => {
    mount();
    const steps = useAppStore.getState().history.past.length;
    type(field('文書名'), '平');
    type(field('文書名'), '平日');
    type(field('文書名'), '平日ダイヤ');

    expect(useAppStore.getState().history.past.length).toBe(steps + 1);
    useAppStore.getState().undo();
    expect(document_()?.name).not.toBe('平日ダイヤ');
  });

  it('閉じると伝える', () => {
    mount();
    act(() => {
      [...container.querySelectorAll('button')]
        .find((button) => button.textContent === '閉じる')
        ?.click();
    });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('**プロジェクトが無ければそう言う**（空の記入欄を出さない）', () => {
    useAppStore.getState().setProject(null);
    mount();

    expect(container.textContent).toContain('プロジェクトを開いていません');
  });
});
