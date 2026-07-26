/**
 * ストアとセレクタの検証（T-15）。
 *
 * 受入条件は 2 つ。**派生値が状態に二重管理されていないこと**と、
 * **セレクタが不要な再描画を起こさないこと**。後者は「同じ状態から同じ参照が
 * 返る」「関係ない変更で参照が変わらない」という形で確かめる。
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import { createProject } from '@/domain/io';
import type { Project, Trip } from '@/domain/model';
import { loadNetworkDef, type NetworkIndex } from '@/domain/network';
import { fromHM } from '@/domain/time';
import { createAppStore, type AppStore } from './store';
import { APP_STATE_KEYS } from './types';
import {
  selectActiveDirectionTrips,
  selectActiveService,
  selectAllTripTimes,
  selectBlocks,
  selectIsDirty,
  selectSelectedTrips,
  selectTrips,
  selectTripsByDirection,
  selectValidation,
  selectVisibleStops,
} from './selectors';

const routeJsonPath = fileURLToPath(new URL('../../data/route.json', import.meta.url));
const loaded = loadNetworkDef(readFileSync(routeJsonPath, 'utf8'));
if (!loaded.ok) throw new Error('route.json を読み込めません');
const network: NetworkIndex = loaded.network;

let counter = 0;

function makeTrip(patternId: string, hours: number, minutes: number, blockId = '1'): Trip {
  const pattern = network.patternIndex(patternId);
  if (pattern === undefined) throw new Error(`パターン ${patternId} がありません`);
  counter += 1;
  return {
    tripId: `t${String(counter)}`,
    patternId,
    anchor: { stopId: pattern.originStopId, time: fromHM(hours, minutes) },
    blockId,
    tripShortName: '',
  };
}

function makeProject(trips: readonly Trip[]): Project {
  const project = createProject(network, { now: new Date('2026-07-26T00:00:00.000Z') });
  const [service] = project.services;
  if (service === undefined) throw new Error('既定のダイヤがありません');
  return { ...project, services: [{ ...service, trips: [...trips] }] };
}

type Store = ReturnType<typeof createAppStore>;

let store: Store;

/** 現在の状態。 */
function state(): AppStore {
  return store.getState();
}

beforeEach(() => {
  store = createAppStore();
  store.getState().setNetworkDef(network.def);
  store.getState().setProject(makeProject([makeTrip('S1', 8, 0), makeTrip('T1', 9, 0)]));
});

describe('状態の形', () => {
  it('**派生値を持たない**（運用・検証・時刻は状態に無い）', () => {
    const fresh = createAppStore().getState() as unknown as Record<string, unknown>;
    const keys = Object.keys(fresh).filter((key) => typeof fresh[key] !== 'function');
    expect(keys.sort()).toEqual([...APP_STATE_KEYS].sort());
  });

  it('表示設定は project.view にあり、ui には無い（二重管理を避ける）', () => {
    expect(Object.keys(state().ui)).toEqual(['selectedTripIds']);
    expect(state().project?.view.activeDirection).toBe(0);
  });

  it('初期状態では何も読み込まれていない', () => {
    const fresh = createAppStore().getState();
    expect(fresh.networkDef).toBeNull();
    expect(fresh.project).toBeNull();
    expect(fresh.ui.selectedTripIds).toEqual([]);
  });
});

describe('操作', () => {
  it('プロジェクトを差し替えると選択が消える', () => {
    state().selectTrips(['t1']);
    state().setProject(makeProject([]));
    expect(state().ui.selectedTripIds).toEqual([]);
  });

  it('選択を置き換えられる', () => {
    state().selectTrips(['a', 'b']);
    expect(state().ui.selectedTripIds).toEqual(['a', 'b']);
  });

  it('選択に加えられる（Ctrl + クリック）', () => {
    state().selectTrips(['a']);
    state().addToSelection('b');
    expect(state().ui.selectedTripIds).toEqual(['a', 'b']);
  });

  it('同じ便を二重に選ばない', () => {
    state().selectTrips(['a']);
    state().addToSelection('a');
    expect(state().ui.selectedTripIds).toEqual(['a']);
  });

  it('選択を空にできる', () => {
    state().selectTrips(['a']);
    state().clearSelection();
    expect(state().ui.selectedTripIds).toEqual([]);
  });

  it('プロジェクトを書き換えられる', () => {
    state().editProject('書き換え', (project) => {
      project.document.name = '2026年度';
    });
    expect(state().project?.document.name).toBe('2026年度');
  });

  it('プロジェクトが無ければ書き換えは何もしない', () => {
    state().setProject(null);
    expect(() => {
      state().editProject('書き換え', (project) => {
        project.document.name = 'x';
      });
    }).not.toThrow();
    expect(state().project).toBeNull();
  });

  it('プロジェクトを null にできる', () => {
    state().setProject(null);
    expect(state().project).toBeNull();
  });
});

describe('開いているファイル（T-17）', () => {
  it('新規作成の直後は保存済み', () => {
    expect(selectIsDirty(state())).toBe(false);
    expect(state().file.handle).toBeNull();
  });

  it('**編集すると未保存になる**', () => {
    state().editProject('文書名の変更', (project) => {
      project.document.name = 'あ';
    });
    expect(selectIsDirty(state())).toBe(true);
  });

  it('値が変わらない編集では未保存にならない', () => {
    const name = state().project?.document.name ?? '';
    state().editProject('何もしない', (project) => {
      project.document.name = name;
    });
    expect(selectIsDirty(state())).toBe(false);
  });

  it('保存を記録すると未保存が解ける', () => {
    state().editProject('文書名の変更', (project) => {
      project.document.name = 'あ';
    });
    const project = state().project;
    if (project === null) throw new Error('プロジェクトがありません');

    state().markSaved(project, { kind: 'memory', name: 'a.uodia', ref: 'a.uodia' });
    expect(selectIsDirty(state())).toBe(false);
    expect(state().file.handle?.name).toBe('a.uodia');
  });

  it('保存しても取り消しは残る（保存は編集ではない）', () => {
    state().editProject('文書名の変更', (project) => {
      project.document.name = 'あ';
    });
    const project = state().project;
    if (project === null) throw new Error('プロジェクトがありません');

    state().markSaved(project, null);
    expect(state().undo()).toBe(true);
  });

  it('取り消して保存した時点と別の内容になれば、また未保存になる', () => {
    const project = state().project;
    if (project === null) throw new Error('プロジェクトがありません');
    state().markSaved(project, null);

    state().editProject('文書名の変更', (p) => {
      p.document.name = 'あ';
    });
    expect(selectIsDirty(state())).toBe(true);
  });

  it('プロジェクトが無ければ未保存ではない', () => {
    state().setProject(null);
    expect(selectIsDirty(state())).toBe(false);
  });
});

describe('セレクタ — 取り出し', () => {
  it('編集中のダイヤを返す', () => {
    expect(selectActiveService(state())?.serviceId).toBe('weekday');
  });

  it('activeServiceId が指すダイヤを返す', () => {
    state().editProject('書き換え', (project) => {
      project.services.push({ serviceId: 'holiday', serviceName: '休日', trips: [] });
      project.view.activeServiceId = 'holiday';
    });
    expect(selectActiveService(state())?.serviceId).toBe('holiday');
  });

  it('指す先が無ければ先頭のダイヤに倒す', () => {
    state().editProject('書き換え', (project) => {
      project.view.activeServiceId = 'ない';
    });
    expect(selectActiveService(state())?.serviceId).toBe('weekday');
  });

  it('ダイヤが無ければ null', () => {
    state().editProject('書き換え', (project) => {
      project.services = [];
    });
    expect(selectActiveService(state())).toBeNull();
    expect(selectTrips(state())).toEqual([]);
  });

  it('プロジェクトが無ければ空', () => {
    state().setProject(null);
    expect(selectActiveService(state())).toBeNull();
    expect(selectTrips(state())).toEqual([]);
  });

  it('方向で絞り込める（方向は停車パターンが持つ）', () => {
    expect(selectTripsByDirection(state(), 0).map((t) => t.patternId)).toEqual(['S1']);
    expect(selectTripsByDirection(state(), 1).map((t) => t.patternId)).toEqual(['T1']);
  });

  it('表示中の方向の便を返す', () => {
    expect(selectActiveDirectionTrips(state()).map((t) => t.patternId)).toEqual(['S1']);
    state().editProject('書き換え', (project) => {
      project.view.activeDirection = 1;
    });
    expect(selectActiveDirectionTrips(state()).map((t) => t.patternId)).toEqual(['T1']);
  });

  it('ネットワーク定義が無ければ方向で絞れない', () => {
    const fresh = createAppStore();
    fresh.getState().setProject(makeProject([makeTrip('S1', 8, 0)]));
    expect(selectTripsByDirection(fresh.getState(), 0)).toEqual([]);
  });

  it('選択中の便を返す（並びは元の順）', () => {
    const trips = selectTrips(state());
    state().selectTrips([trips[1]?.tripId ?? '', trips[0]?.tripId ?? '']);
    expect(selectSelectedTrips(state())).toEqual([trips[0], trips[1]]);
  });

  it('選択が無ければ空', () => {
    expect(selectSelectedTrips(state())).toEqual([]);
  });

  it('表示する停留所を縦軸の順に返す（微研は除く）', () => {
    const stops = selectVisibleStops(state());
    expect(stops.map((s) => s.stopId)).toEqual(['1_0', '2_0', '3_0', '5_0', '4_0', '9_0']);
  });
});

describe('セレクタ — 派生値', () => {
  it('運用を導出する', () => {
    expect(selectBlocks(state())?.blocks.map((b) => b.blockId)).toEqual(['1']);
  });

  it('検証を実行する', () => {
    // 出庫回送も入庫回送も無い運用のため V-05 が 2 件出る
    expect(selectValidation(state()).map((i) => i.id)).toEqual(['V-05', 'V-05']);
  });

  it('便を繋がらない形にすると V-01 が出る', () => {
    state().editProject('書き換え', (project) => {
      const trips = project.services[0]?.trips;
      // 吹田着の次に、また豊中発の便を置く
      if (trips !== undefined) trips[1] = makeTrip('S1', 9, 0);
    });
    expect(selectValidation(state()).map((i) => i.id)).toContain('V-01');
  });

  it('検証の閾値を差し替えられる', () => {
    const strict = selectValidation(state(), {
      minHeadwayMinutes: 5,
      maxHeadwayMinutes: 120,
      minStandbyMinutes: 999,
    });
    expect(strict.length).toBeGreaterThan(0);
  });

  it('便ごとの全時刻を返す', () => {
    const times = selectAllTripTimes(state());
    const first = selectTrips(state())[0];
    expect(times.get(first?.tripId ?? '')?.get('1_0')).toBe(fromHM(8, 0));
  });

  it('ネットワーク定義が無ければ導出しない', () => {
    const fresh = createAppStore();
    fresh.getState().setProject(makeProject([makeTrip('S1', 8, 0)]));
    expect(selectBlocks(fresh.getState())).toBeNull();
    expect(selectValidation(fresh.getState())).toEqual([]);
    expect(selectAllTripTimes(fresh.getState()).size).toBe(0);
    expect(selectVisibleStops(fresh.getState())).toEqual([]);
  });
});

describe('参照の安定性（受入条件）', () => {
  it('**同じ状態からは同じ参照が返る**', () => {
    const current = state();
    expect(selectBlocks(current)).toBe(selectBlocks(current));
    expect(selectValidation(current)).toBe(selectValidation(current));
    expect(selectAllTripTimes(current)).toBe(selectAllTripTimes(current));
    expect(selectTripsByDirection(current, 0)).toBe(selectTripsByDirection(current, 0));
    expect(selectVisibleStops(current)).toBe(selectVisibleStops(current));
  });

  it('**選択を変えても派生値の参照は変わらない**（再描画を起こさない）', () => {
    const before = selectBlocks(state());
    const beforeTimes = selectAllTripTimes(state());

    state().selectTrips(['t1']);

    expect(selectBlocks(state())).toBe(before);
    expect(selectAllTripTimes(state())).toBe(beforeTimes);
  });

  it('関係ない項目を書き換えても便の配列の参照は変わらない（構造共有）', () => {
    const before = selectTrips(state());
    state().editProject('書き換え', (project) => {
      project.document.name = '別の名前';
    });
    expect(selectTrips(state())).toBe(before);
  });

  it('便を書き換えれば派生値の参照は変わる（古い値を返さない）', () => {
    const before = selectBlocks(state());
    state().editProject('書き換え', (project) => {
      const trip = project.services[0]?.trips[0];
      if (trip !== undefined) trip.blockId = '2';
    });
    expect(selectBlocks(state())).not.toBe(before);
    expect(selectBlocks(state())?.blocks.map((b) => b.blockId)).toEqual(['1', '2']);
  });

  it('選択が空のときは同じ空配列を返す', () => {
    expect(selectSelectedTrips(state())).toBe(selectSelectedTrips(state()));
  });

  it('方向が違えば別の結果を返す（記憶化が取り違えない）', () => {
    const outbound = selectTripsByDirection(state(), 0);
    const inbound = selectTripsByDirection(state(), 1);
    expect(outbound).not.toBe(inbound);
    expect(outbound.map((t) => t.patternId)).toEqual(['S1']);
  });
});
