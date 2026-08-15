/**
 * 停車パターンの編集の検証（T-36、仕様書 §6.5.4）。
 *
 * 受入条件の 1 つ——**区間表にない停留所対を含むパターンが保存できない**——は
 * `validateNetwork`（R-03）と `applyPatterns` の組み合わせで満たす。ここでは
 * 純関数と、当てたときに止まることを確かめる。
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import { createProject } from '@/domain/io';
import type { StopPattern, Trip } from '@/domain/model';
import { loadNetworkDef, validateNetwork, type NetworkIndex } from '@/domain/network';
import { fromHM } from '@/domain/time';
import { createAppStore, selectNetwork, type AppStoreHook } from '@/store';
import {
  affectedTripCount,
  changedPatternIds,
  duplicatedPattern,
  movedStop,
  patternRows,
  samePattern,
  withHandling,
  withPatterns,
  withStopAdded,
  withStopRemoved,
} from './patterns';
import { applyPatterns } from './settingsService';

const routeJsonPath = fileURLToPath(new URL('../../../data/route.json', import.meta.url));
const loaded = loadNetworkDef(readFileSync(routeJsonPath, 'utf8'));
if (!loaded.ok) throw new Error('route.json を読み込めません');
const network: NetworkIndex = loaded.network;

let store: AppStoreHook;

function patternOf(patternId: string): StopPattern {
  const found = network.findPattern(patternId);
  if (found === undefined) throw new Error(`パターン ${patternId} がありません`);
  return found;
}

function makeTrip(
  tripId: string,
  patternId: string,
  hours: number,
  extra: Partial<Trip> = {},
): Trip {
  const pattern = network.patternIndex(patternId);
  if (pattern === undefined) throw new Error(`パターン ${patternId} がありません`);
  return {
    tripId,
    patternId,
    anchor: { stopId: pattern.originStopId, time: fromHM(hours, 0) },
    blockId: 'A',
    pullOut: false,
    pullIn: false,
    ...extra,
  };
}

function setTrips(trips: readonly Trip[]): void {
  store.getState().editProject('便を置く', (project) => {
    const [service] = project.services;
    if (service !== undefined) service.trips = [...trips];
  });
}

beforeEach(() => {
  store = createAppStore();
  store.getState().setSeedNetworkDef(network.def);
  store.getState().setProject(createProject(network, { now: new Date('2026-01-01T00:00:00Z') }));
});

describe('一覧', () => {
  it('経路を略称でつないで出す', () => {
    const rows = patternRows([patternOf('S3')], network);

    expect(rows[0]?.path).toBe('豊中 → 箕面 → コンベ前 → 微研 → 工学部');
  });
});

describe('並びを直す（純関数）', () => {
  const s3 = (): StopPattern => patternOf('S3');

  it('上下に動かせる', () => {
    const moved = movedStop(s3(), 1, -1);
    expect(moved.stopSequence.map((stop) => stop.stopId)).toEqual([
      '2_0',
      '1_0',
      '3_0',
      '6_0',
      '4_0',
    ]);
  });

  it('端では動かさない', () => {
    expect(movedStop(s3(), 0, -1)).toEqual(s3());
    expect(movedStop(s3(), 4, 1)).toEqual(s3());
    expect(movedStop(s3(), 9, 1)).toEqual(s3());
  });

  it('停留所を足せる（末尾に付く）', () => {
    const added = withStopAdded(patternOf('M2'), '3_0', 'stop');
    expect(added.stopSequence.map((stop) => stop.stopId)).toEqual(['1_0', '2_0', '3_0']);
  });

  it('**同じ停留所は 2 回入れない**（アンカーの指し先が決まらなくなる。R-10）', () => {
    const twice = withStopAdded(patternOf('M2'), '2_0', 'stop');
    expect(twice.stopSequence).toHaveLength(2);
  });

  it('停留所を外せる', () => {
    const removed = withStopRemoved(s3(), 1);
    expect(removed.stopSequence.map((stop) => stop.stopId)).toEqual(['1_0', '3_0', '6_0', '4_0']);
    expect(withStopRemoved(s3(), 9)).toEqual(s3());
  });

  it('取扱区分を変えられる', () => {
    const changed = withHandling(s3(), 1, 'boardOnly');
    expect(changed.stopSequence[1]?.handling).toBe('boardOnly');
    expect(withHandling(s3(), 9, 'stop')).toEqual(s3());
  });

  it('**元のパターンは変わらない**', () => {
    const original = s3();
    movedStop(original, 1, -1);
    withStopRemoved(original, 0);

    expect(original.stopSequence).toHaveLength(5);
  });
});

describe('複製', () => {
  it('新しい ID を振り、**既定にはしない**（R-05）', () => {
    const copy = duplicatedPattern(patternOf('S3'), network.def.patterns);

    expect(copy.patternId).toBe('S3-1');
    expect(copy.isDefault).toBe(false);
    expect(copy.stopSequence).toEqual(patternOf('S3').stopSequence);
  });

  it('ID がぶつかれば次の番号を採る', () => {
    const first = duplicatedPattern(patternOf('S3'), network.def.patterns);
    const second = duplicatedPattern(patternOf('S3'), [...network.def.patterns, first]);

    expect(second.patternId).toBe('S3-2');
  });
});

describe('変わったパターン', () => {
  it('中身が同じなら数えない', () => {
    expect(samePattern(patternOf('S3'), patternOf('S3'))).toBe(true);
    expect(changedPatternIds(network.def.patterns, [...network.def.patterns])).toEqual([]);
  });

  it('並び・取扱区分・名前の違いを見つける', () => {
    const next = network.def.patterns.map((pattern) =>
      pattern.patternId === 'S3' ? withHandling(pattern, 1, 'boardOnly') : pattern,
    );

    expect(changedPatternIds(network.def.patterns, next)).toEqual(['S3']);
  });

  it('**消したパターンも数える**', () => {
    const next = network.def.patterns.filter((pattern) => pattern.patternId !== 'M2');
    expect(changedPatternIds(network.def.patterns, next)).toEqual(['M2']);
  });

  it('足したパターンも数える', () => {
    const copy = duplicatedPattern(patternOf('S3'), network.def.patterns);
    expect(changedPatternIds(network.def.patterns, [...network.def.patterns, copy])).toEqual([
      'S3-1',
    ]);
  });
});

describe('影響を受ける便の数（§6.5.4）', () => {
  it('そのパターンを使う便を数える', () => {
    setTrips([makeTrip('t1', 'S3', 8), makeTrip('t2', 'S1', 9), makeTrip('t3', 'S3', 10)]);
    const trips = store.getState().project?.services[0]?.trips ?? [];

    expect(affectedTripCount(trips, network, ['S3'])).toBe(2);
    expect(affectedTripCount(trips, network, [])).toBe(0);
  });

  it('**回送パターンは出入庫を付けた便に効く**（§6.1.7）', () => {
    setTrips([makeTrip('t1', 'S3', 8, { pullOut: true }), makeTrip('t2', 'S3', 9)]);
    const trips = store.getState().project?.services[0]?.trips ?? [];

    // 豊中学舎発の出庫は DT-out。付けた便だけが影響を受ける。
    expect(affectedTripCount(trips, network, ['DT-out'])).toBe(1);
  });
});

describe('保存できない編集（受入条件）', () => {
  /** 区間表に無い対（箕面 → 工学部）を作る。 */
  /**
   * 区間表に無い停留所対を作る。
   *
   * S3（豊中・箕面・コンベ前・微研・工学部）から箕面とコンベ前を抜くと
   * **豊中 → 微研** が残る。**この対は区間表に無い。**
   *
   * かつては箕面とコンベ前ではなく別の抜き方をしており、残る対が
   * `2_0 → 4_0`（箕面 → 工学部）だった。#247 で停留所間の回送を 6 通りに
   * 揃えたとき、**その対が区間表に入った**——テストが「無い対」として
   * 使えなくなった。
   */
  function withMissingSegment(): readonly StopPattern[] {
    return network.def.patterns.map((pattern) =>
      pattern.patternId === 'S3' ? withStopRemoved(withStopRemoved(pattern, 1), 1) : pattern,
    );
  }

  it('**R-03 が足りない区間を名指しする**', () => {
    const issues = validateNetwork(withPatterns(network.def, withMissingSegment()));
    const missing = issues.filter((issue) => issue.rule === 'R-03');

    expect(missing).toHaveLength(1);
    expect(missing[0]?.message).toContain('1_0→6_0');
  });

  it('**当てても状態は変わらない**（保存できない）', () => {
    const result = applyPatterns(store, withMissingSegment());

    expect(result.ok).toBe(false);
    expect(result.message).toContain('R-03');
    expect(selectNetwork(store.getState())?.findPattern('S3')?.stopSequence).toHaveLength(5);
    expect(store.getState().history.past).toHaveLength(0);
  });
});

describe('当てる', () => {
  it('取り消しで戻る', () => {
    const next = network.def.patterns.map((pattern) =>
      pattern.patternId === 'S3' ? { ...pattern, patternName: '直した名前' } : pattern,
    );

    expect(applyPatterns(store, next).ok).toBe(true);
    expect(selectNetwork(store.getState())?.findPattern('S3')?.patternName).toBe('直した名前');

    store.getState().undo();
    expect(selectNetwork(store.getState())?.findPattern('S3')?.patternName).toBe('箕面経由吹田');
  });

  it('変わっていなければ履歴に載せない', () => {
    const result = applyPatterns(store, [...network.def.patterns]);

    expect(result.ok).toBe(true);
    expect(store.getState().history.past).toHaveLength(0);
  });

  it('路線図を読み込んでいなければ何もしない', () => {
    expect(applyPatterns(createAppStore(), []).ok).toBe(false);
  });
});
