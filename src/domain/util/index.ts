/**
 * どの領域にも属さない、ごく小さな純関数。
 *
 * 置く条件は 2 つとも満たすこととする。**ダイヤの語彙を含まないこと**（含むなら
 * `time` や `trip` のような領域の名前を持つ場所に置ける）と、**複数の領域から
 * 使われること**（1 つだけなら、その領域の中に置いたほうが近い）。この 2 つを
 * 外すと、置き場所に迷ったものの捨て場になる。
 */

export { adjacentPairs } from './adjacent';

export { parseJson, type ParseJsonResult } from './json';
