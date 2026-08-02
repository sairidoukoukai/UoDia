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
