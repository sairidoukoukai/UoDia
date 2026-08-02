/**
 * 停留所の線種の上書き（仕様書 §6.5.3、#133）。
 *
 * **`route.json` は書き換えない。** どの停留所が幹線か（`gridStyle`）は路線の
 * 事実であり、その人の見やすさとは別物である。上書きは設定に持ち、当てるのは
 * 描く直前だけにする（`selectDiagramScene`）。
 *
 * ## 疎な表で持つ
 *
 * 上書きした停留所だけを入れる。全停留所ぶんを持つと、`route.json` 側で線種を
 * 直したときに**古い値で上書きし続ける**——路線図を直したのに画面が変わらない、
 * という直しにくい食い違いになる。
 */

import type { GridStyle } from '@/domain/model';
import { NO_GRID_STYLE_OVERRIDES } from '@/store';

export type GridStyleOverrides = Readonly<Record<string, GridStyle>>;

/** 線種の呼び名。設定でも凡例でも同じ言葉を使う。 */
export const GRID_STYLE_LABEL: Record<GridStyle, string> = {
  bold: '太線',
  normal: '細線',
  dashed: '破線',
};

export const GRID_STYLES: readonly GridStyle[] = ['bold', 'normal', 'dashed'];

/**
 * 上書きを 1 つ変える。`style` が `null` なら上書きをやめる（`route.json` に戻す）。
 *
 * **変わらないときは同じ参照を返す。** 設定は中身が変わったときだけ書き出す
 * （`watchSettings`）ため、新しい表を作るだけで書き込みが走る。
 */
export function withGridStyleOverride(
  overrides: GridStyleOverrides,
  stopId: string,
  style: GridStyle | null,
): GridStyleOverrides {
  if ((overrides[stopId] ?? null) === style) return overrides;

  const next: Record<string, GridStyle> = {};
  for (const [id, value] of Object.entries(overrides)) {
    if (id !== stopId) next[id] = value;
  }
  if (style !== null) next[stopId] = style;

  return Object.keys(next).length === 0 ? NO_GRID_STYLE_OVERRIDES : next;
}

/** 上書きを全部やめる。 */
export function clearedGridStyles(overrides: GridStyleOverrides): GridStyleOverrides {
  return Object.keys(overrides).length === 0 ? overrides : NO_GRID_STYLE_OVERRIDES;
}

/** いま上書きしている停留所の数。**何も無いことを言うために使う。** */
export function overrideCount(overrides: GridStyleOverrides): number {
  return Object.keys(overrides).length;
}
