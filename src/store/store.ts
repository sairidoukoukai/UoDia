/**
 * アプリ状態のストア（実装計画書 §3.6、T-15／T-16）。
 *
 * ## 更新は必ずコマンドを通す
 *
 * 状態を変える手段は `execute` とその薄い包み（`editProject` / `editNetwork`）
 * だけである。zustand の `setState` は**公開しない**。直接書き換えられると、
 * 履歴に載らない変更が生まれ、undo が「一部だけ戻る」壊れ方をする。しかも
 * その壊れ方は、書き換えた操作ではなく後の undo で表面化するため、原因に
 * 辿り着きにくい。禁じるのは型の上だけでなく**実体としても**行い、公開する
 * のは購読と読み出しと操作だけの入れ物にする。
 *
 * 選択（`ui`）は編集ではないため履歴に載らず、専用の操作を持つ。
 *
 * ## Immer を挟む理由
 *
 * 更新を「書き換えるように書いて、実際は新しい値を作る」形にできる。便 1 つの
 * 時刻を変えるのに、ダイヤと便の配列を手で作り直す必要がなくなる。
 * **変更していない部分の参照が保たれる**ため、セレクタの記憶化（`memo.ts`）も
 * そのまま効く。取り消しに使うパッチは、その副産物として手に入る。
 */

import { applyPatches, enablePatches, produceWithPatches } from 'immer';
import { create } from 'zustand';
import type { NetworkDef, Project } from '@/domain/model';
import { validateNetwork, type NetworkIssue } from '@/domain/network';
import { createHistory, pushHistory, setHistoryLimit, takeRedo, takeUndo } from './history';
import type { AppState, DocumentState } from './types';

// パッチの記録は Immer の任意機能であり、使う前に有効化する必要がある。
enablePatches();

/**
 * 編集の結果。
 *
 * `changed` が `false` なのは、書き換えを試みたが値が変わらなかったとき
 * （同じ時刻を入れ直したなど）。このとき履歴には載せない。載せると、undo を
 * 押しても何も起きない段が積み上がる。
 */
export type ExecuteResult =
  | { readonly ok: true; readonly changed: boolean }
  | { readonly ok: false; readonly issues: readonly NetworkIssue[] };

/** 状態を変える操作。 */
export interface AppActions {
  /**
   * 編集を行い、履歴に積む。
   *
   * `mergeKey` を渡すと、**直前の編集が同じ鍵だったときに 1 操作へまとめる**
   * （同一セルへの連続入力、ドラッグ中の中間状態。仕様書 §6.7）。
   *
   * ネットワーク定義を変えた場合は R-01〜R-10 を検査し、破っていれば
   * **何も変えずに** `ok: false` を返す。壊れた定義を状態に入れると、索引の
   * 組み立て（`buildNetworkIndex`）が例外を投げ、画面全体が落ちる。
   */
  readonly execute: (
    label: string,
    mutator: (document: DocumentState) => void,
    mergeKey?: string,
  ) => ExecuteResult;
  /** プロジェクトを書き換える。開かれていなければ何もしない。 */
  readonly editProject: (
    label: string,
    recipe: (project: Project) => void,
    mergeKey?: string,
  ) => ExecuteResult;
  /** ネットワーク定義を書き換える。読み込まれていなければ何もしない。 */
  readonly editNetwork: (
    label: string,
    recipe: (networkDef: NetworkDef) => void,
    mergeKey?: string,
  ) => ExecuteResult;

  /** 直前の編集を取り消す。取り消せるものが無ければ `false`。 */
  readonly undo: () => boolean;
  /** 取り消した編集をやり直す。やり直せるものが無ければ `false`。 */
  readonly redo: () => boolean;
  /** 履歴段数を変える（既定 100、範囲 10〜1000）。範囲外は丸める。 */
  readonly setHistoryLimit: (limit: number) => void;

  /**
   * ネットワーク定義を読み込む。**編集ではないため履歴を捨てる。**
   *
   * 履歴のパッチは特定の定義の上での位置を指しており、定義が入れ替わると
   * 意味を失う。
   */
  readonly setNetworkDef: (networkDef: NetworkDef) => void;
  /** プロジェクトを開く・新規作成する。履歴と選択を捨てる。 */
  readonly setProject: (project: Project | null) => void;

  /** 選択を置き換える（仕様書 §6.3.1）。 */
  readonly selectTrips: (tripIds: readonly string[]) => void;
  /** 選択に加える。<kbd>Ctrl</kbd> + クリックに対応する。 */
  readonly addToSelection: (tripId: string) => void;
  readonly clearSelection: () => void;
}

export type AppStore = AppState & AppActions;

/**
 * 公開するストア。**`setState` を持たない。**
 *
 * セレクタを省いた呼び出しも受け付けない。状態全体を購読すると、関係のない
 * 変更でも再描画が起きる。
 */
export interface AppStoreHook {
  <T>(selector: (state: AppStore) => T): T;
  getState: () => AppStore;
  subscribe: (listener: (state: AppStore, previous: AppStore) => void) => () => void;
}

const INITIAL_STATE: AppState = {
  networkDef: null,
  project: null,
  ui: { selectedTripIds: [] },
  history: createHistory(),
};

/** ストアを作る。テストごとに独立したものを使えるよう、生成を関数にしている。 */
export function createAppStore(): AppStoreHook {
  const store = create<AppStore>()((set, get) => ({
    ...INITIAL_STATE,

    execute: (label, mutator, mergeKey): ExecuteResult => {
      const { networkDef, project, history } = get();
      const [next, patches, inversePatches] = produceWithPatches(
        { networkDef, project },
        (draft) => {
          mutator(draft);
        },
      );
      if (patches.length === 0) return { ok: true, changed: false };

      // 定義に触れていないときは検査しない。便を 1 つ動かすたびに全規則を
      // 走らせる理由が無い。
      const changedDef = next.networkDef === networkDef ? null : next.networkDef;
      if (changedDef !== null) {
        const issues = validateNetwork(changedDef);
        if (issues.length > 0) return { ok: false, issues };
      }

      set({
        networkDef: next.networkDef,
        project: next.project,
        history: pushHistory(history, { label, patches, inversePatches }, mergeKey ?? null),
      });
      return { ok: true, changed: true };
    },

    editProject: (label, recipe, mergeKey): ExecuteResult =>
      get().execute(
        label,
        (document) => {
          if (document.project === null) return;
          recipe(document.project);
        },
        mergeKey,
      ),

    editNetwork: (label, recipe, mergeKey): ExecuteResult =>
      get().execute(
        label,
        (document) => {
          if (document.networkDef === null) return;
          recipe(document.networkDef);
        },
        mergeKey,
      ),

    undo: (): boolean => {
      const { networkDef, project, history } = get();
      const taken = takeUndo(history);
      if (taken === null) return false;

      set({
        ...applyPatches({ networkDef, project }, taken.entry.inversePatches),
        history: taken.history,
      });
      return true;
    },

    redo: (): boolean => {
      const { networkDef, project, history } = get();
      const taken = takeRedo(history);
      if (taken === null) return false;

      set({
        ...applyPatches({ networkDef, project }, taken.entry.patches),
        history: taken.history,
      });
      return true;
    },

    setHistoryLimit: (limit): void => {
      set({ history: setHistoryLimit(get().history, limit) });
    },

    setNetworkDef: (networkDef): void => {
      set({ networkDef, history: createHistory(get().history.limit) });
    },

    setProject: (project): void => {
      set({
        project,
        history: createHistory(get().history.limit),
        // 別のプロジェクトの便を選んだままにしない。
        ui: { selectedTripIds: [] },
      });
    },

    selectTrips: (tripIds): void => {
      set({ ui: { selectedTripIds: [...tripIds] } });
    },

    addToSelection: (tripId): void => {
      const { selectedTripIds } = get().ui;
      if (selectedTripIds.includes(tripId)) return;
      set({ ui: { selectedTripIds: [...selectedTripIds, tripId] } });
    },

    clearSelection: (): void => {
      set({ ui: { selectedTripIds: [] } });
    },
  }));

  // `setState` を落とすため、必要な入口だけを持つ入れ物に詰め替える。
  const hook = <T>(selector: (state: AppStore) => T): T => store(selector);
  return Object.assign(hook, { getState: store.getState, subscribe: store.subscribe });
}

/** アプリ全体で使うストア。 */
export const useAppStore = createAppStore();
