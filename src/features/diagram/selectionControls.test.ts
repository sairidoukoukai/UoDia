// @vitest-environment jsdom

/**
 * 選択の結線の検証（T-28）。
 *
 * 当たり判定そのものは `selection.test.ts` が見る。ここで確かめるのは
 * **押し下げが選択に繋がるか**と、**送り（T-27）と取り合わないか**である。
 */

import { beforeEach, describe, expect, it } from 'vitest';
import routeJson from '../../../data/route.json?raw';
import { createProject } from '@/domain/io';
import type { Trip } from '@/domain/model';
import { loadNetworkDef, type NetworkIndex } from '@/domain/network';
import { fromHM } from '@/domain/time';
import { createAppStore } from '@/store';
import type { SceneTheme } from './scene';
import { attachSelectionControls } from './selectionControls';
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
  lane: '#f4f4f4',
};

let store: ReturnType<typeof createAppStore>;
let canvas: HTMLCanvasElement;
let detach: () => void;

function makeTrip(tripId: string, patternId: string, hm: readonly [number, number]): Trip {
  const pattern = network.patternIndex(patternId);
  if (pattern === undefined) throw new Error(`パターン ${patternId} がありません`);
  return {
    tripId,
    patternId,
    anchor: { stopId: pattern.originStopId, time: fromHM(hm[0], hm[1]) },
    blockId: 'A',
    pullOut: false,
    pullIn: false,
  };
}

function setTrips(trips: readonly Trip[]): void {
  store.getState().editProject('便を置く', (project) => {
    const [service] = project.services;
    if (service !== undefined) service.trips = [...trips];
  });
}

/** jsdom の要素は大きさを持たない。視野の計算に要るため与える。 */
function sizeOf(element: HTMLElement, width: number, height: number): void {
  Object.defineProperty(element, 'clientWidth', { value: width, configurable: true });
  Object.defineProperty(element, 'clientHeight', { value: height, configurable: true });
}

/** jsdom には `PointerEvent` が無い。届く値は `MouseEvent` と同じである。 */
function pointer(type: string, init: MouseEventInit, on: EventTarget = canvas): void {
  on.dispatchEvent(new MouseEvent(type, { cancelable: true, bubbles: true, ...init }));
}

const selected = (): readonly string[] => store.getState().ui.selectedTripIds;

/**
 * S1 の便（8:00 発）のスジ上の点。
 *
 * 豊中学舎（軸 0）8:00 = (324, 24) から コンベンションセンター前（軸 33）
 * 8:25 = (399, 222) へ下る線の中ほど。
 */
const ON_LINE = { clientX: 361, clientY: 123 };
/** どのスジからも遠い点。 */
const OFF_LINE = { clientX: 800, clientY: 380 };

beforeEach(() => {
  store = createAppStore();
  store.getState().setNetworkDef(network.def);
  store.getState().setProject(createProject(network, { now: new Date('2026-01-01T00:00:00Z') }));
  setTrips([makeTrip('t1', 'S1', [8, 0]), makeTrip('t2', 'T1', [9, 0])]);

  document.body.replaceChildren();
  canvas = document.createElement('canvas');
  canvas.tabIndex = 0;
  sizeOf(canvas, 1000, 420);
  document.body.append(canvas);
  detach = attachSelectionControls({ canvas, store, theme });
});

describe('クリックで選ぶ', () => {
  it('**スジを押すと選ばれる**', () => {
    pointer('pointerdown', { button: 0, ...ON_LINE });
    pointer('pointerup', ON_LINE, window);

    expect(selected()).toEqual(['t1']);
  });

  it('何も無い場所を押すと選択が解ける', () => {
    pointer('pointerdown', { button: 0, ...ON_LINE });
    pointer('pointerup', ON_LINE, window);

    pointer('pointerdown', { button: 0, ...OFF_LINE });
    pointer('pointerup', OFF_LINE, window);

    expect(selected()).toEqual([]);
  });

  it('**Ctrl + クリックで足す・外す**', () => {
    pointer('pointerdown', { button: 0, ...ON_LINE });
    pointer('pointerup', ON_LINE, window);

    // もう一度 Ctrl 付きで押すと外れる。
    pointer('pointerdown', { button: 0, ctrlKey: true, ...ON_LINE });
    pointer('pointerup', { ctrlKey: true, ...ON_LINE }, window);

    expect(selected()).toEqual([]);
  });

  it('右ボタンでは選ばない（コンテキストメニューは T-31）', () => {
    pointer('pointerdown', { button: 2, ...ON_LINE });
    pointer('pointerup', ON_LINE, window);

    expect(selected()).toEqual([]);
  });

  it('**わずかに動いてもクリックとして扱う**（指の震えで選択を消さない）', () => {
    pointer('pointerdown', { button: 0, ...ON_LINE });
    pointer('pointermove', { clientX: ON_LINE.clientX + 2, clientY: ON_LINE.clientY }, window);
    pointer('pointerup', { clientX: ON_LINE.clientX + 2, clientY: ON_LINE.clientY }, window);

    expect(selected()).toEqual(['t1']);
    expect(store.getState().ui.selectionRect).toBeNull();
  });
});

describe('矩形で囲む', () => {
  it('**囲んだ範囲のスジが選ばれる**', () => {
    pointer('pointerdown', { button: 0, clientX: 300, clientY: 10 });
    pointer('pointermove', { clientX: 450, clientY: 300 }, window);
    pointer('pointerup', { clientX: 450, clientY: 300 }, window);

    expect(selected()).toEqual(['t1']);
  });

  it('引きずっているあいだは枠が出る', () => {
    pointer('pointerdown', { button: 0, clientX: 300, clientY: 10 });
    pointer('pointermove', { clientX: 450, clientY: 300 }, window);

    const rect = store.getState().ui.selectionRect;
    expect(rect).not.toBeNull();
    expect(rect?.fromAxis).toBeLessThan(rect?.toAxis ?? 0);

    // 離せば消える。
    pointer('pointerup', { clientX: 450, clientY: 300 }, window);
    expect(store.getState().ui.selectionRect).toBeNull();
  });

  it('Ctrl を押していれば足す', () => {
    pointer('pointerdown', { button: 0, ...ON_LINE });
    pointer('pointerup', ON_LINE, window);

    // 9:00 発の豊中方面（t2）を囲む。
    pointer('pointerdown', { button: 0, ctrlKey: true, clientX: 500, clientY: 10 });
    pointer('pointermove', { ctrlKey: true, clientX: 700, clientY: 300 }, window);
    pointer('pointerup', { ctrlKey: true, clientX: 700, clientY: 300 }, window);

    expect([...selected()].sort()).toEqual(['t1', 't2']);
  });

  it('**焦点を失ったら枠を畳む**（枠だけが残らない）', () => {
    pointer('pointerdown', { button: 0, clientX: 300, clientY: 10 });
    pointer('pointermove', { clientX: 450, clientY: 300 }, window);
    canvas.dispatchEvent(new FocusEvent('blur'));

    expect(store.getState().ui.selectionRect).toBeNull();
  });
});

describe('ホバー', () => {
  it('**スジの上では指の形が変わる**', () => {
    pointer('pointermove', ON_LINE);
    expect(canvas.style.cursor).toBe('pointer');

    pointer('pointermove', OFF_LINE);
    expect(canvas.style.cursor).toBe('');
  });

  it('引きずっている最中は形を変えない', () => {
    pointer('pointerdown', { button: 0, ...OFF_LINE });
    pointer('pointermove', ON_LINE);

    expect(canvas.style.cursor).toBe('');
  });
});

describe('送り（T-27）と取り合わない', () => {
  beforeEach(() => {
    // 画面と同じ順に繋ぐ。押し下げは登録した順に届く。
    detach();
    const detachViewport = attachViewportControls({ canvas, store, theme });
    const detachSelection = attachSelectionControls({ canvas, store, theme });
    detach = () => {
      detachSelection();
      detachViewport();
    };
  });

  it('**スペース + 左ボタンの引きずりは送りになる**（選択にならない）', () => {
    canvas.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', cancelable: true }));

    pointer('pointerdown', { button: 0, clientX: 600, clientY: 200 });
    pointer('pointermove', { clientX: 500, clientY: 200 }, window);
    pointer('pointerup', { clientX: 500, clientY: 200 }, window);

    // 送りは効き、選択も枠も起きない。
    expect(store.getState().project?.view.diagram.scrollTime).toBeGreaterThan(fromHM(7, 0));
    expect(selected()).toEqual([]);
    expect(store.getState().ui.selectionRect).toBeNull();
  });

  it('中ボタンの引きずりも送りになる', () => {
    pointer('pointerdown', { button: 1, clientX: 600, clientY: 200 });
    pointer('pointermove', { clientX: 500, clientY: 200 }, window);
    pointer('pointerup', { clientX: 500, clientY: 200 }, window);

    expect(selected()).toEqual([]);
  });

  it('スペースを押していなければ左ボタンは選択に使える', () => {
    pointer('pointerdown', { button: 0, ...ON_LINE });
    pointer('pointerup', ON_LINE, window);

    expect(selected()).toEqual(['t1']);
  });
});

describe('繋ぎを解く', () => {
  it('解いたあとは何も起きない', () => {
    detach();

    pointer('pointerdown', { button: 0, ...ON_LINE });
    pointer('pointerup', ON_LINE, window);

    expect(selected()).toEqual([]);
  });
});

describe('プロジェクトを開いていないとき', () => {
  it('何も起きない（落ちない）', () => {
    store.getState().setProject(null);

    expect(() => {
      pointer('pointerdown', { button: 0, ...ON_LINE });
      pointer('pointermove', { clientX: 500, clientY: 300 }, window);
      pointer('pointerup', { clientX: 500, clientY: 300 }, window);
    }).not.toThrow();
  });
});
