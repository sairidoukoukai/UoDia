/**
 * 停車パターンの編集（仕様書 §6.5.4、T-36）。
 *
 * **ここは純関数だけである。** 並べ替えも停留所の出し入れも、受け取った
 * パターンから**新しいパターンを作って返す**。下書きの上で書き換えないのは、
 * 検証を通らない形を状態へ入れないためである（`settingsService` が当てる前に
 * `validateNetwork` へ通せる）。
 *
 * ## 停留所そのものは触らない
 *
 * 名称・軸位置・順序は `route.json` を直接編集する（§6.5.4）。ここで扱うのは
 * **どの停留所をどの順に通り、そこで乗り降りをどう扱うか**だけである。
 */

import type { Handling, NetworkDef, StopPattern, Trip } from '@/domain/model';
import type { NetworkIndex } from '@/domain/network';
import { expandDeadheads, sourceTripId } from '@/domain/trip';

/** 一覧に出す 1 行。 */
export interface PatternRow {
  readonly pattern: StopPattern;
  /** 「豊中 → 箕面 → コンベ前」。停留所は略称で出す（#116）。 */
  readonly path: string;
}

export function patternRows(
  patterns: readonly StopPattern[],
  network: NetworkIndex,
): readonly PatternRow[] {
  const nameOf = (stopId: string): string => network.findStop(stopId)?.shortName ?? stopId;

  return patterns.map((pattern) => ({
    pattern,
    path: pattern.stopSequence.map((stop) => nameOf(stop.stopId)).join(' → '),
  }));
}

/** 並びの中で 1 つ動かす。端では動かさない。 */
export function movedStop(pattern: StopPattern, index: number, delta: number): StopPattern {
  const to = index + delta;
  if (index < 0 || index >= pattern.stopSequence.length) return pattern;
  if (to < 0 || to >= pattern.stopSequence.length) return pattern;

  const next = [...pattern.stopSequence];
  const [moved] = next.splice(index, 1);
  if (moved === undefined) return pattern;
  next.splice(to, 0, moved);
  return { ...pattern, stopSequence: next };
}

/**
 * 停留所を末尾に足す。
 *
 * **既にある停留所は足さない。** 同じ停留所が 2 回現れるとアンカーがどちらの
 * 通過を指すのか決まらない（R-10、仕様書 §5.6）。
 */
export function withStopAdded(
  pattern: StopPattern,
  stopId: string,
  handling: Handling,
): StopPattern {
  if (pattern.stopSequence.some((stop) => stop.stopId === stopId)) return pattern;
  return { ...pattern, stopSequence: [...pattern.stopSequence, { stopId, handling }] };
}

/** 並びから 1 つ外す。 */
export function withStopRemoved(pattern: StopPattern, index: number): StopPattern {
  if (index < 0 || index >= pattern.stopSequence.length) return pattern;
  return { ...pattern, stopSequence: pattern.stopSequence.filter((_, i) => i !== index) };
}

/** 取扱区分を変える。 */
export function withHandling(pattern: StopPattern, index: number, handling: Handling): StopPattern {
  if (index < 0 || index >= pattern.stopSequence.length) return pattern;
  return {
    ...pattern,
    stopSequence: pattern.stopSequence.map((stop, i) =>
      i === index ? { ...stop, handling } : stop,
    ),
  };
}

/**
 * 選んだパターンを写して新しい ID を振る（§6.5.4 の「追加」）。
 *
 * **白紙からは作らない。** 路線名も色も回送かどうかも、ここでは編集できない
 * 項目である（§6.5.4）。写せば、触れない項目にも意味のある値が入る。
 */
export function duplicatedPattern(
  source: StopPattern,
  existing: readonly StopPattern[],
): StopPattern {
  const used = new Set(existing.map((pattern) => pattern.patternId));
  let index = 1;
  while (used.has(`${source.patternId}-${String(index)}`)) index += 1;

  return {
    ...source,
    patternId: `${source.patternId}-${String(index)}`,
    patternName: `${source.patternName}（写し）`,
    // **既定は 1 方向に 1 つだけである**（R-05）。写しは既定にしない。
    isDefault: false,
  };
}

/** パターンを入れ替えた定義。**元の定義は変えない。** */
export function withPatterns(def: NetworkDef, patterns: readonly StopPattern[]): NetworkDef {
  return { ...def, patterns: [...patterns] };
}

/** 中身が同じか（並びと取扱区分まで見る）。 */
export function samePattern(a: StopPattern, b: StopPattern): boolean {
  if (
    a.patternId !== b.patternId ||
    a.patternName !== b.patternName ||
    a.routeName !== b.routeName ||
    a.directionId !== b.directionId ||
    a.color !== b.color ||
    a.isDefault !== b.isDefault ||
    a.isDeadhead !== b.isDeadhead ||
    a.serviceType !== b.serviceType ||
    a.stopSequence.length !== b.stopSequence.length
  ) {
    return false;
  }
  return a.stopSequence.every((stop, index) => {
    const other = b.stopSequence[index];
    return other?.stopId === stop.stopId && other.handling === stop.handling;
  });
}

/** 変わった（足された・消された・中身が違う）パターンの ID。 */
export function changedPatternIds(
  before: readonly StopPattern[],
  after: readonly StopPattern[],
): readonly string[] {
  const beforeById = new Map(before.map((pattern) => [pattern.patternId, pattern]));
  const afterById = new Map(after.map((pattern) => [pattern.patternId, pattern]));
  const changed = new Set<string>();

  for (const pattern of after) {
    const original = beforeById.get(pattern.patternId);
    if (original === undefined || !samePattern(original, pattern)) changed.add(pattern.patternId);
  }
  for (const pattern of before) {
    if (!afterById.has(pattern.patternId)) changed.add(pattern.patternId);
  }

  return [...changed];
}

/**
 * その変更で時刻が変わる便の数（§6.5.4）。
 *
 * **回送も数に入れる。** 出区・入区は便の一部であり（§6.1.7）、回送パターンを
 * 変えれば、それを使う便の出庫時刻が変わる。数えるのは保存されている便である。
 */
export function affectedTripCount(
  trips: readonly Trip[],
  network: NetworkIndex,
  patternIds: readonly string[],
): number {
  const changed = new Set(patternIds);
  if (changed.size === 0) return 0;

  const affected = new Set<string>();
  for (const trip of expandDeadheads(trips, network)) {
    if (changed.has(trip.patternId)) affected.add(sourceTripId(trip.tripId));
  }
  return affected.size;
}
