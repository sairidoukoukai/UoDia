// @vitest-environment jsdom

/**
 * 上下 2 分割をストアごと通す検証（T-32、仕様書 §6.4）。
 *
 * 受入条件は「**境界のドラッグでリサイズでき、比率が保存・復元される**」で
 * ある。純関数（`layout.ts`）が正しくても、画面が掴んだ位置を渡し損ねたり、
 * プロジェクトに書き戻し損ねたりすれば、比率は残らない。ここでは本物のストアに
 * 繋ぎ、掴んで、動かして、`project.view` に残ることを見る。
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import routeJson from '../../../data/route.json?raw';
import { createProject } from '@/domain/io';
import { loadNetworkDef, type NetworkIndex } from '@/domain/network';
import { useAppStore } from '@/store';
import { SplitLayout } from './SplitLayout';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const loaded = loadNetworkDef(routeJson);
if (!loaded.ok) throw new Error('route.json を読み込めません');
const network: NetworkIndex = loaded.network;

/** 分割領域の高さ。jsdom は何も並べないため、測れる大きさを与える。 */
const AREA_TOP = 100;
const AREA_HEIGHT = 400;

let container: HTMLDivElement;
let root: Root;

function mount(): void {
  useAppStore.getState().setSeedNetworkDef(network.def);
  useAppStore
    .getState()
    .setProject(createProject(network, { now: new Date('2026-01-01T00:00:00Z') }));
  useAppStore.getState().setMaximizedPane(null);

  root = createRoot(container);
  act(() => {
    root.render(<SplitLayout top={<div>ダイヤグラム</div>} bottom={<div>時刻表</div>} />);
  });

  const area = container.querySelector('.split');
  if (area === null) throw new Error('分割領域が見つかりません');
  area.getBoundingClientRect = () =>
    ({ top: AREA_TOP, height: AREA_HEIGHT, bottom: AREA_TOP + AREA_HEIGHT }) as DOMRect;
}

function separator(): HTMLElement {
  const found = container.querySelector<HTMLElement>('[role="separator"]');
  if (found === null) throw new Error('境界が見つかりません');
  return found;
}

function pane(name: 'diagram' | 'timetable'): HTMLElement {
  const found = container.querySelector<HTMLElement>(`.split__pane--${name}`);
  if (found === null) throw new Error(`${name} の枠が見つかりません`);
  return found;
}

function ratio(): number | undefined {
  return useAppStore.getState().project?.view.splitRatio;
}

/** jsdom には `PointerEvent` が無い。届く値は `MouseEvent` と同じである。 */
function pointer(type: string, init: MouseEventInit, on: EventTarget = window): void {
  act(() => {
    on.dispatchEvent(new MouseEvent(type, { cancelable: true, bubbles: true, ...init }));
  });
}

/** 境界を掴んで `clientY` まで動かし、離す。 */
function drag(clientY: number, options: { readonly release?: boolean } = {}): void {
  pointer('pointerdown', { button: 0, clientY: AREA_TOP + 240 }, separator());
  pointer('pointermove', { clientY });
  if (options.release !== false) pointer('pointerup', {});
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  mount();
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
});

describe('境界のドラッグ', () => {
  it('**引きずった位置が比率になり、プロジェクトに残る**（開き直して再現される）', () => {
    expect(ratio()).toBe(0.6);

    drag(AREA_TOP + 100);

    expect(ratio()).toBe(0.25);
    // 保存すればファイルに入る。ここが `ui` だと、開き直したときに戻らない。
    expect(useAppStore.getState().file.savedProject?.view.splitRatio).toBe(0.25);
  });

  it('比率がそのまま枠の高さになる', () => {
    drag(AREA_TOP + 100);

    expect(pane('diagram').style.flexGrow).toBe('0.25');
    expect(pane('timetable').style.flexGrow).toBe('0.75');
  });

  it('離した後は動かない', () => {
    drag(AREA_TOP + 100);
    pointer('pointermove', { clientY: AREA_TOP + 300 });

    expect(ratio()).toBe(0.25);
  });

  it('画面の外で離しても引きずりが残らない', () => {
    drag(AREA_TOP + 100, { release: false });
    pointer('pointercancel', {});
    pointer('pointermove', { clientY: AREA_TOP + 300 });

    expect(ratio()).toBe(0.25);
  });

  it('**どちらかを潰しきれない**（戻せない画面を作らない）', () => {
    drag(AREA_TOP + AREA_HEIGHT + 500);

    expect(ratio()).toBe(0.9);
    expect(pane('timetable').className).not.toContain('collapsed');
  });

  it('右ボタンでは掴まない', () => {
    pointer('pointerdown', { button: 2, clientY: AREA_TOP + 240 }, separator());
    pointer('pointermove', { clientY: AREA_TOP + 100 });

    expect(ratio()).toBe(0.6);
  });
});

describe('キーボード', () => {
  it('矢印で境界を動かせる（§9.4）', () => {
    act(() => {
      separator().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    });
    expect(ratio()).toBe(0.55);

    act(() => {
      separator().dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    });
    expect(ratio()).toBe(0.1);
  });

  it('今どこにあるかを読み上げられる', () => {
    expect(separator().getAttribute('aria-valuenow')).toBe('60');
    expect(separator().getAttribute('aria-valuemin')).toBe('10');
    expect(separator().getAttribute('aria-valuemax')).toBe('90');
    expect(separator().getAttribute('aria-orientation')).toBe('horizontal');
  });
});

describe('最大化', () => {
  it('**隠れた側には焦点も読み上げも届かない**（display: none）', () => {
    act(() => {
      useAppStore.getState().setMaximizedPane('diagram');
    });

    expect(pane('timetable').className).toContain('split__pane--collapsed');
    expect(pane('diagram').className).not.toContain('collapsed');
    // 分ける相手が画面に無い間は、掴む所も出さない。
    expect(container.querySelector('[role="separator"]')).toBeNull();
  });

  it('**戻せば元の比率に戻る**（最大化は比率を書き換えていない）', () => {
    drag(AREA_TOP + 100);

    act(() => {
      useAppStore.getState().setMaximizedPane('timetable');
    });
    expect(ratio()).toBe(0.25);

    act(() => {
      useAppStore.getState().setMaximizedPane(null);
    });
    expect(pane('diagram').style.flexGrow).toBe('0.25');
  });
});
