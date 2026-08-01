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

import { applyPatches, enablePatches, produceWithPatches, type Patch } from 'immer';
import { create } from 'zustand';
import type { DiagramView, NetworkDef, Project, Trip } from '@/domain/model';
import { validateNetwork, type NetworkIssue } from '@/domain/network';
import type { FileHandle } from '@/platform';
import {
  createHistory,
  pushHistory,
  setHistoryLimit,
  takeRedo,
  takeUndo,
  type History,
  type HistoryEntry,
} from './history';
import type { AppState, DocumentState, SelectionRect, TripShift } from './types';

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
  /**
   * プロジェクトを開く・新規作成する。履歴と選択を捨てる。
   *
   * 開いた直後は保存済みの状態である。読み込んだ内容をそのまま
   * 「保存した時点の内容」として覚える。
   */
  readonly setProject: (project: Project | null, handle?: FileHandle | null) => void;
  /**
   * バックアップから復元する（仕様書 §9.2、T-18）。
   *
   * **最初から未保存として扱う。** 復元した内容はどこにも保存されておらず、
   * 保存済みに見せると、そのまま閉じて同じ内容をもう一度失うことになる。
   * 保存先も引き継がない（理由は `domain/io/backup.ts`）。
   */
  readonly restoreProject: (project: Project) => void;
  /**
   * 保存が済んだことを記録する。**履歴は捨てない。**
   *
   * 保存は編集ではないため、保存したあとも直前の編集を取り消せる必要がある。
   * `meta.updatedAt` を打ち直した内容を受け取るのは、書き出したバイト列と
   * 状態の中身を一致させるためである。ずれていると、保存した直後から
   * 「未保存」に見える。
   */
  readonly markSaved: (project: Project, handle: FileHandle | null) => void;

  /** 選択を置き換える（仕様書 §6.3.1）。 */
  readonly selectTrips: (tripIds: readonly string[]) => void;
  /** 選択に加える。<kbd>Ctrl</kbd> + クリックに対応する。 */
  readonly addToSelection: (tripId: string) => void;
  readonly clearSelection: () => void;

  /**
   * 便を写す（仕様書 §8.1 の <kbd>Ctrl</kbd>+<kbd>C</kbd>、T-53）。
   *
   * 履歴に載せない。写すことは編集ではなく、取り消しで戻ってきてほしいもので
   * もない（選択と同じ扱い）。
   */
  readonly copyTrips: (trips: readonly Trip[]) => void;

  /**
   * ダイヤグラムの視野を変える（仕様書 §6.2.3、T-27）。
   *
   * **履歴に載せない。** 画面を送ることも拡げることも編集ではない。undo が
   * 「さっき縮めたぶん」を戻し始めたら、便を直した記憶にたどり着けない。
   *
   * **未保存にもしない。** 視野はファイルに保存されるが（仕様書 §5.10）、それは
   * 開き直したときの便宜であって、保存を促すほどの中身ではない。
   */
  readonly setDiagramView: (view: DiagramView) => void;

  /**
   * 矩形選択の途中経過を置く（仕様書 §6.3.1、T-28）。
   *
   * 履歴に載せない。囲んでいる最中の枠は編集の結果ではない。
   */
  readonly setSelectionRect: (rect: SelectionRect | null) => void;

  /**
   * 引きずっている最中の移動量を置く（仕様書 §6.3.2、T-29）。
   *
   * 履歴に載せない。便そのものの移動は `editProject` が積む。
   */
  readonly setTripShift: (shift: TripShift | null) => void;
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
  ui: { selectedTripIds: [], clipboard: [], selectionRect: null, tripShift: null },
  history: createHistory(),
  file: { handle: null, savedProject: null },
};

/** ストアを作る。テストごとに独立したものを使えるよう、生成を関数にしている。 */
export function createAppStore(): AppStoreHook {
  const store = create<AppStore>()((set, get) => {
    /**
     * 履歴から取り出した 1 段を状態に当てる。取り出せていなければ何もしない。
     *
     * 取り消しとやり直しは、どの段を取り出すか（`takeUndo` / `takeRedo`）と
     * どちら向きのパッチを当てるか（逆パッチ / パッチ）しか違わない。同じ手順を
     * 2 度書くと、片方だけ直した変更が「やり直しだけ壊れている」形で残る。
     */
    const applyStep = (
      taken: { history: History; entry: HistoryEntry } | null,
      patchesOf: (entry: HistoryEntry) => readonly Patch[],
    ): boolean => {
      if (taken === null) return false;

      const { networkDef, project } = get();
      set({
        ...applyPatches({ networkDef, project }, patchesOf(taken.entry)),
        history: taken.history,
      });
      return true;
    };

    return {
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

      undo: (): boolean => applyStep(takeUndo(get().history), (entry) => entry.inversePatches),

      redo: (): boolean => applyStep(takeRedo(get().history), (entry) => entry.patches),

      setHistoryLimit: (limit): void => {
        set({ history: setHistoryLimit(get().history, limit) });
      },

      setNetworkDef: (networkDef): void => {
        set({ networkDef, history: createHistory(get().history.limit) });
      },

      setProject: (project, handle = null): void => {
        set({
          project,
          history: createHistory(get().history.limit),
          // 別のプロジェクトの便を選んだままにしない。
          ui: { selectedTripIds: [], clipboard: [], selectionRect: null, tripShift: null },
          file: { handle, savedProject: project },
        });
      },

      restoreProject: (project): void => {
        set({
          project,
          history: createHistory(get().history.limit),
          ui: { selectedTripIds: [], clipboard: [], selectionRect: null, tripShift: null },
          // savedProject を null にすることで未保存になる（`selectIsDirty`）。
          file: { handle: null, savedProject: null },
        });
      },

      markSaved: (project, handle): void => {
        set({ project, file: { handle, savedProject: project } });
      },

      selectTrips: (tripIds): void => {
        set({ ui: { ...get().ui, selectedTripIds: [...tripIds] } });
      },

      addToSelection: (tripId): void => {
        const { ui } = get();
        if (ui.selectedTripIds.includes(tripId)) return;
        set({ ui: { ...ui, selectedTripIds: [...ui.selectedTripIds, tripId] } });
      },

      clearSelection: (): void => {
        set({ ui: { ...get().ui, selectedTripIds: [] } });
      },

      copyTrips: (trips): void => {
        set({ ui: { ...get().ui, clipboard: [...trips] } });
      },

      setSelectionRect: (selectionRect): void => {
        if (get().ui.selectionRect === selectionRect) return;
        set({ ui: { ...get().ui, selectionRect } });
      },

      setTripShift: (tripShift): void => {
        if (get().ui.tripShift === tripShift) return;
        set({ ui: { ...get().ui, tripShift } });
      },

      setDiagramView: (diagram): void => {
        const { project, file } = get();
        if (project === null || project.view.diagram === diagram) return;

        const next: Project = { ...project, view: { ...project.view, diagram } };
        set({
          project: next,
          // **保存済みだったなら保存済みのままにする。** 未保存かどうかは
          // 「保存した内容と同じ参照か」で決まるため（`selectIsDirty`）、
          // 何もしないと画面を送っただけで未保存になり、閉じるたびに
          // 保存を尋ねられる。編集中（既に未保存）なら触らない。
          file: file.savedProject === project ? { ...file, savedProject: next } : file,
        });
      },
    };
  });

  // `setState` を落とすため、必要な入口だけを持つ入れ物に詰め替える。
  const hook = <T>(selector: (state: AppStore) => T): T => store(selector);
  return Object.assign(hook, { getState: store.getState, subscribe: store.subscribe });
}

/** アプリ全体で使うストア。 */
export const useAppStore = createAppStore();
