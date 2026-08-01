/**
 * 表示フィルタの持ち方（仕様書 §6.2.4、T-33）。
 *
 * **持つのは「隠しているもの」の一覧である。** 「表示しているもの」を持つと、
 * `route.json` にパターンが 1 つ増えた瞬間、既存のプロジェクトではそれが隠れて
 * 現れる。隠す側を持てば、増えたものは既定で見える。
 *
 * ここに置くのは配列の出し入れだけであり、フィルタを実際に効かせるのは場面の
 * 組み立て（`features/diagram/scene.ts`）である。
 */

/**
 * 隠す一覧を書き換える。
 *
 * @param show `true` なら一覧から外す（見せる）、`false` なら加える（隠す）
 * @returns 変わらなければ**同じ参照**（履歴に空の 1 段を積まないため）
 */
export function withHidden<T>(hidden: readonly T[], id: T, show: boolean): readonly T[] {
  const has = hidden.includes(id);
  if (show === !has) return hidden;
  return show ? hidden.filter((value) => value !== id) : [...hidden, id];
}

/** すべて隠す／すべて見せる。 */
export function allHidden<T>(ids: readonly T[], show: boolean): readonly T[] {
  return show ? [] : [...ids];
}

/** 隠れているか。 */
export function isHidden<T>(hidden: readonly T[], id: T): boolean {
  return hidden.includes(id);
}
