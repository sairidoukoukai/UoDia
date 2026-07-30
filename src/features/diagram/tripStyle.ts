/**
 * スジの線種（仕様書 §6.2.2、§9.4、T-26）。
 *
 * **パターンの識別を色だけに頼らせない。** 8 本のパターン色は色相で分けてあるが、
 * 色の見分けがつかない利用者には 1 色に見える。線種を併せて変えれば、色に頼らず
 * 数えられる。
 *
 * ## 番号でも位置でもなく、定義の順で決める
 *
 * 運用の色（`domain/block/colors.ts`）と同じ考え方である。線種をデータとして
 * 持たせると、パターンを増やすたびに線種の管理が要る。`route.json` に書かれた
 * **方向ごとの定義順**から決めれば、同じ路線図を別の環境で開いても同じ絵になる。
 */

import type { StopPattern } from '@/domain/model';

/**
 * 営業パターンの線種。方向ごとに定義順で割り当てる。
 *
 * 方向は線の傾き（右下がり／右上がり）で分かるため、線種は方向をまたいで
 * 使い回してよい。実際の路線は方向ごとに 4 本であり、巡回は起きない。
 */
const PATTERN_DASHES: readonly (readonly number[])[] = [
  [], // 実線
  [8, 4], // 破線
  [2, 3], // 点線
  [10, 4, 2, 4], // 一点鎖線
];

/** 実線。 */
export const SOLID: readonly number[] = [];

/** 回送スジ（仕様書 §6.2.2）。営業パターンには使わない短い破線とする。 */
export const DEADHEAD_DASH: readonly number[] = [5, 4];

/** 定義順に対応する線種。数を超えた分は先頭から巡回する。 */
export function patternDashAt(index: number): readonly number[] {
  return PATTERN_DASHES[index % PATTERN_DASHES.length] ?? SOLID;
}

/**
 * パターンに線種を割り当てる。
 *
 * 回送はすべて同じ破線とする。回送どうしを見分ける必要はない——どの営業便から
 * 展開されたかは、繋がっている営業便のスジが示している。
 */
export function assignPatternDashes(
  patterns: readonly StopPattern[],
): Map<string, readonly number[]> {
  const dashes = new Map<string, readonly number[]>();
  const countByDirection = new Map<number, number>();

  for (const pattern of patterns) {
    if (pattern.isDeadhead) {
      dashes.set(pattern.patternId, DEADHEAD_DASH);
      continue;
    }
    const index = countByDirection.get(pattern.directionId) ?? 0;
    countByDirection.set(pattern.directionId, index + 1);
    dashes.set(pattern.patternId, patternDashAt(index));
  }
  return dashes;
}
