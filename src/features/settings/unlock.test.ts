/**
 * 隠し設定の有効化の検証（T-36、仕様書 §6.5.4、§8.1）。
 *
 * 受入条件は「**通常操作では到達できない**」である。ここが確かめるのは、
 * その 1 つの組み合わせだけが開くこと——ほかの打鍵では開かないこと——である。
 * タブが出ないことは `SettingsDialog.test.tsx` が見る。
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { createAppStore, type AppStoreHook } from '@/store';
import { attachUnlock, isUnlockShortcut } from './unlock';

/** 押された鍵。修飾を省いて書けるようにする。 */
function key(
  value: string,
  modifiers: Partial<Record<'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey', boolean>> = {},
): Parameters<typeof isUnlockShortcut>[0] {
  return {
    key: value,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    ...modifiers,
  };
}

/** 窓の代わり。 */
class FakeTarget {
  private readonly listeners = new Set<EventListener>();

  readonly addEventListener = (_type: string, listener: EventListener): void => {
    this.listeners.add(listener);
  };

  readonly removeEventListener = (_type: string, listener: EventListener): void => {
    this.listeners.delete(listener);
  };

  get count(): number {
    return this.listeners.size;
  }

  press(value: string, modifiers: Record<string, boolean>): boolean {
    let prevented = false;
    const event = {
      ...key(value),
      ...modifiers,
      preventDefault: () => {
        prevented = true;
      },
    };
    for (const listener of this.listeners) listener(event as unknown as Event);
    return prevented;
  }
}

const ALL = { ctrlKey: true, shiftKey: true, altKey: true };

let store: AppStoreHook;
let target: FakeTarget;
let detach: () => void;

beforeEach(() => {
  store = createAppStore();
  target = new FakeTarget();
  detach = attachUnlock({ store, target });
});

describe('合図の見分け', () => {
  it('Ctrl+Shift+Alt+D だけを受け取る', () => {
    expect(isUnlockShortcut(key('d', ALL))).toBe(true);
    expect(isUnlockShortcut(key('D', ALL))).toBe(true);
    // macOS の Command でも同じ。
    expect(isUnlockShortcut(key('d', { metaKey: true, shiftKey: true, altKey: true }))).toBe(true);
  });

  it('**修飾が 1 つでも欠ければ受け取らない**（偶然に押されない数を課す）', () => {
    expect(isUnlockShortcut(key('d', { ctrlKey: true, shiftKey: true }))).toBe(false);
    expect(isUnlockShortcut(key('d', { ctrlKey: true, altKey: true }))).toBe(false);
    expect(isUnlockShortcut(key('d', { shiftKey: true, altKey: true }))).toBe(false);
    expect(isUnlockShortcut(key('d'))).toBe(false);
  });

  it('別の鍵では開かない', () => {
    expect(isUnlockShortcut(key('s', ALL))).toBe(false);
  });
});

describe('繋ぎ込み', () => {
  it('押すと開く', () => {
    expect(store.getState().settings.patternsUnlocked).toBe(false);

    expect(target.press('d', ALL)).toBe(true);
    expect(store.getState().settings.patternsUnlocked).toBe(true);
  });

  it('**もう一度押しても閉じない**（開いているつもりで閉じている状態を作らない）', () => {
    target.press('d', ALL);
    expect(target.press('d', ALL)).toBe(false);

    expect(store.getState().settings.patternsUnlocked).toBe(true);
  });

  it('関わりのない鍵には触れない', () => {
    expect(target.press('s', { ctrlKey: true })).toBe(false);
    expect(store.getState().settings.patternsUnlocked).toBe(false);
  });

  it('繋ぎを解けば効かなくなる', () => {
    detach();
    expect(target.count).toBe(0);

    target.press('d', ALL);
    expect(store.getState().settings.patternsUnlocked).toBe(false);
  });

  it('**起動のたびに閉じている**（覚えない）', () => {
    expect(createAppStore().getState().settings.patternsUnlocked).toBe(false);
  });
});
