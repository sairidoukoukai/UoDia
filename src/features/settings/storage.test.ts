/**
 * 設定の保存と読み出しの検証（T-39、仕様書 §6.5）。
 *
 * **開いているファイルに依存しない**ことと、**読めなくても起動できる**ことを
 * 確かめる。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppStore, type AppStoreHook } from '@/store';
import { loadSettings, persistedOf, watchSettings } from './storage';

let store: AppStoreHook;
let stored: string | null;
let platform: {
  readSettings: () => Promise<string | null>;
  writeSettings: (content: string) => Promise<void>;
};

beforeEach(() => {
  store = createAppStore();
  stored = null;
  platform = {
    readSettings: vi.fn(() => Promise.resolve(stored)),
    writeSettings: vi.fn((content: string) => {
      stored = content;
      return Promise.resolve();
    }),
  };
});

describe('保存する分', () => {
  it('**隠し設定を有効にしたことは含めない**（§6.5.4）', () => {
    store.getState().setSettings({ patternsUnlocked: true });

    expect(Object.keys(persistedOf(store)).sort()).toEqual([
      'backupIntervalMs',
      'defaultDiagramView',
      'patternStyles',
      'stopGridStyles',
      'theme',
    ]);
  });
});

describe('読み出し', () => {
  it('保存されている設定を当てる', async () => {
    stored = JSON.stringify({ theme: 'dark', backupIntervalMs: 600000 });
    await loadSettings({ platform, store });

    expect(store.getState().settings.theme).toBe('dark');
    expect(store.getState().settings.backupIntervalMs).toBe(600000);
  });

  it('**壊れていても起動できる**（既定に倒す）', async () => {
    stored = '{ こわれた';
    await loadSettings({ platform, store });

    expect(store.getState().settings.theme).toBe('system');
  });

  it('読めなくても起動できる', async () => {
    platform.readSettings = vi.fn(() => Promise.reject(new Error('読めません')));
    await loadSettings({ platform, store });

    expect(store.getState().settings.theme).toBe('system');
  });

  it('まだ保存していなければ既定のまま', async () => {
    await loadSettings({ platform, store });
    expect(store.getState().settings.theme).toBe('system');
  });
});

describe('書き出し', () => {
  it('設定が変わったら書く', () => {
    const stop = watchSettings({ platform, store });
    store.getState().setSettings({ theme: 'dark' });

    expect(platform.writeSettings).toHaveBeenCalledTimes(1);
    expect(stored).toContain('"theme": "dark"');
    stop();
  });

  it('**設定でない変更では書かない**（便を動かすたびにファイルへ触れない）', () => {
    const stop = watchSettings({ platform, store });
    store.getState().selectTrips(['t1']);
    store.getState().setSettings({ patternsUnlocked: true });

    expect(platform.writeSettings).not.toHaveBeenCalled();
    stop();
  });

  it('書けなくても編集は続けられる', () => {
    platform.writeSettings = vi.fn(() => Promise.reject(new Error('書けません')));
    const stop = watchSettings({ platform, store });

    expect(() => {
      store.getState().setSettings({ theme: 'light' });
    }).not.toThrow();
    stop();
  });

  it('止めれば書かなくなる', () => {
    const stop = watchSettings({ platform, store });
    stop();
    store.getState().setSettings({ theme: 'dark' });

    expect(platform.writeSettings).not.toHaveBeenCalled();
  });
});

/** 停留所の線種の上書き（#133、§6.5.3）。 */
describe('線種の上書き', () => {
  it('書いて読み直すと同じものが返る', async () => {
    const stop = watchSettings({ platform, store });
    store.getState().setSettings({ stopGridStyles: { '1_0': 'dashed' } });
    stop();

    await loadSettings({ platform, store });
    expect(store.getState().settings.stopGridStyles).toEqual({ '1_0': 'dashed' });
  });

  it('**足した順に関わらず同じバイト列になる**（同じ内容で書き込みを起こさない）', () => {
    const first = watchSettings({ platform, store });
    store.getState().setSettings({ stopGridStyles: { '1_0': 'dashed', '2_0': 'bold' } });
    const written = stored;
    store.getState().setSettings({ stopGridStyles: { '2_0': 'bold', '1_0': 'dashed' } });

    expect(stored).toBe(written);
    expect(platform.writeSettings).toHaveBeenCalledTimes(1);
    first();
  });

  it('**知らない線種が入っていても起動できる**（設定ごと既定に倒す）', async () => {
    stored = JSON.stringify({ stopGridStyles: { '1_0': 'とても太い線' } });
    await loadSettings({ platform, store });

    expect(store.getState().settings.stopGridStyles).toEqual({});
  });

  it('知らない停留所 ID はそのまま残す（route.json の改訂で消えうる）', async () => {
    stored = JSON.stringify({ stopGridStyles: { もう無い停留所: 'dashed' } });
    await loadSettings({ platform, store });

    expect(store.getState().settings.stopGridStyles).toEqual({ もう無い停留所: 'dashed' });
  });
});
