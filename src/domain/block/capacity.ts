/**
 * 輸送能力（#162、仕様書 v1.1 §6.2）。
 *
 * **定員は停車パターン（系統）が持つ。** 系統によって入る車両の型式が違う。
 * 運用番号はその文書の中だけの名前であり、`A` の定員という概念が文書をまたいで
 * 意味を持たない（仕様書 §5.8）。
 *
 * ## 数えないものを数えない
 *
 * - **回送は数えない。** 客を乗せていない。距離が回送を数えるのとは逆であり、
 *   **理由も逆である**——走った距離は事実だが、運べた人数ではない
 * - **定員の分からない便は数えない。** 数えなかった件数を返し、合計だけを出さない
 *
 * ## 断面で数える
 *
 * 「1 日で何人ぶんの席を出したか」（延べ輸送力）と、「その区間のその時間帯に
 * 何人運べるか」（断面輸送力）は別の問いである。**後者のほうが検討に使える**
 * ——便によって始発停留所が違うため（豊中発・箕面発・工学部発）、路線全体で
 * 1 つの数にすると意味を失う。
 */

import type { NetworkIndex } from '@/domain/network';
import type { Seconds } from '@/domain/time';
import { allTimes } from '@/domain/trip';
import type { Trip } from '@/domain/model';

/**
 * 定員の既定値（人）。
 *
 * **暫定値である**（2026-08-05、Q-7）。実測が分かるまでの計算の出発点であり、
 * 路線の事実ではない。系統ごとにプロジェクト側で上書きできる。
 *
 * **暫定であることをここに書き残す。** 読めないと、実測値と区別が付かなくなる。
 */
export const DEFAULT_CAPACITY = 72;

/** 系統ごとの定員。**上書きしたものだけが入る。** */
export type PatternCapacities = Readonly<Record<string, number>>;

/** 数えた結果。 */
export interface CapacityTotal {
  /** 席の合計（人）。 */
  readonly seats: number;
  /** 数えた便の数。 */
  readonly counted: number;
  /**
   * 数えなかった便の数。
   *
   * **合計だけを出さない。** 抜けていることに気づかないまま読まれる。
   */
  readonly skipped: number;
}

/** その便の定員。回送・パターン不明なら `null`（数えない）。 */
export function tripCapacity(
  trip: Trip,
  network: NetworkIndex,
  capacities: PatternCapacities,
): number | null {
  const pattern = network.patternIndex(trip.patternId);
  if (pattern === undefined) return null;
  // **回送は数えない。** 客を乗せていない。
  if (pattern.pattern.isDeadhead) return null;
  return capacities[trip.patternId] ?? DEFAULT_CAPACITY;
}

/** 便の並びの延べ輸送力。 */
export function totalCapacity(
  trips: readonly Trip[],
  network: NetworkIndex,
  capacities: PatternCapacities,
): CapacityTotal {
  let seats = 0;
  let counted = 0;
  let skipped = 0;

  for (const trip of trips) {
    const capacity = tripCapacity(trip, network, capacities);
    if (capacity === null) continue; // 回送は数の外。「数えなかった」でもない
    if (trip.anchor === null) {
      // 時刻が未入力の便。**いつ運ぶのか決まっていないものを数えない。**
      skipped += 1;
      continue;
    }
    seats += capacity;
    counted += 1;
  }

  return { seats, counted, skipped };
}

/** 断面（区間 × 方向）を数えるときの条件。 */
export interface CrossSection {
  readonly fromStopId: string;
  readonly toStopId: string;
  /** 数える時間の範囲。`null` なら 1 日全部。 */
  readonly range: { readonly from: Seconds; readonly to: Seconds } | null;
}

/**
 * ある区間を、ある時間範囲に通る営業便の定員の合計。
 *
 * **範囲に入るかは「その区間を通る時刻」で判定する。** 便の始発時刻で判定すると、
 * 8:55 発の便が 9:20 に通る区間の輸送力に数えられない（仕様書 v1.1 §6.2.2）。
 *
 * **定員は切らない。** 按分すると `37.5 人` が出る——人は割れない
 * （仕様書 v1.1 §6.4.2）。
 */
export function sectionCapacity(
  trips: readonly Trip[],
  network: NetworkIndex,
  capacities: PatternCapacities,
  section: CrossSection,
): CapacityTotal {
  const matching = trips.filter((trip) => {
    const pattern = network.patternIndex(trip.patternId);
    if (pattern === undefined) return false;
    // その区間を続けて通る便だけを数える。
    if (!passesThrough(pattern.offsets, section.fromStopId, section.toStopId)) return false;
    if (section.range === null) return true;

    const time = allTimes(trip, network).get(section.fromStopId);
    if (time === undefined) return false;
    return time >= section.range.from && time <= section.range.to;
  });

  return totalCapacity(matching, network, capacities);
}

/** そのパターンが `from` の直後に `to` を通るか。 */
function passesThrough(
  offsets: readonly (readonly [stopId: string, minutes: number])[],
  fromStopId: string,
  toStopId: string,
): boolean {
  for (const [index, entry] of offsets.entries()) {
    if (entry[0] !== fromStopId) continue;
    return offsets[index + 1]?.[0] === toStopId;
  }
  return false;
}
