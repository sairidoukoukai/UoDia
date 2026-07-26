/**
 * 並びの中の隣り合う 2 要素を扱う。
 *
 * ダイヤのデータは「隣どうしの関係」で意味が決まるものが多い。パターンの隣接
 * 停留所対が区間表にあるか（R-03）、前便の終着と次便の始発が繋がっているか
 * （V-01）、便と便の隙間が営業所待機になっているか（§5.8）——いずれも同じ形の
 * 反復である。
 *
 * 素直に添字で書くと `values[index - 1]` が `noUncheckedIndexedAccess` のもとで
 * `undefined` を含み、**到達し得ない分岐**を書く羽目になる。それを避けるために
 * 「直前の要素を持ち回り、`undefined` かどうかで先頭を見分ける」書き方が各所へ
 * 散っていた。持ち回る変数と、それを進める代入と、先頭を除く条件が呼び出し側の
 * 見通しを塞ぐため、ここへ寄せる。
 */

/** 先頭要素をまだ見ていないことを表す印。 */
const NOT_STARTED = Symbol('notStarted');

/**
 * 隣り合う 2 要素の組を、並びの順に返す。
 *
 * 要素が 1 つ以下なら空になる。3 つ目の値は `right` の元の並びでの位置であり、
 * 問題の箇所を指し示す必要がある検証で使う（`left` の位置は 1 つ手前）。
 *
 * ```
 * adjacentPairs(['a', 'b', 'c'])  // [['a','b',1], ['b','c',2]]
 * ```
 */
export function adjacentPairs<T>(
  values: Iterable<T>,
): readonly (readonly [left: T, right: T, rightIndex: number])[] {
  const pairs: (readonly [T, T, number])[] = [];
  // `T | undefined` を印に使えない。`T` 自身が `undefined` を含みうるため、
  // 先頭かどうかと「値が undefined だった」ことを見分けられなくなる。
  let left: T | typeof NOT_STARTED = NOT_STARTED;
  let index = 0;

  for (const right of values) {
    if (left !== NOT_STARTED) pairs.push([left, right, index]);
    left = right;
    index++;
  }

  return pairs;
}
