/**
 * 最大化のショートカットの検証（T-32、仕様書 §6.4）。
 *
 * 窓に張った受け口が、押した鍵をストアの状態に変えるところまでを見る。どの鍵が
 * どちらを指すかは `layout.test.ts` が確かめている。
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { createAppStore, type AppStoreHook } from '@/store';
import { attachShortcuts } from './shortcuts';

/** 窓の代わり。張った受け口を呼び出せるようにする。 */
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

  /** 押された鍵を届ける。既定の動きを止めたかを返す。 */
  press(key: string, modifiers: Record<string, boolean> = { ctrlKey: true }): boolean {
    let prevented = false;
    const event = {
      key,
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      shiftKey: false,
      ...modifiers,
      preventDefault: () => {
        prevented = true;
      },
    };
    for (const listener of this.listeners) listener(event as unknown as Event);
    return prevented;
  }
}

let store: AppStoreHook;
let target: FakeTarget;
let detach: () => void;

beforeEach(() => {
  store = createAppStore();
  target = new FakeTarget();
  detach = attachShortcuts({ store, target });
});

describe('最大化のショートカット', () => {
  it('Ctrl+1 でダイヤグラム、Ctrl+2 で時刻表が最大化される', () => {
    target.press('1');
    expect(store.getState().ui.maximized).toBe('diagram');

    target.press('2');
    expect(store.getState().ui.maximized).toBe('timetable');
  });

  it('**もう一度押せば 2 分割に戻る**（押した先で行き止まりにならない）', () => {
    target.press('1');
    target.press('1');

    expect(store.getState().ui.maximized).toBeNull();
  });

  it('ブラウザのタブ切り替えに渡さない', () => {
    expect(target.press('1')).toBe(true);
  });

  it('関わりのない鍵には触れない', () => {
    expect(target.press('0')).toBe(false);
    expect(target.press('1', { ctrlKey: false })).toBe(false);
    expect(store.getState().ui.maximized).toBeNull();
  });

  it('繋ぎを解けば効かなくなる', () => {
    detach();
    expect(target.count).toBe(0);

    target.press('1');
    expect(store.getState().ui.maximized).toBeNull();
  });
});
