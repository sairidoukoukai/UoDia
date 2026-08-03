/**
 * 運用番号ごとの表示色（仕様書 §5.8、§6.2.4）。
 *
 * **色はデータとして保持しない。** 運用番号を昇順に並べた一覧上の位置から
 * 決定的に決まる。運用番号は利用者が自由に付ける文字列であり、色を持たせると
 * 番号を振り直すたびに色の管理が必要になる。位置から決めれば、同じダイヤを
 * 開き直しても、別の環境で開いても、同じ色になる。
 *
 * 番号の増減で既存の運用の色が変わり得るのは、この方式の代償である。運用の
 * 本数が高々十数本であること、色が識別の補助でしかない（運用番号は文字としても
 * 表示される）ことから、許容できるとみなす。
 */

/**
 * 運用の配色。
 *
 * 白背景のダイヤグラム上で細いスジとして描かれるため、淡い色は使わない。
 * 隣り合う要素どうしの色相を離し、少数の運用でも見分けやすくしている。
 */
export const BLOCK_COLORS: readonly string[] = [
  '#c0392b', // 赤
  '#2980b9', // 青
  '#27ae60', // 緑
  '#d35400', // 橙
  '#8e44ad', // 紫
  '#16a085', // 青緑
  '#c2185b', // 桃
  '#00838f', // 藍
  '#558b2f', // 黄緑
  '#5d4037', // 茶
];

/** 配色を使い切ったときの色。空の配色を渡された場合にのみ返る。 */
const FALLBACK_COLOR = '#000000';

/**
 * 一覧上の位置に対応する色。色数を超えた分は先頭から巡回する。
 *
 * 配色を差し替えられるようにしてあるのは、設定から配色を変えられるようにする
 * ため（T-36）と、テストで巡回の境界を確かめやすくするためである。空の配色を
 * 渡した場合は黒を返す。
 *
 * @throws {RangeError} 位置が非負の整数でない場合
 */
export function blockColorAt(index: number, palette: readonly string[] = BLOCK_COLORS): string {
  if (!Number.isInteger(index) || index < 0) {
    throw new RangeError(`位置は 0 以上の整数でなければなりません: ${String(index)}`);
  }
  return palette[index % palette.length] ?? FALLBACK_COLOR;
}

/**
 * 運用番号に色を割り当てる。
 *
 * 渡された順序ではなく**運用番号の昇順**で割り当てる。便の並び順や追加した順に
 * 依存しないようにするため。
 *
 * `chosen` に入っている運用は、その色で返す（#148）。**選んだものだけを覚える**
 * ため、運用を足しても選んだ色は動かない。選んでいない運用は、これまでどおり
 * 並び順から決まる——**選ばれた色を避けはしない。** 同じ色が 2 つ並ぶことは
 * ありうるが、それは選んだ人の目に見えており、選び直せる。
 */
export function assignBlockColors(
  blockIds: readonly string[],
  palette: readonly string[] = BLOCK_COLORS,
  chosen: Readonly<Record<string, string>> = {},
): Map<string, string> {
  const sorted = [...new Set(blockIds)].sort((a, b) => a.localeCompare(b));
  return new Map(
    sorted.map((blockId, index) => [blockId, chosen[blockId] ?? blockColorAt(index, palette)]),
  );
}
