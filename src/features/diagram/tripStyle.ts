/**
 * スジの線種（仕様書 §6.2.2、§9.4、T-26）。
 *
 * **パターンの識別を色だけに頼らせない。** 色の見分けがつかない利用者には
 * 8 本のパターン色が 1 色に見える。線種を併せて変えれば、色に頼らず読める。
 *
 * ## 見分けたいのは「各駅か通過か」だけである
 *
 * かつては方向ごとの定義順で 4 種類を配っていた（実線 → 破線 → 点線 →
 * 一点鎖線）。**線種が 4 つあると、どの線が何を意味するのかを覚えていないと
 * 読めない。** 実際に見分けたいのは「箕面学舎に寄るか、直行か」であり、区間便か
 * どうかはスジの端がどこにあるかで読める（#114）。
 *
 * 区別する必要の無いものに別の記号を与えると、記号のほうが多くなる。
 *
 * ## どちらのタイプかはデータが決める
 *
 * 停留所の並びから推し量ると、実装が特定の停留所 ID を名指しすることになる。
 * 各駅か通過かは路線側の事実であり、`route.json` の `serviceType` が持つ
 * （R-12 で検証）。
 */

import type { ServiceType, StopPattern } from '@/domain/model';

/** 各駅タイプ（`local`）。箕面学舎に停まる便。 */
const LOCAL_DASH: readonly number[] = [];

/** 通過タイプ（`express`）。箕面学舎を通らない直行便。 */
const EXPRESS_DASH: readonly number[] = [8, 4];

/** 実線。 */
export const SOLID: readonly number[] = [];

/** 回送スジ（仕様書 §6.2.2）。営業パターンには使わない短い破線とする。 */
export const DEADHEAD_DASH: readonly number[] = [5, 4];

/** 運行の種別に対応する線種。 */
export function dashForServiceType(serviceType: ServiceType): readonly number[] {
  return serviceType === 'express' ? EXPRESS_DASH : LOCAL_DASH;
}

/**
 * パターンに線種を割り当てる。
 *
 * 回送はすべて同じ破線とする。回送どうしを見分ける必要はない——どの営業便から
 * 展開されたかは、繋がっている営業便のスジが示している。
 *
 * `serviceType` の無い営業パターンは各駅として描く（R-12 が別に報告する）。
 * **絵を出さないより、既定を決めて出すほうがよい。**
 */
export function assignPatternDashes(
  patterns: readonly StopPattern[],
): Map<string, readonly number[]> {
  const dashes = new Map<string, readonly number[]>();

  for (const pattern of patterns) {
    dashes.set(
      pattern.patternId,
      pattern.isDeadhead ? DEADHEAD_DASH : dashForServiceType(pattern.serviceType ?? 'local'),
    );
  }

  return dashes;
}
