/**
 * ネットワーク定義の索引（仕様書 §5.2、§5.5）。
 *
 * `route.json` は配列の集まりであり、そのままでは停留所 1 件を引くのに線形探索が
 * 要る。便の時刻導出（T-08）は 1 便あたり停留所数ぶんの参照を行い、それが 100 便
 * ぶん、さらに再描画のたびに走る。**読込時に一度だけ**索引と累積所要時間を作り、
 * 以降は参照するだけにする。
 *
 * 累積所要時間は「分」で保持する。`Seconds` にしないのは、これが時刻ではなく
 * 時間差であり、5 分刻みの不変条件（§2.1）が課されるのは時刻の側だからである。
 * `Seconds` への変換は時刻を組み立てる T-08 の責務とする。
 *
 * 本モジュールは検証を行わない。R-03（区間表の網羅）と R-10（パターン内の停留所
 * 重複禁止）を満たすデータが渡されることを**前提**とし、破られていれば例外を投げる。
 * `loadNetworkDef` は検証を通してから索引を作るため、この例外は通常経路では
 * 起こり得ない。
 */

import type { NetworkDef, Stop, StopPattern } from '@/domain/model';
import { segmentKey } from './validate';

/** 1 つの停車パターンについて、あらかじめ計算した値。 */
export interface PatternIndex {
  readonly pattern: StopPattern;
  /** 始発停留所の `stopId`。 */
  readonly originStopId: string;
  /** 終着停留所の `stopId`。 */
  readonly terminalStopId: string;
  /** 始発から終着までの所要時間（分）。 */
  readonly totalMinutes: number;
  /**
   * 経路の順に並んだ、停留所と始発からの累積所要時間（分）の組。
   *
   * 時刻表の 1 列とダイヤグラムの 1 本のスジは、どちらもこの並びをそのまま辿る。
   * 停留所列を持ち回って各要素の累積時間を引き直すより、呼び出し側が単純になる。
   */
  readonly offsets: readonly (readonly [stopId: string, minutes: number])[];
  /**
   * 始発からの累積所要時間（分）。パターンに含まれない停留所は `undefined`。
   *
   * 微生物研究所前と工学部前のように、区間所要時間が 0 分であれば同じ値になる。
   */
  offsetFromOrigin(stopId: string): number | undefined;
  /** その停留所をこのパターンが経由するか。 */
  includes(stopId: string): boolean;
}

/** ネットワーク定義と、そこから導出した索引。 */
export interface NetworkIndex {
  /** 元のネットワーク定義。 */
  readonly def: NetworkDef;
  findStop(stopId: string): Stop | undefined;
  findPattern(patternId: string): StopPattern | undefined;
  /** 有向区間の所要時間（分）。区間表に無ければ `undefined`。 */
  runMinutes(fromStopId: string, toStopId: string): number | undefined;
  patternIndex(patternId: string): PatternIndex | undefined;
}

/**
 * ネットワーク定義から索引を作る。
 *
 * @throws {Error} パターンの停留所が 0 件のとき（R-06 違反）、または隣接停留所対が
 *   区間表に無いとき（R-03 違反）。いずれも `validateNetwork` が事前に弾く。
 */
export function buildNetworkIndex(def: NetworkDef): NetworkIndex {
  const stops = new Map(def.stops.map((s) => [s.stopId, s]));
  const patterns = new Map(def.patterns.map((p) => [p.patternId, p]));
  const runMinutesByKey = new Map(
    def.segments.map((s) => [segmentKey(s.fromStopId, s.toStopId), s.runMinutes]),
  );

  const runMinutes = (fromStopId: string, toStopId: string): number | undefined =>
    runMinutesByKey.get(segmentKey(fromStopId, toStopId));

  const patternIndexes = new Map(
    def.patterns.map((p) => [p.patternId, buildPatternIndex(p, runMinutes)]),
  );

  return {
    def,
    findStop: (stopId) => stops.get(stopId),
    findPattern: (patternId) => patterns.get(patternId),
    runMinutes,
    patternIndex: (patternId) => patternIndexes.get(patternId),
  };
}

/** 1 つのパターンの累積所要時間を、停留所列に沿って積み上げる。 */
function buildPatternIndex(
  pattern: StopPattern,
  runMinutes: (fromStopId: string, toStopId: string) => number | undefined,
): PatternIndex {
  const [first, ...rest] = pattern.stopSequence;
  if (first === undefined) {
    throw new Error(`パターン ${pattern.patternId} に停留所がありません`);
  }

  // R-10 により同じ停留所は 2 回現れないため、set が既存の値を上書きすることはない。
  const offsets = new Map<string, number>([[first.stopId, 0]]);
  let total = 0;
  let previous = first;

  for (const current of rest) {
    const minutes = runMinutes(previous.stopId, current.stopId);
    if (minutes === undefined) {
      throw new Error(
        `パターン ${pattern.patternId} が使う区間 ${segmentKey(previous.stopId, current.stopId)} が区間表にありません`,
      );
    }
    total += minutes;
    offsets.set(current.stopId, total);
    previous = current;
  }

  return {
    pattern,
    originStopId: first.stopId,
    terminalStopId: previous.stopId,
    totalMinutes: total,
    // Map は挿入順を保ち、挿入は経路の順に行っている。
    offsets: [...offsets],
    offsetFromOrigin: (stopId) => offsets.get(stopId),
    includes: (stopId) => offsets.has(stopId),
  };
}
