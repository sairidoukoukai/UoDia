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

import type { DashKind, ServiceType, StopPattern } from '@/domain/model';
import type { PatternStyleChoice } from '@/store';

/** 各駅タイプ（`local`）。箕面学舎に停まる便。 */
const LOCAL_DASH: readonly number[] = [];

/** 通過タイプ（`express`）。箕面学舎を通らない直行便。 */
const EXPRESS_DASH: readonly number[] = [8, 4];

/** 実線。 */
export const SOLID: readonly number[] = [];

/** 回送スジ（仕様書 §6.2.2）。営業パターンには使わない短い破線とする。 */
export const DEADHEAD_DASH: readonly number[] = [5, 4];

/** 1 点鎖線。利用者が選べる線種のひとつ（#147）。 */
export const DASH_DOT: readonly number[] = [10, 4, 2, 4];

/**
 * 利用者が選べる線種（#147）。
 *
 * **選べる先を決めておく。** 刻みを打ち込める形にすると、線種が「見分けるための
 * もの」から「飾り」に変わる（#114 で線種を 2 種類に揃えた理由と同じ）。
 */
export const DASH_KINDS: readonly DashKind[] = ['solid', 'dashed', 'dashDot'];

export const DASH_KIND_LABEL: Record<DashKind, string> = {
  solid: '実線',
  dashed: '破線',
  dashDot: '1 点鎖線',
};

export const DASH_BY_KIND: Record<DashKind, readonly number[]> = {
  solid: SOLID,
  dashed: EXPRESS_DASH,
  dashDot: DASH_DOT,
};

/** 運行の種別に対応する線種。 */
export function dashForServiceType(serviceType: ServiceType): readonly number[] {
  return serviceType === 'express' ? EXPRESS_DASH : LOCAL_DASH;
}

/**
 * そのパターンの**既定の線種**（利用者の上書きを当てる前の姿）。
 *
 * **判定を 2 か所に書かない。** 設定ダイアログは「上書きしない（破線）」の
 * ように既定を添えて出すが、そこで `serviceType` を読み直していたため、
 * **回送を見落として「実線」と書いていた**（#222）——`route.json` の回送は
 * `serviceType` を持たず、実際には破線が引かれる。
 *
 * `assignPatternDashes` と**同じ判定**をここに置き、画面もこれを呼ぶ。
 */
export function defaultDashKindOf(pattern: StopPattern): DashKind {
  if (pattern.isDeadhead) return 'dashed';
  return (pattern.serviceType ?? 'local') === 'express' ? 'dashed' : 'solid';
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

/** 描くときのパターンの姿。 */
export interface PatternStyle {
  readonly color: string;
  readonly lineDash: readonly number[];
}

/**
 * パターンの色と線種を決める（#147）。
 *
 * **決める場所を 1 つにする。** ダイヤグラムのスジ（`selectDiagramScene`）と
 * 凡例（`PatternList`）が別々に決めると、**一覧とスジが違う姿になる。**
 *
 * 上書きしていないパターンは `route.json` のままである。色と線種は独立であり、
 * 片方だけ上書きできる。
 */
export function patternStyles(
  patterns: readonly StopPattern[],
  choices: Readonly<Record<string, PatternStyleChoice>> = {},
): ReadonlyMap<string, PatternStyle> {
  const dashes = assignPatternDashes(patterns);
  const styles = new Map<string, PatternStyle>();

  for (const pattern of patterns) {
    const choice = choices[pattern.patternId];
    styles.set(pattern.patternId, {
      color: choice?.color ?? pattern.color,
      /*
       * **回送の線種も上書きできる**（#179、2026-08-05 改め）。
       *
       * 当初は「回送かどうかはパターンの好みではない」として選ばせなかった。
       * **その理由は色に当てはまらず、線種にも当てはまらなかった。** 回送が
       * 回送であることは `isDeadhead` が決めているが、**その線をどう見分けたいか
       * はその人の目の話**である。運用で着色すると回送は元の便と同じ色になり
       * （§6.2.4）、太さの違いだけが手掛かりになる——そこを補えるようにする。
       *
       * 既定は変わらない（回送は破線、営業は種別から決まる）。
       */
      lineDash:
        choice?.dash === undefined
          ? (dashes.get(pattern.patternId) ?? SOLID)
          : DASH_BY_KIND[choice.dash],
    });
  }

  return styles;
}
