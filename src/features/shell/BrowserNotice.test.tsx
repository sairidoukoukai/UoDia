// @vitest-environment jsdom

/**
 * 対応していないブラウザへの案内の検証（T-42、仕様書 §10.4）。
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PlatformCapabilities } from '@/platform';
import { BrowserNotice } from './BrowserNotice';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

const ABLE: PlatformCapabilities = {
  saveInPlace: true,
  recentFiles: true,
  networkDefWritable: true,
};
const UNABLE: PlatformCapabilities = {
  saveInPlace: false,
  recentFiles: false,
  networkDefWritable: false,
};

function mount(kind: string, capabilities: PlatformCapabilities): void {
  root = createRoot(container);
  act(() => {
    root.render(<BrowserNotice kind={kind} capabilities={capabilities} />);
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

describe('出す場合', () => {
  it('**上書き保存できないブラウザには出す**（押す前に伝える）', () => {
    mount('web', UNABLE);

    expect(container.textContent).toContain('上書き保存ができません');
    expect(container.textContent).toContain('Chrome');
  });
});

describe('出さない場合', () => {
  it('上書き保存できるブラウザには出さない', () => {
    mount('web', ABLE);
    expect(container.textContent).toBe('');
  });

  it('**デスクトップ版には出さない**（伝えるべき制限が無い）', () => {
    mount('tauri', UNABLE);
    expect(container.textContent).toBe('');
  });

  it('一度閉じたら出さない（読まれない知らせを作らない）', () => {
    mount('web', UNABLE);
    act(() => {
      container.querySelector('button')?.click();
    });

    expect(container.textContent).toBe('');
  });
});
