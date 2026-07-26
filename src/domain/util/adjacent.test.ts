import { describe, expect, it } from 'vitest';
import { adjacentPairs } from './adjacent';

describe('adjacentPairs', () => {
  it('隣り合う組を並びの順に返す', () => {
    expect(adjacentPairs(['a', 'b', 'c'])).toEqual([
      ['a', 'b', 1],
      ['b', 'c', 2],
    ]);
  });

  it('添字は右側の要素の位置を指す', () => {
    // 検証の指摘は「繋がらなかった側」を指す必要がある。左側の位置はその 1 つ手前。
    expect(adjacentPairs(['a', 'b', 'c', 'd']).map(([, , index]) => index)).toEqual([1, 2, 3]);
  });

  it('要素が 1 つなら組は無い', () => {
    expect(adjacentPairs(['a'])).toEqual([]);
  });

  it('空の並びなら組は無い', () => {
    expect(adjacentPairs([])).toEqual([]);
  });

  it('同じ値が並んでも組にする', () => {
    // 停留所の重複（R-10 違反）や同時刻の便は、検証が拾うべき入力である。
    // ここで畳んでしまうと検証に届かない。
    expect(adjacentPairs(['a', 'a'])).toEqual([['a', 'a', 1]]);
  });

  it('**要素が undefined でも先頭と見分ける**', () => {
    // 直前の要素を `T | undefined` で持ち回る実装だと、先頭と「値が undefined
    // だった」場合を区別できず、組が 1 つ落ちる。
    expect(adjacentPairs([undefined, undefined])).toEqual([[undefined, undefined, 1]]);
  });

  it('配列以外の反復可能なものも受け取る', () => {
    // Map の反復（時刻の並びなど）をそのまま渡せる必要がある。
    const times = new Map([
      ['S1', 100],
      ['S2', 200],
    ]);
    expect(adjacentPairs(times.keys())).toEqual([['S1', 'S2', 1]]);
  });

  it('元の並びを書き換えない', () => {
    const values = ['a', 'b', 'c'];
    adjacentPairs(values);
    expect(values).toEqual(['a', 'b', 'c']);
  });
});
