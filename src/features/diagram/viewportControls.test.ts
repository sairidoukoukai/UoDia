// @vitest-environment jsdom

/**
 * 送りと拡げの結線の検証（T-27）。
 *
 * 計算そのものは `interaction.test.ts` が見る。ここで確かめるのは
 * **DOM の出来事が正しく計算へ渡り、後始末が済むか**である。とりわけ
 * <kbd>Ctrl</kbd>+ホイールを止めそこねると、ダイヤではなくブラウザが拡大する。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import routeJson from '../../../data/route.json?raw';
import { createProject } from '@/domain/io';
import { loadNetworkDef, type NetworkIndex } from '@/domain/network';
import { fromHM } from '@/domain/time';
import { createAppStore } from '@/store';
import type { SceneTheme } from './scene';
import { attachViewportControls } from './viewportControls';

const loaded = loadNetworkDef(routeJson);
if (!loaded.ok) throw new Error('route.json を読み込めません');
const network: NetworkIndex = loaded.network;

const theme: SceneTheme = {
  background: '#ffffff',
  axis: '#cccccc',
  grid: '#e4e4e4',
  gridFaint: '#f0f0f0',
  label: '#666666',
};

let store: ReturnType<typeof createAppStore>;
let canvas: HTMLCanvasElement;
let detach: () => void;

/** jsdom の要素は大きさを持たない。視野の計算に要るため与える。 */
function sizeOf(element: HTMLElement, width: number, height: number): void {
  Object.defineProperty(element, 'clientWidth', { value: width, configurable: true });
  Object.defineProperty(element, 'clientHeight', { value: height, configurable: true });
}

const view = () => store.getState().project?.view.diagram;

beforeEach(() => {
  store = createAppStore();
  store.getState().setNetworkDef(network.def);
  store.getState().setProject(createProject(network, { now: new Date('2026-01-01T00:00:00Z') }));

  document.body.replaceChildren();
  canvas = document.createElement('canvas');
  // 画面では React が付ける（`DiagramCanvas.tsx`）。焦点を受け取れないと
  // キーボードの操作が届かない。
  canvas.tabIndex = 0;
  sizeOf(canvas, 1000, 420);
  document.body.append(canvas);
  detach = attachViewportControls({ canvas, store, theme });
});

function wheel(init: WheelEventInit): WheelEvent {
  const event = new WheelEvent('wheel', { cancelable: true, ...init });
  canvas.dispatchEvent(event);
  return event;
}

/** jsdom には `PointerEvent` が無い。届く値は `MouseEvent` と同じである。 */
function pointer(type: string, init: MouseEventInit, on: EventTarget = canvas): void {
  on.dispatchEvent(new MouseEvent(type, { cancelable: true, bubbles: true, ...init }));
}

function key(type: 'keydown' | 'keyup', init: KeyboardEventInit): KeyboardEvent {
  const event = new KeyboardEvent(type, { cancelable: true, bubbles: true, ...init });
  canvas.dispatchEvent(event);
  return event;
}

describe('ホイール', () => {
  it('**Ctrl + ホイールを既定の動作に渡さない**（ブラウザごと拡大させない）', () => {
    const event = wheel({ deltaY: -100, ctrlKey: true, clientX: 500, clientY: 200 });

    expect(event.defaultPrevented).toBe(true);
    expect(view()?.pxPerMinute).toBeGreaterThan(3);
  });

  it('修飾の無いホイールも既定の動作に渡さない（ページが動かない）', () => {
    expect(wheel({ deltaY: 100 }).defaultPrevented).toBe(true);
  });

  it('Shift + ホイールで横に送る', () => {
    wheel({ deltaY: 90, shiftKey: true });
    expect(view()?.scrollTime).toBe(fromHM(7, 30));
  });

  it('macOS の Cmd も拡大縮小として扱う', () => {
    wheel({ deltaY: -100, metaKey: true, clientX: 500 });
    expect(view()?.pxPerMinute).toBeGreaterThan(3);
  });

  it('**動かないときは状態を書き換えない**（描き直しを起こさない）', () => {
    const before = store.getState().project;
    // 既定では 7:00 が左端であり、それより前へは送れない。
    wheel({ deltaY: -90, shiftKey: true });

    expect(store.getState().project).toBe(before);
  });
});

describe('掴んで動かす', () => {
  it('**中ボタンの引きずりで送る**', () => {
    store
      .getState()
      .setDiagramView({ ...store.getState().project!.view.diagram, scrollTime: fromHM(10, 0) });

    pointer('pointerdown', { button: 1, clientX: 500, clientY: 200 });
    pointer('pointermove', { clientX: 590, clientY: 200 }, window);

    expect(view()?.scrollTime).toBe(fromHM(9, 30));
  });

  it('左ボタンだけでは送らない（T-28 の選択のために空けてある）', () => {
    pointer('pointerdown', { button: 0, clientX: 500, clientY: 200 });
    pointer('pointermove', { clientX: 400, clientY: 200 }, window);

    expect(view()?.scrollTime).toBe(fromHM(7, 0));
  });

  it('**スペースを押している間は左ボタンでも送れる**', () => {
    key('keydown', { key: ' ' });
    pointer('pointerdown', { button: 0, clientX: 500, clientY: 200 });
    pointer('pointermove', { clientX: 410, clientY: 200 }, window);

    expect(view()?.scrollTime).toBe(fromHM(7, 30));
  });

  it('**canvas の外で離しても引きずりが終わる**', () => {
    pointer('pointerdown', { button: 1, clientX: 500, clientY: 200 });
    pointer('pointerup', {}, window);
    pointer('pointermove', { clientX: 100, clientY: 200 }, window);

    expect(view()?.scrollTime).toBe(fromHM(7, 0));
  });

  it('掴んでいるあいだは掌の形にする', () => {
    key('keydown', { key: ' ' });
    expect(canvas.style.cursor).toBe('grab');

    pointer('pointerdown', { button: 0, clientX: 500, clientY: 200 });
    expect(canvas.style.cursor).toBe('grabbing');

    pointer('pointerup', {}, window);
    expect(canvas.style.cursor).toBe('grab');

    key('keyup', { key: ' ' });
    expect(canvas.style.cursor).toBe('');
  });

  it('**焦点を失ったら押しっぱなしの記憶を捨てる**', () => {
    key('keydown', { key: ' ' });
    canvas.dispatchEvent(new FocusEvent('blur'));

    pointer('pointerdown', { button: 0, clientX: 500, clientY: 200 });
    pointer('pointermove', { clientX: 400, clientY: 200 }, window);

    expect(view()?.scrollTime).toBe(fromHM(7, 0));
    expect(canvas.style.cursor).toBe('');
  });

  it('押すと焦点が移る（キーボードの操作が届くようになる）', () => {
    pointer('pointerdown', { button: 0, clientX: 10, clientY: 10 });
    expect(document.activeElement).toBe(canvas);
  });
});

describe('既定に戻す', () => {
  it('**Ctrl+0 はここでは受けない**（ショートカットの定義は 1 か所。T-37）', () => {
    wheel({ deltaY: -300, ctrlKey: true, clientX: 500 });
    const zoomed = view()?.pxPerMinute;

    const event = key('keydown', { key: '0', ctrlKey: true });

    // canvas に焦点があるときだけ 2 回走る、という食い違いを作らない。
    expect(event.defaultPrevented).toBe(false);
    expect(view()?.pxPerMinute).toBe(zoomed);
  });
});
describe('繋ぎを解く', () => {
  it('**解いたあとは何も起きない**', () => {
    detach();
    const before = store.getState().project;

    wheel({ deltaY: -100, ctrlKey: true, clientX: 500 });
    pointer('pointerdown', { button: 1, clientX: 500, clientY: 200 });
    pointer('pointermove', { clientX: 400, clientY: 200 }, window);
    key('keydown', { key: '0', ctrlKey: true });

    expect(store.getState().project).toBe(before);
  });

  it('窓に張った受け口も外す', () => {
    const remove = vi.spyOn(window, 'removeEventListener');
    detach();

    expect(remove).toHaveBeenCalledWith('pointermove', expect.anything());
    expect(remove).toHaveBeenCalledWith('pointerup', expect.anything());
  });
});

describe('プロジェクトを開いていないとき', () => {
  it('何も起きない（落ちない）', () => {
    store.getState().setProject(null);

    expect(() => {
      wheel({ deltaY: -100, ctrlKey: true, clientX: 500 });
      pointer('pointerdown', { button: 1, clientX: 500, clientY: 200 });
      pointer('pointermove', { clientX: 400, clientY: 200 }, window);
    }).not.toThrow();
  });
});
