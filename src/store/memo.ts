/**
 * 直前の呼び出し 1 回分だけを覚える記憶化。
 *
 * 派生値を返すセレクタは、呼ばれるたびに新しい配列やオブジェクトを作る。
 * React はセレクタの戻り値を `Object.is` で比べるため、**中身が同じでも
 * 参照が変わると再描画が起きる**。100 便を再描画するのが選択の移動のたびに
 * 起こると、操作が目に見えて重くなる。
 *
 * 比較は**参照の同一性**で行う。Immer は変更していない部分の参照を保つため
 * （構造共有）、便を 1 つ書き換えても他のダイヤの配列は同じ参照のままである。
 * 中身を見比べる必要がない。
 *
 * 覚えるのは 1 回分だけとする。セレクタは同じ状態に対して繰り返し呼ばれる
 * ものであり、履歴を持っても当たらないうえ、状態を掴んだまま離さなくなる。
 */

/** 引数がすべて同一なら前回の結果を返す関数を作る。 */
export function memoizeByIdentity<Args extends readonly unknown[], Result>(
  compute: (...args: Args) => Result,
): (...args: Args) => Result {
  let lastArgs: Args | null = null;
  let lastResult: Result;

  return (...args: Args): Result => {
    if (lastArgs !== null && sameArgs(lastArgs, args)) {
      return lastResult;
    }
    lastArgs = args;
    lastResult = compute(...args);
    return lastResult;
  };
}

function sameArgs(a: readonly unknown[], b: readonly unknown[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((value, index) => Object.is(value, b[index]));
}
