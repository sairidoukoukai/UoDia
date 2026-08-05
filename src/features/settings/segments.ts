/**
 * 区間所要時間の編集（仕様書 §6.5.1、T-35）。
 *
 * **ここは純関数だけである。** 打たれた文字を数に直す、変わった区間を数える、
 * 影響を受ける便を数える——どれもストアにも画面にも関わらない計算であり、
 * 画面を組まずに確かめられる。
 *
 * ## 時刻を「作り直す」処理は無い
 *
 * 便が持つのはアンカー 1 点だけであり（仕様書 §5.6）、ほかの停留所の時刻は
 * **区間表から毎回導かれる**。区間所要時間を変えれば、その区間を通る便の時刻は
 * 次に引いたときにもう新しい。**アンカーの時刻は動かない**——受入条件の 2 つは、
 * 作り直しを書かないことで満たされる。
 */

import type { NetworkDef, Trip } from '@/domain/model';
import { segmentKey, type NetworkIndex } from '@/domain/network';
import { METERS_PER_KM, expandDeadheads, sourceTripId } from '@/domain/trip';

/** 一覧に出す 1 行。 */
export interface SegmentRow {
  /** 区間表を引く鍵（`segmentKey`）。 */
  readonly key: string;
  readonly fromStopId: string;
  readonly toStopId: string;
  /** 画面に出す名前（略称。#116）。 */
  readonly label: string;
  readonly runMinutes: number;
  /** 営業所を含む区間（回送区間）。 */
  readonly isDeadhead: boolean;
  /** 区間距離（メートル。#161）。版数 1 の定義では `undefined`。 */
  readonly distanceMeters: number | undefined;
}

/** 打ち直した所要時間（分）。鍵は `segmentKey`。 */
export type SegmentEdits = ReadonlyMap<string, number>;

/** 打ち直した距離（メートル）。鍵は `segmentKey`。 */
export type DistanceEdits = ReadonlyMap<string, number>;

/**
 * 区間表を一覧の形にする。**定義の順に出す。**
 *
 * 並べ替えないのは、`route.json` を手で直すときに突き合わせられるようにする
 * ためである。
 */
export function segmentRows(network: NetworkIndex): readonly SegmentRow[] {
  const depotIds = new Set(
    network.def.stops.filter((stop) => stop.isDepot).map((stop) => stop.stopId),
  );
  const nameOf = (stopId: string): string => network.findStop(stopId)?.shortName ?? stopId;

  return network.def.segments.map((segment) => ({
    key: segmentKey(segment.fromStopId, segment.toStopId),
    fromStopId: segment.fromStopId,
    toStopId: segment.toStopId,
    label: `${nameOf(segment.fromStopId)} → ${nameOf(segment.toStopId)}`,
    runMinutes: segment.runMinutes,
    isDeadhead: depotIds.has(segment.fromStopId) || depotIds.has(segment.toStopId),
    distanceMeters: segment.distanceMeters,
  }));
}

/**
 * 打たれた文字を所要時間にする。受け取れなければ `null`。
 *
 * **5 の倍数だけを受け取る**（R-01、受入条件）。5 分刻みは時刻の側の決まり
 * （§2.1）であり、区間が 3 分だと、どこにも置けない時刻の便ができる。
 */
export function parseRunMinutes(text: string): number | null {
  const normalized = text
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .trim();
  if (!/^\d+$/.test(normalized)) return null;

  const value = Number(normalized);
  if (!Number.isInteger(value) || value < 0 || value % 5 !== 0) return null;
  return value;
}

/**
 * 打たれた文字を距離（メートル）にする。受け取れなければ `null`。
 *
 * **km で打たせ、メートルで持つ**（#161、仕様書 v1.1 §6.1.1）。画面に出すのは
 * km だが、足し合わせるのはメートルの整数である——km の小数で足すと丸め誤差が
 * 乗る。
 *
 * **5 の倍数のような刻みは設けない。** 所要時間が 5 分刻みなのはダイヤ全体が
 * 5 分刻みだからであり（§2.1）、距離にその制約は無い。小数第 1 位（100m）まで
 * 受け取る。
 */
export function parseDistanceKm(text: string): number | null {
  const normalized = text
    .replace(/[０-９．]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .trim();
  if (!/^\d+(\.\d+)?$/.test(normalized)) return null;

  const km = Number(normalized);
  if (!Number.isFinite(km) || km < 0) return null;
  // 100m 未満は表せない。丸めは近いほう（仕様書 §6.5.2 と同じ規則）。
  return Math.round(km * METERS_PER_KM);
}

/** 今の定義と違う値だけを残す。 */
export function changedEdits(network: NetworkIndex, edits: SegmentEdits): SegmentEdits {
  const changed = new Map<string, number>();
  for (const row of segmentRows(network)) {
    const next = edits.get(row.key);
    if (next !== undefined && next !== row.runMinutes) changed.set(row.key, next);
  }
  return changed;
}

/**
 * その変更で時刻が変わる便の数（仕様書 §6.5.1）。
 *
 * **回送も数に入れる。** 出区・入区は便の一部であり（§6.1.7）、車庫までの
 * 所要時間が変われば、その便の出庫時刻が変わる。数えるのは**保存されている
 * 便**であり、展開した回送を別に数えない。
 */
export function affectedTripCount(
  trips: readonly Trip[],
  network: NetworkIndex,
  edits: SegmentEdits,
): number {
  const changed = changedEdits(network, edits);
  if (changed.size === 0) return 0;

  const affected = new Set<string>();
  for (const trip of expandDeadheads(trips, network)) {
    const pattern = network.patternIndex(trip.patternId)?.pattern;
    if (pattern === undefined) continue;

    for (let i = 1; i < pattern.stopSequence.length; i += 1) {
      const from = pattern.stopSequence[i - 1]?.stopId;
      const to = pattern.stopSequence[i]?.stopId;
      if (from === undefined || to === undefined) continue;
      if (changed.has(segmentKey(from, to))) {
        affected.add(sourceTripId(trip.tripId));
        break;
      }
    }
  }
  return affected.size;
}

/** 今の定義と違う距離だけを残す。 */
export function changedDistances(network: NetworkIndex, edits: DistanceEdits): DistanceEdits {
  const changed = new Map<string, number>();
  for (const row of segmentRows(network)) {
    const next = edits.get(row.key);
    if (next !== undefined && next !== row.distanceMeters) changed.set(row.key, next);
  }
  return changed;
}

/**
 * 打ち直した距離を当てた定義。**元の定義は変えない。**
 *
 * **距離を変えても便の時刻は動かない。** 時刻を決めるのは所要時間だけであり、
 * ここは所要時間に触れない（仕様書 v1.1 §6.1.3）。
 */
export function withDistances(def: NetworkDef, edits: DistanceEdits): NetworkDef {
  return {
    ...def,
    segments: def.segments.map((segment) => {
      const next = edits.get(segmentKey(segment.fromStopId, segment.toStopId));
      return next === undefined || next === segment.distanceMeters
        ? segment
        : { ...segment, distanceMeters: next };
    }),
  };
}

/** 打ち直した値を当てた定義。**元の定義は変えない。** */
export function withRunMinutes(def: NetworkDef, edits: SegmentEdits): NetworkDef {
  return {
    ...def,
    segments: def.segments.map((segment) => {
      const next = edits.get(segmentKey(segment.fromStopId, segment.toStopId));
      return next === undefined || next === segment.runMinutes
        ? segment
        : { ...segment, runMinutes: next };
    }),
  };
}
