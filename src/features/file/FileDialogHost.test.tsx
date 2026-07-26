// @vitest-environment jsdom

/**
 * 問いかけの見た目の検証。
 *
 * 見た目そのものではなく、**どの押しボタンがどの答えを返すか**を固定する。
 * 選択肢と答えの対応が崩れると「破棄」を押して保存される類の事故になり、
 * しかも画面を見ているだけでは気づけない。
 *
 * `renderToStaticMarkup` ではなく jsdom へ描くのは、押した結果を確かめる必要が
 * あるためである（`platform/context.test.tsx` とは目的が違う）。
 */

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FileDialogHost } from './FileDialogHost';
import type { DialogRequest } from './dialogs';
import type { DialogAnswer } from './prompts';

// act() の中で状態更新をまとめてよいことを React に伝える。付けないと、更新が
// 反映される前に確認してしまう危険を毎回警告される。
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  // jsdom は showModal を実装していない。開閉そのものはブラウザの責務であり、
  // ここで確かめたいのは中身と答えである。
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement): void {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement): void {
    this.open = false;
  };
});

afterEach(() => {
  container.remove();
});

/** 問いを描き、押しボタンの並びと答えを取り出せるようにする。 */
function show(request: DialogRequest | null): {
  labels: string[];
  answers: DialogAnswer[];
  click: (label: string) => void;
  text: string;
} {
  const onRespond = vi.fn<(choice: DialogAnswer) => void>();
  const root = createRoot(container);
  act(() => {
    root.render(<FileDialogHost request={request} onRespond={onRespond} />);
  });

  const buttons = [...container.querySelectorAll('button')];
  return {
    labels: buttons.map((button) => button.textContent),
    get answers() {
      return onRespond.mock.calls.map(([answer]) => answer);
    },
    click(label) {
      const button = buttons.find((b) => b.textContent === label);
      if (button === undefined) throw new Error(`押しボタンがありません: ${label}`);
      act(() => {
        button.click();
      });
    },
    text: container.textContent,
  };
}

describe('未保存の確認', () => {
  const request: DialogRequest = { kind: 'discard', fileName: 'a.uodia' };

  it('3 択を出す（続ける気が無いときに保存か破棄かを選ばせない）', () => {
    expect(show(request).labels).toEqual(['保存して続ける', '破棄して続ける', 'やめる']);
  });

  it.each([
    ['保存して続ける', 'save'],
    ['破棄して続ける', 'discard'],
    ['やめる', 'cancel'],
  ] as const)('「%s」は %s を返す', (label, answer) => {
    const dialog = show(request);
    dialog.click(label);
    expect(dialog.answers).toEqual([answer]);
  });

  it('既定の答えは保存で、焦点も当たっている', () => {
    show(request);
    expect(document.activeElement?.textContent).toBe('保存して続ける');
  });

  it('保存先が未定なら「無題」と呼ぶ', () => {
    expect(show({ kind: 'discard', fileName: '' }).text).toContain('無題');
  });
});

describe('復元の確認', () => {
  const request: DialogRequest = {
    kind: 'recover',
    fileName: 'b.uodia',
    savedAt: '2026-07-26T10:00:00.000Z',
  };

  it('復元と破棄の 2 択を出す', () => {
    expect(show(request).labels).toEqual(['復元する', '破棄する']);
  });

  it.each([
    ['復元する', 'recover'],
    ['破棄する', 'discard'],
  ] as const)('「%s」は %s を返す', (label, answer) => {
    const dialog = show(request);
    dialog.click(label);
    expect(dialog.answers).toEqual([answer]);
  });

  it('**未保存になることを先に伝える**（保存先を選び直させるため）', () => {
    expect(show(request).text).toContain('未保存');
  });

  it('読めない時刻はそのまま出す', () => {
    // 「いつの内容か」を伝えられないより、生の値でも出したほうが手がかりになる。
    expect(show({ ...request, savedAt: 'こわれている' }).text).toContain('こわれている');
  });
});

describe('伝えるだけの問い', () => {
  it('警告は id・本文・該当箇所を並べる', () => {
    const dialog = show({
      kind: 'warnings',
      warnings: [
        { id: 'W-01', message: 'めっせーじ', path: 'meta.routeVersion' },
        { id: 'W-05', message: 'ぱすなし' },
      ],
    });
    expect(dialog.text).toContain('W-01: めっせーじ（meta.routeVersion）');
    expect(dialog.text).toContain('W-05: ぱすなし');
  });

  it.each([
    ['警告', { kind: 'warnings', warnings: [] } satisfies DialogRequest],
    ['失敗', { kind: 'error', message: 'だめでした' } satisfies DialogRequest],
  ])('%s の「閉じる」は cancel を返す（選択は無い）', (_name, request) => {
    const dialog = show(request);
    expect(dialog.labels).toEqual(['閉じる']);
    dialog.click('閉じる');
    expect(dialog.answers).toEqual(['cancel']);
  });

  it('失敗の内容をそのまま見せる', () => {
    expect(show({ kind: 'error', message: 'だめでした' }).text).toContain('だめでした');
  });
});

describe('問いが無いとき', () => {
  it('何も出さない', () => {
    expect(show(null).labels).toEqual([]);
  });
});
