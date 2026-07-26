/**
 * Undo/Redo の履歴（仕様書 §6.7、実装計画書 §3.2）。
 *
 * Immer の `produceWithPatches` が返すパッチと逆パッチを積む。状態全体を複製する
 * 方式でも 100 便規模なら成立するが、状態管理に Immer を使う以上パッチは副産物
 * として手に入るため、追加の費用なしにメモリ効率のほうを取れる。
 *
 * 本モジュールは**パッチの中身を解釈しない**。積む・取り出す・上限で捨てるだけを
 * 引き受け、実際に状態へ当てるのはストアの仕事とする。こうすると履歴の規則を
 * Immer もストアも無しに試験できる。
 *
 * ## 連続操作のまとめ方
 *
 * 同一セルへの連続入力やドラッグ中の中間状態を 1 回の undo で戻すため、呼び出し側は
 * `mergeKey` を渡す。**直前の操作が同じ鍵を持っていたときだけ**まとめる。
 *
 * まとめてよいかどうかを `past` の末尾の鍵ではなく `openMergeKey` で持つのは、
 * undo・redo をまたいだ後にまとめてはならないためである。undo で戻ってきた
 * 末尾の操作に続きを足すと、利用者から見れば「戻したはずの操作が復活して、
 * しかも 1 回では戻せない」状態になる。鍵を操作自身にも持たせると、この
 * 「もう閉じた」という事実と二重管理になり、食い違う余地が生まれる。
 */

import type { Patch } from 'immer';

/** 履歴段数の既定値と範囲（仕様書 §6.7）。 */
export const DEFAULT_HISTORY_LIMIT = 100;
export const MIN_HISTORY_LIMIT = 10;
export const MAX_HISTORY_LIMIT = 1000;

/** 1 回の編集操作。 */
export interface HistoryEntry {
  /** メニューに出す操作名（例: 「時刻の入力」）。 */
  readonly label: string;
  /** やり直しに使うパッチ。 */
  readonly patches: readonly Patch[];
  /** 取り消しに使う逆パッチ。 */
  readonly inversePatches: readonly Patch[];
}

export interface History {
  /** 取り消せる操作。末尾が直近。 */
  readonly past: readonly HistoryEntry[];
  /** やり直せる操作。先頭が直近。 */
  readonly future: readonly HistoryEntry[];
  readonly limit: number;
  /** 次の操作がまとめて良い鍵。まとめられる操作が無ければ `null`。 */
  readonly openMergeKey: string | null;
}

/**
 * 履歴段数を範囲に収める。
 *
 * 設定欄から来る値であり、範囲外や整数でない値が届きうる。**弾かずに丸める**
 * のは、履歴段数が編集内容に影響しない設定であり、入力を拒んで操作を止める
 * ほどの重みが無いためである。
 */
export function clampHistoryLimit(limit: number): number {
  if (!Number.isFinite(limit)) return DEFAULT_HISTORY_LIMIT;
  return Math.min(MAX_HISTORY_LIMIT, Math.max(MIN_HISTORY_LIMIT, Math.round(limit)));
}

export function createHistory(limit: number = DEFAULT_HISTORY_LIMIT): History {
  return { past: [], future: [], limit: clampHistoryLimit(limit), openMergeKey: null };
}

export function canUndo(history: History): boolean {
  return history.past.length > 0;
}

export function canRedo(history: History): boolean {
  return history.future.length > 0;
}

/**
 * 操作を積む。やり直せる操作はすべて捨てる。
 *
 * 分岐した歴史を保つ設計もあるが、どちらの枝に居るかを利用者に示す手段が
 * 要る。ダイヤ編集にその複雑さを持ち込む理由が無い。
 */
export function pushHistory(
  history: History,
  entry: HistoryEntry,
  mergeKey: string | null,
): History {
  const past = [...history.past];
  // まとめて良いときだけ末尾を取り出す。履歴が空なら取り出せず、そのまま積まれる。
  const previous = mergeKey !== null && history.openMergeKey === mergeKey ? past.pop() : undefined;
  past.push(previous === undefined ? entry : merge(previous, entry));

  return {
    past: trim(past, history.limit),
    future: [],
    limit: history.limit,
    openMergeKey: mergeKey,
  };
}

/** 履歴段数を変える。既に上限を超えていれば古いものから捨てる。 */
export function setHistoryLimit(history: History, limit: number): History {
  const next = clampHistoryLimit(limit);
  return { ...history, limit: next, past: trim(history.past, next) };
}

/** 取り消す操作を 1 つ取り出す。取り消せなければ `null`。 */
export function takeUndo(history: History): { history: History; entry: HistoryEntry } | null {
  const past = [...history.past];
  const entry = past.pop();
  if (entry === undefined) return null;

  return {
    history: { ...history, past, future: [entry, ...history.future], openMergeKey: null },
    entry,
  };
}

/** やり直す操作を 1 つ取り出す。やり直せなければ `null`。 */
export function takeRedo(history: History): { history: History; entry: HistoryEntry } | null {
  const [entry, ...future] = history.future;
  if (entry === undefined) return null;

  return {
    history: {
      ...history,
      past: trim([...history.past, entry], history.limit),
      future,
      openMergeKey: null,
    },
    entry,
  };
}

/**
 * 2 つの操作を 1 つにまとめる。
 *
 * 逆パッチは**後の操作のぶんを先に**当てる必要がある。先に前の操作を戻すと、
 * 後の操作が前提としていた状態が失われる。名前は前の操作のものを残す。
 * 連続入力の途中で表示名が変わると、何を戻すのか読めなくなる。
 */
function merge(previous: HistoryEntry, entry: HistoryEntry): HistoryEntry {
  return {
    label: previous.label,
    patches: [...previous.patches, ...entry.patches],
    inversePatches: [...entry.inversePatches, ...previous.inversePatches],
  };
}

/** 上限を超えたぶんを古いほうから捨てる。 */
function trim(past: readonly HistoryEntry[], limit: number): readonly HistoryEntry[] {
  return past.length <= limit ? past : past.slice(past.length - limit);
}
