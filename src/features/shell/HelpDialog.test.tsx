// @vitest-environment jsdom

/**
 * ヘルプの窓の検証（T-56、仕様書 v1.1 §3.1）。
 *
 * 確かめるのは**「UoDia について」に誰が作ったのかが出ること**である。
 * `tauri.conf.json` の `bundle.copyright` はインストーラと実行ファイルの
 * プロパティにしか載らず、**アプリを起動しているあいだ利用者の目に触れない。**
 * Web 版には bundle 設定そのものが無い。
 *
 * ショートカットの一覧は `commands.ts` の表から作られるため、ここでは見ない
 * （手で書き写した一覧が古くなる問題は `HelpDialog` 側で解いてある）。
 */

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HelpDialog } from './HelpDialog';
import { APP_VERSION, COPYRIGHT } from './version';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  // jsdom は showModal を実装していない。開閉はブラウザの責務であり、ここで
  // 確かめたいのは中身である（`FileDialogHost.test.tsx` と同じ扱い）。
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

/** 窓を描いて中身の文字を返す。 */
function render(topic: 'shortcuts' | 'about' | null): string {
  const root = createRoot(container);
  act(() => {
    root.render(<HelpDialog topic={topic} onClose={() => undefined} />);
  });
  const { textContent } = container;
  act(() => {
    root.unmount();
  });
  return textContent;
}

describe('UoDia について（T-56）', () => {
  it('**著作権表示が出る**', () => {
    expect(render('about')).toContain(COPYRIGHT);
  });

  it('団体名は「再履バス同好会」である', () => {
    // 「再履同好会」は誤り（#158）。定数の中身そのものを固定しておく。
    expect(COPYRIGHT).toBe('© 2026 再履バス同好会');
  });

  it('版数も併せて出る', () => {
    expect(render('about')).toContain(APP_VERSION);
  });

  it('免責は残っている', () => {
    expect(render('about')).toContain('大阪大学の公式なソフトウェアではありません');
  });
});

describe('出し分け', () => {
  it('ショートカットを出しているあいだ、著作権表示は出さない', () => {
    // 同じ窓を使い回すため、両方の中身が同時に出ていないことを固定する。
    expect(render('shortcuts')).not.toContain(COPYRIGHT);
  });

  it('閉じているときは何も出さない', () => {
    expect(render(null)).not.toContain(COPYRIGHT);
  });
});
