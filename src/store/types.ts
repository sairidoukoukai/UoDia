/**
 * アプリ状態の形（実装計画書 §3.6）。
 *
 * **派生値を状態に持たない。** 停留所ごとの時刻・運用の導出値・検証結果は、
 * すべてセレクタで計算する（`selectors.ts`）。持たせると、便を 1 つ書き換える
 * たびに派生値を更新して回る必要があり、更新し忘れた箇所が「画面によって
 * 値が違う」という形で現れる。
 *
 * ## 表示設定を `ui` に置かない
 *
 * 実装計画書 §3.6 の草案では `ui` に `activeServiceId` や `splitRatio` を
 * 置いていたが、これらは `project.view` として**ファイルに保存される**
 * （仕様書 §5.10、§7.2）。両方に置くと、どちらが正かを決める規則が要る。
 *
 * `ui` に残すのは**保存しない状態だけ**である。選択は開き直したときに
 * 復元しないため、ここに置く。
 */

import type { Project } from '@/domain/model';
import type { NetworkIndex } from '@/domain/network';

/** 保存しない状態。 */
export interface UiState {
  /** 選択中の便。時刻表とダイヤグラムで共有する（仕様書 §6.3.1）。 */
  readonly selectedTripIds: readonly string[];
}

export interface AppState {
  /**
   * ネットワーク定義。読込前は `null`。
   *
   * 読込は非同期であり、その間も画面は立ち上がっている。`null` を許さない形に
   * すると、読込が終わるまでストアを作れず、状態の置き場所が二重になる。
   */
  readonly network: NetworkIndex | null;
  /** 編集対象。開いていなければ `null`。 */
  readonly project: Project | null;
  readonly ui: UiState;
}

/** 状態が持つ項目。派生値を足していないことをテストで固定するために使う。 */
export const APP_STATE_KEYS = ['network', 'project', 'ui'] as const;
