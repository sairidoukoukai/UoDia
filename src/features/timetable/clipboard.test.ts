/**
 * 便の写し・切り取り・貼り付けの検証（T-53／T-37、仕様書 §6.1.4、§8.1）。
 *
 * 画面を組まずにストアの上で確かめる。**この操作は時刻表の持ち物ではない**
 * ——選択はダイヤグラムと 1 つであり（§6.3.1）、どちらに焦点があっても同じ
 * ことが起きる。
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import { createProject } from '@/domain/io';
import type { Trip } from '@/domain/model';
import { loadNetworkDef, type NetworkIndex } from '@/domain/network';
import { fromHM } from '@/domain/time';
import { createAppStore, selectTrips, type AppStoreHook } from '@/store';
import { copySelection, cutSelection, pasteClipboard } from './clipboard';

const routeJsonPath = fileURLToPath(new URL('../../../data/route.json', import.meta.url));
const loaded = loadNetworkDef(readFileSync(routeJsonPath, 'utf8'));
if (!loaded.ok) throw new Error('route.json を読み込めません');
const network: NetworkIndex = loaded.network;

let store: AppStoreHook;

function makeTrip(tripId: string, hours: number, blockId = 'A'): Trip {
  const pattern = network.patternIndex('S1');
  if (pattern === undefined) throw new Error('パターン S1 がありません');
  return {
    tripId,
    patternId: 'S1',
    anchor: { stopId: pattern.originStopId, time: fromHM(hours, 0) },
    blockId,
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

const trips = (): readonly Trip[] => selectTrips(store.getState());
const selected = (): readonly string[] => store.getState().ui.selectedTripIds;

beforeEach(() => {
  store = createAppStore();
  store.getState().setNetworkDef(network.def);
  store.getState().setProject(createProject(network, { now: new Date('2026-01-01T00:00:00Z') }));
  setTrips([makeTrip('t1', 8), makeTrip('t2', 9, 'B')]);
});

describe('写す', () => {
  it('選んだ便を写し、**何本写したかを言葉で返す**（画面が変わらないため）', () => {
    store.getState().selectTrips(['t1']);

    expect(copySelection(store)).toBe('1 便を写しました');
    expect(store.getState().ui.clipboard.map((trip) => trip.tripId)).toEqual(['t1']);
  });

  it('選んでいなければ何もしない', () => {
    expect(copySelection(store)).toBeNull();
    expect(store.getState().ui.clipboard).toEqual([]);
  });

  it('**写すことは編集ではない**（履歴に載らない）', () => {
    const before = store.getState().history.past.length;
    store.getState().selectTrips(['t1']);
    copySelection(store);

    expect(store.getState().history.past).toHaveLength(before);
  });
});

describe('切り取る', () => {
  it('写してから消す。選択も解ける', () => {
    store.getState().selectTrips(['t1']);

    expect(cutSelection(store)).toBe('1 便を切り取りました');
    expect(trips().map((trip) => trip.tripId)).toEqual(['t2']);
    expect(selected()).toEqual([]);
  });

  it('**取り消せば戻り、写したものは残る**（貼り直せる）', () => {
    store.getState().selectTrips(['t1']);
    cutSelection(store);
    store.getState().undo();

    expect(trips()).toHaveLength(2);
    expect(store.getState().ui.clipboard).toHaveLength(1);
  });

  it('選んでいなければ何もしない', () => {
    expect(cutSelection(store)).toBeNull();
    expect(trips()).toHaveLength(2);
  });
});

describe('貼る', () => {
  it('**同じ内容の便が増え、ID は振り直される**', () => {
    store.getState().selectTrips(['t1']);
    copySelection(store);

    expect(pasteClipboard(store)).toBeNull();
    expect(trips()).toHaveLength(3);

    const added = trips().at(-1);
    expect(added?.anchor).toEqual(trips()[0]?.anchor);
    expect(added?.tripId).not.toBe('t1');
  });

  it('貼った便が選ばれる（続けてずらせる）', () => {
    store.getState().selectTrips(['t1']);
    copySelection(store);
    pasteClipboard(store);

    expect(selected()).toEqual([trips().at(-1)?.tripId]);
  });

  it('写したものが無ければそう言う', () => {
    expect(pasteClipboard(store)).toBe('写した便がありません');
    expect(trips()).toHaveLength(2);
  });

  it('**1 回の取り消しで戻る**', () => {
    store.getState().selectTrips(['t1', 't2']);
    copySelection(store);
    pasteClipboard(store);
    store.getState().undo();

    expect(trips()).toHaveLength(2);
  });

  it('ダイヤが無ければ何もしない', () => {
    const empty = createAppStore();
    expect(copySelection(empty)).toBeNull();
    expect(cutSelection(empty)).toBeNull();
    expect(pasteClipboard(empty)).toBeNull();
  });
});
