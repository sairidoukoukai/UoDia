/**
 * 停車パターンの色と線種の上書き（仕様書 §6.5.3、#147）。
 *
 * **`route.json` は書き換えない。** どのパターンが直行かは路線の事実であり、
 * その線が見分けやすいかはその人の目の話である（停留所の線種 #133 と同じ）。
 *
 * ## 色と線種は独立に持つ
 *
 * 片方だけ選んだときに、もう片方まで `route.json` から離れてはならない。
 * よって上書きは項目ごとに持ち、**両方とも空になったらその行ごと落とす**
 * （空の上書きを覚えていると、「選んでいない」と「選んで既定と同じ」の区別が
 * つかなくなる）。
 */

import type { DashKind, PatternStyleChoice } from '@/domain/model';
import { NO_PATTERN_STYLES } from '@/store';

export type PatternStyleChoices = Readonly<Record<string, PatternStyleChoice>>;

/**
 * 上書きの変更。
 *
 * `null` は「上書きしない」（上書きをやめる）。項目を渡さなければ触らない。
 */
export interface PatternStylePatch {
  readonly color?: string | null;
  readonly dash?: DashKind | null;
}

/**
 * 上書きを 1 つ変える。
 *
 * **変わらないときは同じ参照を返す。** 設定は中身が変わったときだけ書き出す
 * （`watchSettings`）ため、新しい表を作るだけで書き込みが走る。
 */
export function withPatternStyle(
  choices: PatternStyleChoices,
  patternId: string,
  patch: PatternStylePatch,
): PatternStyleChoices {
  const current = choices[patternId];
  const next: PatternStyleChoice = {
    ...(pick(patch.color, current?.color) === undefined
      ? {}
      : { color: pick(patch.color, current?.color) }),
    ...(pick(patch.dash, current?.dash) === undefined
      ? {}
      : { dash: pick(patch.dash, current?.dash) }),
  };

  if (same(current, next)) return choices;

  const rest: Record<string, PatternStyleChoice> = {};
  for (const [id, value] of Object.entries(choices)) {
    if (id !== patternId) rest[id] = value;
  }
  // 何も残らなければ行ごと落とす。
  if (next.color === undefined && next.dash === undefined) {
    return Object.keys(rest).length === 0 ? NO_PATTERN_STYLES : rest;
  }
  return { ...rest, [patternId]: next };
}

/** そのパターンの上書きを全部やめる。 */
export function withoutPatternStyle(
  choices: PatternStyleChoices,
  patternId: string,
): PatternStyleChoices {
  return withPatternStyle(choices, patternId, { color: null, dash: null });
}

/** 上書きを全部やめる。 */
export function clearedPatternStyles(choices: PatternStyleChoices): PatternStyleChoices {
  return Object.keys(choices).length === 0 ? choices : NO_PATTERN_STYLES;
}

/** いま上書きしているパターンの数。 */
export function patternStyleCount(choices: PatternStyleChoices): number {
  return Object.keys(choices).length;
}

/** 変更（`null` はやめる、未指定は触らない）を今の値に当てる。 */
function pick<T>(patch: T | null | undefined, current: T | undefined): T | undefined {
  if (patch === null) return undefined;
  return patch ?? current;
}

function same(a: PatternStyleChoice | undefined, b: PatternStyleChoice): boolean {
  return (a?.color ?? undefined) === b.color && (a?.dash ?? undefined) === b.dash;
}
