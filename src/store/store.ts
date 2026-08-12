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
import {
  clampSplitRatio,
  diagramViewSchema,
  type DiagramView,
  type DirectionId,
  type NetworkDef,
  type Project,
  type Trip,
} from '@/domain/model';
import { validateNetwork, type NetworkIssue } from '@/domain/network';
import type { FileHandle } from '@/platform';
import {
  DEFAULT_BACKUP_INTERVAL_MS,
  DEFAULT_THEME,
  NO_GRID_STYLE_OVERRIDES,
  NO_PATTERN_STYLES,
  clampBackupInterval,
} from './settings';
import {
  createHistory,
  pushHistory,
  setHistoryLimit,
  takeRedo,
  takeUndo,
  type History,
  type HistoryEntry,
} from './history';
import type {
  AppSettings,
  AppState,
  DiagramTool,
  DocumentState,
  MaximizedPane,
  SelectionRect,
  TripShift,
  UiState,
} from './types';

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
  /**
   * 文書が持つ路線を書き換える（T-89）。開いていなければ何もしない。
   *
   * **`editProject` と同じ履歴に積まれる。** 元からそうだったが、保存先が
   * 分かれていたために未保存の判定から漏れていた。路線が文書に入ったことで
   * 揃う。
   */
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
   * 設定を変える（仕様書 §6.5.2、§6.5.3、T-35）。
   *
   * **履歴に載せない。** 道具の使い方を変えることは、便の編集ではない。
   */
  readonly setSettings: (settings: Partial<AppSettings>) => void;

  /**
   * 新しい文書を始めるための路線を載せる（T-89）。
   *
   * **履歴を捨てない。** 文書ではないため、取り消しの対象に入らない
   * （`setNetworkDef` は捨てていた——あちらは文書の一部だった）。
   */
  readonly setSeedNetworkDef: (networkDef: NetworkDef) => void;
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
   * 上下 2 分割の比率を変える（仕様書 §6.4、T-32）。範囲外は丸める。
   *
   * `setDiagramView` と同じ扱いである。**履歴に載せず、未保存にもしない。**
   * 境界を動かすことは編集ではない。
   */
  readonly setSplitRatio: (ratio: number) => void;

  /**
   * 検証パネルを開く・閉じる（仕様書 §6.6、T-34）。
   *
   * **履歴に載せず、未保存にもしない。** 送りや分割と同じで、どこを見ているかを
   * 変えただけである。何を見るか（着色・フィルタ・編集中のダイヤ）は編集として
   * 履歴に載るが、パネルの開閉はそれには当たらない。
   */
  readonly setValidationPanelOpen: (open: boolean) => void;

  /**
   * 時刻表の方向タブを切り替える（仕様書 §6.1.1、T-38）。
   *
   * **履歴に載せない。** 同じダイヤの別の面を見るだけであり、どこを見ているかを
   * 変えたに過ぎない。T-38 で**選択に追随して自動で切り替わる**ようになったため、
   * 履歴に載せると、利用者が押していない操作が取り消しの段に積まれる。
   */
  readonly setActiveDirection: (directionId: DirectionId) => void;

  /**
   * 片方を最大化する（仕様書 §6.4、T-32）。`null` で 2 分割へ戻す。
   *
   * 保存しないため、ここだけはプロジェクトに触れない（`ui`）。
   */
  readonly setMaximizedPane: (pane: MaximizedPane) => void;

  /**
   * ダイヤグラムの道具を選ぶ（仕様書 §6.3.3、T-30）。
   *
   * 保存も履歴もしない。**便を作る手立てそのものではなく、次の左ボタンが何を
   * するかを決めるだけ**である。
   */
  readonly setTool: (tool: DiagramTool) => void;

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
  project: null,
  seedNetworkDef: null,
  ui: {
    selectedTripIds: [],
    clipboard: [],
    selectionRect: null,
    tripShift: null,
    maximized: null,
    tool: 'select',
  },
  history: createHistory(),
  file: { handle: null, savedProject: null },
  settings: {
    theme: DEFAULT_THEME,
    backupIntervalMs: DEFAULT_BACKUP_INTERVAL_MS,
    defaultDiagramView: diagramViewSchema.parse({}),
    stopGridStyles: NO_GRID_STYLE_OVERRIDES,
    patternStyles: NO_PATTERN_STYLES,
    patternsUnlocked: false,
  },
};

/**
 * 別のプロジェクトへ持ち越さない画面の状態を捨てる。
 *
 * **最大化だけは残す。** 選択や写した便は「このプロジェクトの便」を指しており、
 * 別のものを開けば意味を失う。最大化は画面の姿であって、どのファイルを開いて
 * いるかとは関わりが無い。開いた拍子に分割が戻ると、開き直したように見える。
 */
function clearedUi(ui: UiState): UiState {
  return { ...INITIAL_STATE.ui, maximized: ui.maximized, tool: ui.tool };
}

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

      const { project } = get();
      set({
        ...applyPatches({ project }, patchesOf(taken.entry)),
        history: taken.history,
      });
      return true;
    };

    /**
     * 表示設定を履歴に載せずに書き換える（視野・分割比率）。
     *
     * **保存済みだったなら保存済みのままにする。** 未保存かどうかは「保存した
     * 内容と同じ参照か」で決まるため（`selectIsDirty`）、何もしないと画面を
     * 送っただけ・境界を動かしただけで未保存になり、閉じるたびに保存を
     * 尋ねられる。編集中（既に未保存）なら触らない。
     */
    const setView = (view: Project['view']): void => {
      const { project, file } = get();
      if (project === null) return;

      const next: Project = { ...project, view };
      set({
        project: next,
        file: file.savedProject === project ? { ...file, savedProject: next } : file,
      });
    };

    return {
      ...INITIAL_STATE,

      execute: (label, mutator, mergeKey): ExecuteResult => {
        const { project, history } = get();
        const [next, patches, inversePatches] = produceWithPatches({ project }, (draft) => {
          mutator(draft);
        });
        if (patches.length === 0) return { ok: true, changed: false };

        // 路線に触れていないときは検査しない。便を 1 つ動かすたびに全規則を
        // 走らせる理由が無い。**参照で見る**——路線は文書の中にあるが、
        // Immer は触っていない枝の参照を保つ（T-89）。
        const changedDef =
          next.project?.network === project?.network ? null : (next.project?.network ?? null);
        if (changedDef !== null) {
          const issues = validateNetwork(changedDef);
          if (issues.length > 0) return { ok: false, issues };
        }

        set({
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
            if (document.project === null) return;
            recipe(document.project.network);
          },
          mergeKey,
        ),

      undo: (): boolean => applyStep(takeUndo(get().history), (entry) => entry.inversePatches),

      redo: (): boolean => applyStep(takeRedo(get().history), (entry) => entry.patches),

      setSettings: (settings): void => {
        const current = get().settings;
        const next = { ...current, ...settings };
        set({
          settings: { ...next, backupIntervalMs: clampBackupInterval(next.backupIntervalMs) },
        });
      },

      setHistoryLimit: (limit): void => {
        set({ history: setHistoryLimit(get().history, limit) });
      },

      setSeedNetworkDef: (seedNetworkDef): void => {
        set({ seedNetworkDef });
      },

      setProject: (project, handle = null): void => {
        set({
          project,
          history: createHistory(get().history.limit),
          // 別のプロジェクトの便を選んだままにしない。
          ui: clearedUi(get().ui),
          file: { handle, savedProject: project },
        });
      },

      restoreProject: (project): void => {
        set({
          project,
          history: createHistory(get().history.limit),
          ui: clearedUi(get().ui),
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
        const { project } = get();
        if (project === null || project.view.diagram === diagram) return;
        setView({ ...project.view, diagram });
      },

      setSplitRatio: (ratio): void => {
        const { project } = get();
        const splitRatio = clampSplitRatio(ratio);
        if (project === null || project.view.splitRatio === splitRatio) return;
        setView({ ...project.view, splitRatio });
      },

      setActiveDirection: (activeDirection): void => {
        const { project } = get();
        if (project === null || project.view.activeDirection === activeDirection) return;
        setView({ ...project.view, activeDirection });
      },

      setValidationPanelOpen: (open): void => {
        const { project } = get();
        if (project === null || project.view.validationPanelOpen === open) return;
        setView({ ...project.view, validationPanelOpen: open });
      },

      setMaximizedPane: (maximized): void => {
        const { ui } = get();
        if (ui.maximized === maximized) return;
        set({ ui: { ...ui, maximized } });
      },

      setTool: (tool): void => {
        const { ui } = get();
        if (ui.tool === tool) return;
        set({ ui: { ...ui, tool } });
      },
    };
  });

  // `setState` を落とすため、必要な入口だけを持つ入れ物に詰め替える。
  const hook = <T>(selector: (state: AppStore) => T): T => store(selector);
  return Object.assign(hook, { getState: store.getState, subscribe: store.subscribe });
}

/** アプリ全体で使うストア。 */
export const useAppStore = createAppStore();
