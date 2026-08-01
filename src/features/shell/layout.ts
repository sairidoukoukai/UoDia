/**
 * 上下 2 分割の寸法（仕様書 §6.4、T-32）。
 *
 * **DOM も React もストアも見ない。** 境界を引きずる・キーで動かす・最大化する、
 * のどれも「今の比率と入力から次の比率を決める」だけの計算である。ここに閉じて
 * おけば、どの入口から動かしても同じ規則が働き、下限と上限の守り方が 1 か所で
 * 済む。
 */

import { clampSplitRatio, SPLIT_RATIO_LIMITS } from '@/domain/model';
import type { MaximizedPane } from '@/store';

/** 分割されている側。 */
export type Pane = 'diagram' | 'timetable';

/** キーボードで境界を 1 回動かす量。 */
export const SPLIT_STEP = 0.05;

/**
 * 引きずった位置から比率を求める。
 *
 * @param y 画面上の縦位置（`clientY`）
 * @param top 分割領域の上端
 * @param height 分割領域の高さ
 * @returns 高さを測れないときは `null`（動かさない）
 */
export function ratioAtPointer(y: number, top: number, height: number): number | null {
  if (!(height > 0)) return null;
  return round2(clampSplitRatio((y - top) / height));
}

/**
 * 実際に上が占める比率。
 *
 * 最大化は**比率を上書きするだけ**であり、保存されている比率は動かない
 * （`store/types.ts`）。押し直せば元の分割に戻る。
 */
export function effectiveRatio(splitRatio: number, maximized: MaximizedPane): number {
  if (maximized === 'diagram') return 1;
  if (maximized === 'timetable') return 0;
  return clampSplitRatio(splitRatio);
}

/** 最大化の切り替え。同じ側をもう一度指せば 2 分割へ戻る。 */
export function togglePane(current: MaximizedPane, pane: Pane): MaximizedPane {
  return current === pane ? null : pane;
}

/** 最大化に隠されている側か。 */
export function isCollapsed(pane: Pane, maximized: MaximizedPane): boolean {
  return maximized !== null && maximized !== pane;
}

/**
 * キーで境界を動かした後の比率。動かす鍵でなければ `null`。
 *
 * 上下の矢印で少しずつ、<kbd>Home</kbd>/<kbd>End</kbd> で端まで動く（区切り線の
 * 決まりに従う）。**端は下限と上限であって 0 と 1 ではない**——キーボードだけを
 * 使う利用者が、戻し方の分からない画面に入り込まないようにする。
 */
export function ratioAfterKey(ratio: number, key: string): number | null {
  switch (key) {
    case 'ArrowUp':
      return round2(clampSplitRatio(ratio - SPLIT_STEP));
    case 'ArrowDown':
      return round2(clampSplitRatio(ratio + SPLIT_STEP));
    case 'Home':
      return SPLIT_RATIO_LIMITS.min;
    case 'End':
      return SPLIT_RATIO_LIMITS.max;
    default:
      return null;
  }
}

/**
 * 最大化のショートカット（仕様書 §6.4）。当てはまらなければ `null`。
 *
 * <kbd>Ctrl</kbd>+<kbd>1</kbd> がダイヤグラム、<kbd>Ctrl</kbd>+<kbd>2</kbd> が
 * 時刻表。**修飾キーが増えているときは受け取らない。** 別の操作のつもりで
 * 押されたものを横取りしない。
 */
export function maximizeShortcut(event: {
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
}): Pane | null {
  if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return null;
  if (event.key === '1') return 'diagram';
  if (event.key === '2') return 'timetable';
  return null;
}

/** 画面に出す百分率。 */
export function ratioPercent(ratio: number): number {
  return Math.round(ratio * 100);
}

/** 0.05 刻みの足し引きで出る誤差を落とす（0.55000000000000004 のような値）。 */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
