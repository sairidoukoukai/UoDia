// @vitest-environment jsdom

/**
 * 「いつ描くか」の検証（T-24、実装計画書 §3.4）。
 *
 * 受入条件の「**1 フレーム中に状態が複数回変化しても再描画は 1 回**」は、
 * 描く中身とは関わりがない。フレームの予約とストアの購読だけを差し替えて、
 * 描画の回数を数える。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import routeJson from '../../../data/route.json?raw';
import { createProject } from '@/domain/io';
import { loadNetworkDef, type NetworkIndex } from '@/domain/network';
import { createAppStore } from '@/store';
import { attachDiagram, type DiagramHostOptions } from './canvasHost';
import type { SceneTheme } from './scene';

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

/** フレームを手で進められる差し替え。 */
function fakeFrames() {
  const queued: (() => void)[] = [];
  return {
    requestFrame: (draw: () => void): number => {
      queued.push(draw);
      return queued.length;
    },
    cancelFrame: vi.fn<(handle: number) => void>(),
    /** 予約されている描画をすべて走らせる。 */
    run: (): void => {
      const pending = [...queued];
      queued.length = 0;
      for (const draw of pending) draw();
    },
    get pending(): number {
      return queued.length;
    },
  };
}

let store: ReturnType<typeof createAppStore>;
let canvas: HTMLCanvasElement;

beforeEach(() => {
  store = createAppStore();
  store.getState().setNetworkDef(network.def);
  store.getState().setProject(createProject(network, { now: new Date('2026-01-01T00:00:00Z') }));
  canvas = document.createElement('canvas');
});

/** 描画の回数を数えるだけの繋ぎ方。大きさの変化は手で起こす。 */
function attach(overrides: Partial<DiagramHostOptions> = {}) {
  const frames = fakeFrames();
  const paint = vi.fn();
  let resize: (() => void) | undefined;

  const detach = attachDiagram({
    canvas,
    store,
    theme,
    paint,
    requestFrame: frames.requestFrame,
    cancelFrame: frames.cancelFrame,
    observeSize: (_target, onResize) => {
      resize = onResize;
      return () => {
        resize = undefined;
      };
    },
    ...overrides,
  });

  return {
    frames,
    paint,
    detach,
    resize: (): void => {
      resize?.();
    },
    get observing(): boolean {
      return resize !== undefined;
    },
  };
}

describe('描画のきっかけ', () => {
  it('**繋いだ直後に 1 度描く**（開いた瞬間の画面が空にならない）', () => {
    const host = attach();
    expect(host.paint).not.toHaveBeenCalled();

    host.frames.run();
    expect(host.paint).toHaveBeenCalledTimes(1);
  });

  it('状態が変わると描き直す', () => {
    const host = attach();
    host.frames.run();

    store.getState().selectTrips(['t1']);
    host.frames.run();

    expect(host.paint).toHaveBeenCalledTimes(2);
  });

  it('**1 フレーム中に何度状態が変わっても描くのは 1 回**', () => {
    const host = attach();
    host.frames.run();
    host.paint.mockClear();

    store.getState().selectTrips(['t1']);
    store.getState().selectTrips(['t2']);
    store.getState().clearSelection();
    expect(host.frames.pending).toBe(1);

    host.frames.run();
    expect(host.paint).toHaveBeenCalledTimes(1);
  });

  it('描いたあとの変化は次のフレームで拾う', () => {
    const host = attach();
    host.frames.run();

    store.getState().selectTrips(['t1']);
    host.frames.run();
    store.getState().clearSelection();
    host.frames.run();

    expect(host.paint).toHaveBeenCalledTimes(3);
  });

  it('**大きさが変わると描き直す**（拡大率は変わらなくても視野が変わる）', () => {
    const host = attach();
    host.frames.run();
    host.paint.mockClear();

    host.resize();
    host.frames.run();
    expect(host.paint).toHaveBeenCalledTimes(1);
  });

  it('渡された色をそのまま使う', () => {
    const host = attach();
    host.frames.run();
    expect(host.paint).toHaveBeenCalledWith(canvas, store.getState(), theme);
  });
});

describe('繋ぎを解く', () => {
  it('**解いたあとは描かない**（外れた canvas に描き続けない）', () => {
    const host = attach();
    host.frames.run();
    host.paint.mockClear();

    host.detach();
    store.getState().selectTrips(['t1']);
    host.frames.run();

    expect(host.paint).not.toHaveBeenCalled();
  });

  it('大きさの監視も外す', () => {
    const host = attach();
    expect(host.observing).toBe(true);

    host.detach();
    expect(host.observing).toBe(false);
  });

  it('**予約済みのフレームを取り消す**', () => {
    const host = attach();
    host.detach();
    expect(host.frames.cancelFrame).toHaveBeenCalledTimes(1);
  });

  it('予約が無ければ取り消さない', () => {
    const host = attach();
    host.frames.run();
    host.detach();
    expect(host.frames.cancelFrame).not.toHaveBeenCalled();
  });
});
