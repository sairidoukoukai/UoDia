/**
 * 履歴の規則の検証（T-16）。
 *
 * パッチの中身は解釈しないため、ここでは**識別できるだけの中身**を持つ操作を
 * 使う。実際にパッチを当てて状態が戻ることは `store.test.ts` で確かめる。
 */

import type { Patch } from 'immer';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_HISTORY_LIMIT,
  MAX_HISTORY_LIMIT,
  MIN_HISTORY_LIMIT,
  canRedo,
  canUndo,
  clampHistoryLimit,
  createHistory,
  pushHistory,
  setHistoryLimit,
  takeRedo,
  takeUndo,
  type History,
  type HistoryEntry,
} from './history';

/** 名前で見分けられるだけの操作。パッチも名前を入れて順序を追えるようにする。 */
function entry(label: string): HistoryEntry {
  return {
    label,
    patches: [{ op: 'replace', path: ['x'], value: label }],
    inversePatches: [{ op: 'replace', path: ['x'], value: `${label}の前` }],
  };
}

/** パッチに入れた印。`Patch.value` は `any` のため、ここで一度だけ受け止める。 */
function marks(patches: readonly Patch[]): unknown[] {
  return patches.map((patch) => patch.value as unknown);
}

/** 履歴に積まれている操作の名前。 */
function labels(history: History): string[] {
  return history.past.map((e) => e.label);
}

describe('履歴段数', () => {
  it('既定は 100 段', () => {
    expect(createHistory().limit).toBe(DEFAULT_HISTORY_LIMIT);
  });

  it('範囲は 10〜1000 段に丸める', () => {
    expect(clampHistoryLimit(1)).toBe(MIN_HISTORY_LIMIT);
    expect(clampHistoryLimit(9999)).toBe(MAX_HISTORY_LIMIT);
    expect(clampHistoryLimit(50)).toBe(50);
  });

  it('整数でない値は四捨五入する', () => {
    expect(clampHistoryLimit(50.4)).toBe(50);
    expect(clampHistoryLimit(50.6)).toBe(51);
  });

  it('数として読めない値は既定に倒す', () => {
    expect(clampHistoryLimit(Number.NaN)).toBe(DEFAULT_HISTORY_LIMIT);
    expect(clampHistoryLimit(Number.POSITIVE_INFINITY)).toBe(DEFAULT_HISTORY_LIMIT);
  });

  it('**上限を超えると最古の操作から捨てる**', () => {
    let history = createHistory(MIN_HISTORY_LIMIT);
    for (let i = 0; i < 12; i += 1) {
      history = pushHistory(history, entry(`操作${String(i)}`), null);
    }
    expect(history.past).toHaveLength(MIN_HISTORY_LIMIT);
    expect(labels(history)[0]).toBe('操作2');
  });

  it('段数を減らすと、あふれたぶんをその場で捨てる', () => {
    let history = createHistory(20);
    for (let i = 0; i < 15; i += 1) {
      history = pushHistory(history, entry(`操作${String(i)}`), null);
    }
    history = setHistoryLimit(history, 10);
    expect(history.past).toHaveLength(10);
    expect(labels(history)[0]).toBe('操作5');
  });

  it('段数を増やしても既にある履歴は残る', () => {
    const history = setHistoryLimit(pushHistory(createHistory(10), entry('操作'), null), 1000);
    expect(history.limit).toBe(1000);
    expect(labels(history)).toEqual(['操作']);
  });
});

describe('積む・取り消す・やり直す', () => {
  it('取り消せるものが無ければ null', () => {
    expect(takeUndo(createHistory())).toBeNull();
    expect(canUndo(createHistory())).toBe(false);
  });

  it('やり直せるものが無ければ null', () => {
    expect(takeRedo(createHistory())).toBeNull();
    expect(canRedo(createHistory())).toBe(false);
  });

  it('積んだ操作を新しい順に取り出す', () => {
    let history = pushHistory(createHistory(), entry('1つめ'), null);
    history = pushHistory(history, entry('2つめ'), null);

    const first = takeUndo(history);
    expect(first?.entry.label).toBe('2つめ');
    const second = first === null ? null : takeUndo(first.history);
    expect(second?.entry.label).toBe('1つめ');
    expect(second === null ? true : canUndo(second.history)).toBe(false);
  });

  it('取り消した操作はやり直せる', () => {
    const history = pushHistory(createHistory(), entry('操作'), null);
    const undone = takeUndo(history);
    expect(undone === null ? null : canRedo(undone.history)).toBe(true);

    const redone = undone === null ? null : takeRedo(undone.history);
    expect(redone?.entry.label).toBe('操作');
    expect(redone === null ? [] : labels(redone.history)).toEqual(['操作']);
    expect(redone === null ? true : canRedo(redone.history)).toBe(false);
  });

  it('**新しい操作をするとやり直せる操作は消える**', () => {
    let history = pushHistory(createHistory(), entry('1つめ'), null);
    const undone = takeUndo(history);
    if (undone === null) throw new Error('取り消せるはず');

    history = pushHistory(undone.history, entry('別の操作'), null);
    expect(canRedo(history)).toBe(false);
    expect(labels(history)).toEqual(['別の操作']);
  });

  it('やり直しで上限を超えないよう古いほうから捨てる', () => {
    let history = createHistory(20);
    for (let i = 0; i < 20; i += 1) {
      history = pushHistory(history, entry(`操作${String(i)}`), null);
    }
    const undone = takeUndo(history);
    if (undone === null) throw new Error('取り消せるはず');

    // 取り消した後に段数を減らすと、やり直しの戻し先が上限を超える。
    const redone = takeRedo(setHistoryLimit(undone.history, MIN_HISTORY_LIMIT));
    expect(redone?.history.past).toHaveLength(MIN_HISTORY_LIMIT);
    expect(redone?.entry.label).toBe('操作19');
  });
});

describe('連続操作のまとめ', () => {
  it('**同じ鍵の連続操作は 1 段にまとまる**', () => {
    let history = pushHistory(createHistory(), entry('あ'), 'セル1');
    history = pushHistory(history, entry('あい'), 'セル1');
    history = pushHistory(history, entry('あいう'), 'セル1');

    expect(history.past).toHaveLength(1);
  });

  it('まとめた操作は最初の名前を残す', () => {
    let history = pushHistory(createHistory(), entry('時刻の入力'), 'セル1');
    history = pushHistory(history, entry('別名'), 'セル1');
    expect(labels(history)).toEqual(['時刻の入力']);
  });

  it('やり直しは古い順、取り消しは新しい順に並べる', () => {
    let history = pushHistory(createHistory(), entry('1'), 'セル1');
    history = pushHistory(history, entry('2'), 'セル1');

    const merged = history.past[0];
    expect(marks(merged?.patches ?? [])).toEqual(['1', '2']);
    // 逆パッチは後の操作から当てないと、前の操作が前提とした状態が失われる。
    expect(marks(merged?.inversePatches ?? [])).toEqual(['2の前', '1の前']);
  });

  it('鍵が違えば別の段になる', () => {
    let history = pushHistory(createHistory(), entry('セル1への入力'), 'セル1');
    history = pushHistory(history, entry('セル2への入力'), 'セル2');
    expect(labels(history)).toEqual(['セル1への入力', 'セル2への入力']);
  });

  it('鍵の無い操作を挟むとまとまらない', () => {
    let history = pushHistory(createHistory(), entry('1'), 'セル1');
    history = pushHistory(history, entry('間の操作'), null);
    history = pushHistory(history, entry('2'), 'セル1');
    expect(labels(history)).toEqual(['1', '間の操作', '2']);
  });

  it('**取り消しをまたぐとまとまらない**', () => {
    let history = pushHistory(createHistory(), entry('1'), 'セル1');
    const undone = takeUndo(history);
    if (undone === null) throw new Error('取り消せるはず');

    history = pushHistory(undone.history, entry('2'), 'セル1');
    expect(labels(history)).toEqual(['2']);
  });

  it('やり直しをまたいでもまとまらない', () => {
    const history = pushHistory(createHistory(), entry('1'), 'セル1');
    const undone = takeUndo(history);
    const redone = undone === null ? null : takeRedo(undone.history);
    if (redone === null) throw new Error('やり直せるはず');

    expect(labels(pushHistory(redone.history, entry('2'), 'セル1'))).toEqual(['1', '2']);
  });
});
