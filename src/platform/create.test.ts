/**
 * 実装の選択の検証（T-13）。
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

const { createPlatform, isTauri } = await import('./create');

/** Tauri が注入する目印。 */
const MARKER = '__TAURI_INTERNALS__';

afterEach(() => {
  vi.unstubAllGlobals();
});

/** ブラウザの `window` を、目印の有無だけ差し替えて用意する。 */
function stubWindow(withMarker: boolean): void {
  vi.stubGlobal('window', withMarker ? { [MARKER]: {} } : {});
}

describe('isTauri', () => {
  it('目印があれば true', () => {
    stubWindow(true);
    expect(isTauri()).toBe(true);
  });

  it('目印が無ければ false', () => {
    stubWindow(false);
    expect(isTauri()).toBe(false);
  });

  it('window そのものが無い環境では false', () => {
    vi.stubGlobal('window', undefined);
    expect(isTauri()).toBe(false);
  });
});

describe('createPlatform', () => {
  it('Tauri の中ではデスクトップ版の実装を返す', async () => {
    stubWindow(true);
    expect((await createPlatform()).kind).toBe('tauri');
  });

  it('ブラウザでは Web 版の実装を返す', async () => {
    // File System Access API の有無に関わらず、Web 版の実装が選ばれる。
    // 対応状況の違いは capabilities で表す（実装は差し替えない）。
    stubWindow(false);
    expect((await createPlatform()).kind).toBe('web');
  });
});
