// @vitest-environment jsdom

/**
 * 選択への追随の結線の検証（T-38、仕様書 §6.3.1）。
 *
 * 寄せるかどうかの計算は `reveal.test.ts` が見る。ここで確かめるのは
 * **選択が変わったときにだけ動くか**である。状態が変わるたびに寄せ直すと、
 * 便を 1 つ動かすたびに視野が飛ぶ。
 */

import { beforeEach, describe, expect, it } from 'vitest';
import routeJson from '../../../data/route.json?raw';
import { createProject } from '@/domain/io';
import type { Project, Trip } from '@/domain/model';
import { loadNetworkDef, type NetworkIndex } from '@/domain/network';
import { fromHM } from '@/domain/time';
import { createAppStore } from '@/store';
import { attachSelectionReveal } from './revealControls';
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

function makeTrip(tripId: string, hours: number): Trip {
  const pattern = network.patternIndex('S1');
  if (pattern === undefined) throw new Error('S1 がありません');
  return {
    tripId,
    patternId: 'S1',
    anchor: { stopId: pattern.originStopId, time: fromHM(hours, 0) },
    blockId: 'A',
    pullOut: false,
    pullIn: false,
  };
}

function makeProject(trips: readonly Trip[]): Project {
  const project = createProject(network, { now: new Date('2026-01-01T00:00:00Z') });
  const [service] = project.services;
  if (service === undefined) throw new Error('既定のダイヤがありません');
  return { ...project, services: [{ ...service, trips: [...trips] }] };
}

let store: ReturnType<typeof createAppStore>;
let canvas: HTMLCanvasElement;
let detach: () => void;

/** jsdom の要素は大きさを持たない。視野の計算に要るため与える。 */
function sizeOf(element: HTMLElement, width: number, height: number): void {
  Object.defineProperty(element, 'clientWidth', { value: width, configurable: true });
  Object.defineProperty(element, 'clientHeight', { value: height, configurable: true });
}

const scrollTime = (): number | undefined => store.getState().project?.view.diagram.scrollTime;

beforeEach(() => {
  store = createAppStore();
  store.getState().setNetworkDef(network.def);
  // 8:00（画面の中）と 13:00（右の外）の 2 便。
  store.getState().setProject(makeProject([makeTrip('t1', 8), makeTrip('t2', 13)]));

  document.body.replaceChildren();
  canvas = document.createElement('canvas');
  sizeOf(canvas, 1000, 420);
  document.body.append(canvas);
  detach = attachSelectionReveal({ canvas, store, theme });
});

describe('選択への追随', () => {
  it('画面の外の便を選ぶと、そこまで送る', () => {
    const before = scrollTime();
    store.getState().selectTrips(['t2']);

    expect(scrollTime()).not.toBe(before);
    expect(scrollTime()).toBeGreaterThan(fromHM(12, 0));
  });

  it('画面の中の便を選んでも動かない（見比べている画面を飛ばさない）', () => {
    const before = scrollTime();
    store.getState().selectTrips(['t1']);

    expect(scrollTime()).toBe(before);
  });

  it('**選択が変わらないかぎり動かない**（便を動かしても視野は据え置き）', () => {
    store.getState().selectTrips(['t2']);
    const settled = scrollTime();

    store.getState().editProject('時刻の入力', (project) => {
      const trip = project.services[0]?.trips[0];
      if (trip?.anchor != null) trip.anchor = { ...trip.anchor, time: fromHM(9, 0) };
    });

    expect(scrollTime()).toBe(settled);
  });

  it('**寄せたあとは止まる**（受入条件：無限ループしない）', () => {
    let writes = 0;
    const unsubscribe = store.subscribe(() => {
      writes += 1;
    });

    store.getState().selectTrips(['t2']);
    unsubscribe();

    // 選択の書き込みと、視野の書き込みの 2 回で落ち着く。
    expect(writes).toBe(2);
  });

  it('選択を解いても動かない', () => {
    store.getState().selectTrips(['t2']);
    const settled = scrollTime();

    store.getState().clearSelection();

    expect(scrollTime()).toBe(settled);
  });

  it('繋ぎを解けば追随しない', () => {
    detach();
    const before = scrollTime();

    store.getState().selectTrips(['t2']);

    expect(scrollTime()).toBe(before);
  });
});
