/**
 * Undo/Redo の検証（T-16、仕様書 §6.7）。
 *
 * 受入条件は 4 つ。
 *
 * 1. すべての編集操作について do → undo で元の状態に完全復帰する
 * 2. 連続入力が 1 回の undo でまとめて戻る
 * 3. 履歴上限を超えると最古のエントリが破棄される（→ `history.test.ts`）
 * 4. 区間所要時間の変更が undo できる
 *
 * `history.test.ts` が履歴の**規則**を、こちらが**実際に状態が戻ること**を
 * 受け持つ。
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import { createProject } from '@/domain/io';
import type { Project, Trip } from '@/domain/model';
import { loadNetworkDef, type NetworkIndex } from '@/domain/network';
import { fromHM } from '@/domain/time';
import { setTimeAt, timeAt } from '@/domain/trip';
import { MIN_HISTORY_LIMIT } from './history';
import {
  selectIsDirty,
  selectNetwork,
  selectRedoLabel,
  selectTrips,
  selectUndoLabel,
} from './selectors';
import { createAppStore, type AppStore, type AppStoreHook } from './store';

const routeJsonPath = fileURLToPath(new URL('../../data/route.json', import.meta.url));
const loaded = loadNetworkDef(readFileSync(routeJsonPath, 'utf8'));
if (!loaded.ok) throw new Error('route.json を読み込めません');
const network: NetworkIndex = loaded.network;

let counter = 0;

function makeTrip(patternId: string, hours: number, minutes: number): Trip {
  const pattern = network.patternIndex(patternId);
  if (pattern === undefined) throw new Error(`パターン ${patternId} がありません`);
  counter += 1;
  return {
    tripId: `t${String(counter)}`,
    patternId,
    anchor: { stopId: pattern.originStopId, time: fromHM(hours, minutes) },
    blockId: '1',
    pullOut: false,
    pullIn: false,
  };
}

function makeProject(trips: readonly Trip[]): Project {
  const project = createProject(network, { now: new Date('2026-07-26T00:00:00.000Z') });
  const [service] = project.services;
  if (service === undefined) throw new Error('既定のダイヤがありません');
  return { ...project, services: [{ ...service, trips: [...trips] }] };
}

let store: AppStoreHook;

function state(): AppStore {
  return store.getState();
}

/** 先頭の便。 */
function firstTrip(): Trip {
  const trip = selectTrips(state())[0];
  if (trip === undefined) throw new Error('便がありません');
  return trip;
}

beforeEach(() => {
  store = createAppStore();
  state().setSeedNetworkDef(network.def);
  state().setProject(makeProject([makeTrip('S1', 8, 0), makeTrip('T1', 9, 0)]));
});

describe('取り消しとやり直し', () => {
  it('取り消せるものが無ければ何も起きない', () => {
    expect(state().undo()).toBe(false);
    expect(state().redo()).toBe(false);
  });

  it('**編集して取り消すと元の状態に戻る**', () => {
    const before = state().project;

    state().editProject('文書名の変更', (project) => {
      project.document.name = '2026年度';
    });
    expect(state().project?.document.name).toBe('2026年度');

    expect(state().undo()).toBe(true);
    expect(state().project).toEqual(before);
  });

  it('取り消した編集をやり直せる', () => {
    state().editProject('文書名の変更', (project) => {
      project.document.name = '2026年度';
    });
    state().undo();
    expect(state().redo()).toBe(true);
    expect(state().project?.document.name).toBe('2026年度');
  });

  it('複数の編集を 1 つずつ順に戻す', () => {
    state().editProject('1回目', (project) => {
      project.document.name = 'あ';
    });
    state().editProject('2回目', (project) => {
      project.document.author = '山口';
    });

    state().undo();
    expect(state().project?.document.author).toBe('');
    expect(state().project?.document.name).toBe('あ');

    state().undo();
    expect(state().project?.document.name).toBe('');
  });

  it('**便の時刻の変更も戻る**（アンカーの置き換え）', () => {
    const original = timeAt(firstTrip(), '3_0', network);

    state().editProject('時刻の入力', (project) => {
      const trips = project.services[0]?.trips;
      const trip = trips?.[0];
      if (trips === undefined || trip === undefined) return;
      const moved = setTimeAt(trip, '3_0', fromHM(9, 30), network);
      if (moved !== null) trips[0] = moved;
    });
    expect(timeAt(firstTrip(), '3_0', network)).toBe(fromHM(9, 30));

    state().undo();
    expect(timeAt(firstTrip(), '3_0', network)).toBe(original);
    // アンカーが置き換わっていた点も含めて戻ること。
    expect(firstTrip().anchor?.stopId).toBe('1_0');
  });

  it('便の追加と削除も戻る', () => {
    state().editProject('便の追加', (project) => {
      project.services[0]?.trips.push(makeTrip('S1', 10, 0));
    });
    expect(selectTrips(state())).toHaveLength(3);

    state().undo();
    expect(selectTrips(state())).toHaveLength(2);

    state().redo();
    expect(selectTrips(state())).toHaveLength(3);
  });

  it('値が変わらない編集は履歴に載せない', () => {
    const name = state().project?.document.name ?? '';
    const result = state().editProject('何もしない', (project) => {
      project.document.name = name;
    });
    expect(result).toEqual({ ok: true, changed: false });
    expect(state().undo()).toBe(false);
  });

  it('プロジェクトが開かれていなければ何もしない', () => {
    state().setProject(null);
    expect(
      state().editProject('書き換え', (project) => {
        project.document.name = 'x';
      }),
    ).toEqual({ ok: true, changed: false });
  });

  it('取り消せる・やり直せる操作の名前を返す', () => {
    expect(selectUndoLabel(state())).toBeNull();
    expect(selectRedoLabel(state())).toBeNull();

    state().editProject('文書名の変更', (project) => {
      project.document.name = 'あ';
    });
    expect(selectUndoLabel(state())).toBe('文書名の変更');

    state().undo();
    expect(selectUndoLabel(state())).toBeNull();
    expect(selectRedoLabel(state())).toBe('文書名の変更');
  });
});

describe('連続入力のまとめ（受入条件）', () => {
  it('**同一セルへの連続入力が 1 回の取り消しでまとめて戻る**', () => {
    for (const name of ['2', '20', '202', '2026']) {
      state().editProject(
        '文書名の変更',
        (project) => {
          project.document.name = name;
        },
        'document.name',
      );
    }
    expect(state().project?.document.name).toBe('2026');

    state().undo();
    expect(state().project?.document.name).toBe('');
    expect(state().undo()).toBe(false);
  });

  it('まとめた操作はまとめてやり直せる', () => {
    for (const name of ['2', '20']) {
      state().editProject(
        '文書名の変更',
        (project) => {
          project.document.name = name;
        },
        'document.name',
      );
    }
    state().undo();
    state().redo();
    expect(state().project?.document.name).toBe('20');
  });

  it('別のセルに移れば別の段になる', () => {
    state().editProject(
      '文書名の変更',
      (project) => {
        project.document.name = 'あ';
      },
      'document.name',
    );
    state().editProject(
      '作成者の変更',
      (project) => {
        project.document.author = '山口';
      },
      'document.author',
    );

    state().undo();
    expect(state().project?.document.author).toBe('');
    expect(state().project?.document.name).toBe('あ');
  });
});

describe('履歴の上限（受入条件）', () => {
  it('**上限を超えると最古の操作から捨てる**', () => {
    state().setHistoryLimit(MIN_HISTORY_LIMIT);
    for (let i = 1; i <= 15; i += 1) {
      state().editProject(`${String(i)}回目`, (project) => {
        project.document.name = String(i);
      });
    }
    expect(state().history.past).toHaveLength(MIN_HISTORY_LIMIT);

    for (let i = 0; i < MIN_HISTORY_LIMIT; i += 1) state().undo();
    // 捨てられた 5 回ぶんは戻らない。5 回目の編集後の状態が最も古い。
    expect(state().project?.document.name).toBe('5');
    expect(state().undo()).toBe(false);
  });

  it('範囲外の段数は丸める', () => {
    state().setHistoryLimit(1);
    expect(state().history.limit).toBe(MIN_HISTORY_LIMIT);
  });
});

describe('ネットワーク定義の編集（受入条件）', () => {
  it('**区間所要時間の変更が undo できる**', () => {
    expect(selectNetwork(state())?.runMinutes('1_0', '2_0')).toBe(20);

    const result = state().editNetwork('区間所要時間の変更', (def) => {
      const segment = def.segments.find((s) => s.fromStopId === '1_0' && s.toStopId === '2_0');
      if (segment !== undefined) segment.runMinutes = 25;
    });
    expect(result).toEqual({ ok: true, changed: true });
    expect(selectNetwork(state())?.runMinutes('1_0', '2_0')).toBe(25);

    state().undo();
    expect(selectNetwork(state())?.runMinutes('1_0', '2_0')).toBe(20);
  });

  it('区間所要時間を変えると便の時刻も変わり、取り消しで戻る', () => {
    // 先頭の便は S1（豊中 1_0 → 吹田 3_0 の直行）。始発 8:00、区間 25 分で 8:25 着。
    expect(timeAt(firstTrip(), '3_0', network)).toBe(fromHM(8, 25));

    state().editNetwork('区間所要時間の変更', (def) => {
      const segment = def.segments.find((s) => s.fromStopId === '1_0' && s.toStopId === '3_0');
      if (segment !== undefined) segment.runMinutes = 30;
    });
    const edited = selectNetwork(state());
    if (edited === null) throw new Error('索引が組み立てられていません');
    expect(timeAt(firstTrip(), '3_0', edited)).toBe(fromHM(8, 30));

    state().undo();
    const restored = selectNetwork(state());
    if (restored === null) throw new Error('索引が組み立てられていません');
    expect(timeAt(firstTrip(), '3_0', restored)).toBe(fromHM(8, 25));
  });

  it('**規則を破る変更は何も変えずに指摘を返す**', () => {
    const before = state().project?.network;

    const result = state().editNetwork('区間所要時間の変更', (def) => {
      const segment = def.segments[0];
      // R-01: 5 の倍数であること。
      if (segment !== undefined) segment.runMinutes = 7;
    });

    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.issues.map((i) => i.rule)).toContain('R-01');
    expect(state().project?.network).toBe(before);
    expect(state().undo()).toBe(false);
  });

  it('ネットワーク定義が読み込まれていなければ何もしない', () => {
    const fresh = createAppStore();
    expect(
      fresh.getState().editNetwork('区間所要時間の変更', (def) => {
        def.version = 2;
      }),
    ).toEqual({ ok: true, changed: false });
  });

  it('**種を載せ直しても履歴は残る**（種は文書ではない。T-89）', () => {
    state().editProject('文書名の変更', (project) => {
      project.document.name = 'あ';
    });
    // 新規作成の出発点を差し替えただけであり、開いている文書は動いていない。
    state().setSeedNetworkDef(network.def);
    expect(state().undo()).toBe(true);
  });

  it('プロジェクトを開き直すと履歴を捨てる', () => {
    state().editProject('文書名の変更', (project) => {
      project.document.name = 'あ';
    });
    state().setProject(makeProject([]));
    expect(state().undo()).toBe(false);
  });

  it('履歴段数は読み込み直しても保たれる', () => {
    state().setHistoryLimit(MIN_HISTORY_LIMIT);
    state().setProject(makeProject([]));
    expect(state().history.limit).toBe(MIN_HISTORY_LIMIT);
    state().setSeedNetworkDef(network.def);
    expect(state().history.limit).toBe(MIN_HISTORY_LIMIT);
  });
});

describe('選択は編集ではない', () => {
  it('選択の変更は履歴に載らない', () => {
    state().selectTrips(['t1']);
    expect(state().undo()).toBe(false);
  });

  it('取り消しても選択はそのまま', () => {
    state().editProject('文書名の変更', (project) => {
      project.document.name = 'あ';
    });
    state().selectTrips(['t1']);
    state().undo();
    expect(state().ui.selectedTripIds).toEqual(['t1']);
  });
});

describe('直接の書き換えを塞ぐ', () => {
  it('**ストアは setState を持たない**', () => {
    expect('setState' in store).toBe(false);
  });

  it('購読と読み出しはできる', () => {
    const seen: string[] = [];
    const unsubscribe = store.subscribe((next) => {
      seen.push(next.project?.document.name ?? '');
    });

    state().editProject('文書名の変更', (project) => {
      project.document.name = 'あ';
    });
    unsubscribe();
    state().editProject('文書名の変更', (project) => {
      project.document.name = 'い';
    });

    expect(seen).toEqual(['あ']);
  });
});

describe('路線は文書の一部である（#235、T-89）', () => {
  it('**区間を変えると未保存になる**（受入条件）', () => {
    // **これが #235 で閉じた穴である。** `editNetwork` と `editProject` は元から
    // 同じ履歴に積まれていたのに、未保存の判定は `project` しか見ておらず、
    // 保存先が分かれていたぶんだけ漏れていた。
    expect(selectIsDirty(state())).toBe(false);

    state().editNetwork('区間所要時間の変更', (def) => {
      const segment = def.segments[0];
      if (segment !== undefined) segment.runMinutes += 5;
    });

    expect(selectIsDirty(state())).toBe(true);
  });

  it('**区間の変更を取り消すと保存済みに戻る**', () => {
    const before = state().project?.network.segments[0]?.runMinutes;

    state().editNetwork('区間所要時間の変更', (def) => {
      const segment = def.segments[0];
      if (segment !== undefined) segment.runMinutes += 5;
    });
    expect(state().undo()).toBe(true);

    // **値は戻る。** 未保存の印は戻らない——判定は参照で行っており（`selectIsDirty`）、
    // 取り消しは同じ値を持つ別の物を作る。便の編集を取り消したときと同じである。
    expect(state().project?.network.segments[0]?.runMinutes).toBe(before);
  });

  it('文書を開いていなければ路線も編集できない', () => {
    state().setProject(null);
    expect(
      state().editNetwork('区間の変更', (def) => {
        def.version += 1;
      }),
    ).toEqual({ ok: true, changed: false });
  });
});
