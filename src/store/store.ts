/**
 * アプリ状態のストア（実装計画書 §3.6、T-15）。
 *
 * Immer を挟むことで、更新を「書き換えるように書いて、実際は新しい値を作る」
 * 形にする。便 1 つの時刻を変えるのに、ダイヤと便の配列を手で作り直す必要が
 * なくなる。**変更していない部分の参照が保たれる**ため、セレクタの記憶化
 * （`memo.ts`）もそのまま効く。
 *
 * Undo/Redo（T-16）は、ここで行う更新をパッチとして記録する形で入る。
 * その際 `set` は非公開になり、更新は `execute` を通すようになる。
 */

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { Project } from '@/domain/model';
import type { NetworkIndex } from '@/domain/network';
import type { AppState } from './types';

/**
 * 状態を変える操作。
 *
 * メソッドではなく関数の項目として宣言する。`useAppStore((s) => s.setNetwork)`
 * のように取り出して使うため、`this` に依存しない形であることを型で示す。
 */
export interface AppActions {
  /** ネットワーク定義を読み込んだときに設定する。 */
  readonly setNetwork: (network: NetworkIndex) => void;
  /** プロジェクトを開く・新規作成したときに差し替える。 */
  readonly setProject: (project: Project | null) => void;
  /**
   * プロジェクトを書き換える。
   *
   * Immer の下書きを受け取るため、その場で書き換えるように書ける。
   * プロジェクトが開かれていなければ何もしない。
   */
  readonly updateProject: (recipe: (project: Project) => void) => void;
  /** 選択を置き換える（仕様書 §6.3.1）。 */
  readonly selectTrips: (tripIds: readonly string[]) => void;
  /** 選択に加える。<kbd>Ctrl</kbd> + クリックに対応する。 */
  readonly addToSelection: (tripId: string) => void;
  readonly clearSelection: () => void;
}

export type AppStore = AppState & AppActions;

const INITIAL_STATE: AppState = {
  network: null,
  project: null,
  ui: { selectedTripIds: [] },
};

/** ストアを作る。テストごとに独立したものを使えるよう、生成を関数にしている。 */
export function createAppStore() {
  return create<AppStore>()(
    immer((set) => ({
      ...INITIAL_STATE,

      setNetwork: (network): void => {
        set((state) => {
          state.network = network;
        });
      },

      setProject: (project): void => {
        set((state) => {
          state.project = project;
          // 別のプロジェクトの便を選んだままにしない。
          state.ui.selectedTripIds = [];
        });
      },

      updateProject: (recipe): void => {
        set((state) => {
          if (state.project === null) return;
          recipe(state.project);
        });
      },

      selectTrips: (tripIds): void => {
        set((state) => {
          state.ui.selectedTripIds = [...tripIds];
        });
      },

      addToSelection: (tripId): void => {
        set((state) => {
          if (state.ui.selectedTripIds.includes(tripId)) return;
          state.ui.selectedTripIds.push(tripId);
        });
      },

      clearSelection: (): void => {
        set((state) => {
          state.ui.selectedTripIds = [];
        });
      },
    })),
  );
}

/** アプリ全体で使うストア。 */
export const useAppStore = createAppStore();
