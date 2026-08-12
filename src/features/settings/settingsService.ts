/**
 * 設定の適用（仕様書 §6.5.1、§6.5.5、T-35）。
 *
 * 画面（`SettingsDialog`）とストア・プラットフォームのあいだに立つ。**判断は
 * すべてここに集める**——書き戻せる環境かどうか、検証を通ったかどうか、何便に
 * 効いたか。画面はその結果を出すだけにする。
 *
 * ## 順序が意味を持つ
 *
 * 1. 定義を書き換える（`editNetwork`）。**ここで検証が走る**（`execute`）。
 *    通らなければ状態は 1 ビットも変わらない
 * 2. 通ったときだけ `route.json` へ書き戻す
 *
 * 逆にすると、検証を通らない内容をファイルへ書いてしまう。仕様書 §6.5.1 の
 * 「書き戻し前に検証を行い、違反があれば保存を拒否する」はこの順序である。
 */

import { segmentKey } from '@/domain/network';
import type { StopPattern } from '@/domain/model';
import type { AppStore } from '@/store';
import { changedPatternIds } from './patterns';
import type { DistanceEdits, SegmentEdits } from './segments';

/** 距離を 1 つも打ち直していない状態。 */
const NO_DISTANCES: DistanceEdits = new Map<string, number>();

/** 読み書きに要るだけの入れ口。 */
export interface SettingsStore {
  getState(): AppStore;
}

export interface ApplyResult {
  readonly ok: boolean;
  /** 画面に出す言葉。 */
  readonly message: string;
}

/**
 * 区間所要時間の変更を当てる（履歴に載る）。
 *
 * **書き戻しはしない。** ファイルへ書くかどうかは環境で変わり（§6.5.5）、
 * 待ち時間もある。状態を変えることと、それを保存することは別の操作である。
 */
export function applySegmentEdits(
  store: SettingsStore,
  edits: SegmentEdits,
  distances: DistanceEdits = NO_DISTANCES,
): ApplyResult {
  const state = store.getState();
  if (state.project === null) return { ok: false, message: '路線図を読み込んでいません' };

  /*
   * **所要時間と距離を 1 回の編集で当てる。**
   *
   * 2 回に分けると、片方だけが検証を通ったときに中途半端な状態が残る。履歴も
   * 2 段になり、**打った 1 回の「適用」を戻すのに 2 回の取り消しが要る。**
   */
  const result = state.editNetwork('区間の変更', (def) => {
    for (const segment of def.segments) {
      const key = segmentKey(segment.fromStopId, segment.toStopId);
      const minutes = edits.get(key);
      if (minutes !== undefined) segment.runMinutes = minutes;
      // **距離を変えても便の時刻は動かない**（仕様書 v1.1 §6.1.3）。
      const distance = distances.get(key);
      if (distance !== undefined) segment.distanceMeters = distance;
    }
  });

  if (!result.ok) {
    // 検証（R-01〜R-13）を通らなかった。**状態は変わっていない。**
    const first = result.issues[0];
    return {
      ok: false,
      message:
        first === undefined ? '変更を適用できません' : `変更を適用できません: ${first.message}`,
    };
  }
  if (!result.changed) return { ok: true, message: '変わった区間はありません' };

  return { ok: true, message: '区間を変えました' };
}

/**
 * 停車パターンの変更を当てる（履歴に載る。§6.5.4、T-36）。
 *
 * 区間所要時間と同じで、**検証は `execute` が行う**。R-03（隣接停留所対が区間表に
 * あるか）に引っかかれば、その場で止まり、状態は変わらない。
 */
export function applyPatterns(store: SettingsStore, patterns: readonly StopPattern[]): ApplyResult {
  const state = store.getState();
  if (state.project === null) return { ok: false, message: '路線図を読み込んでいません' };

  // **変わっていなければ触らない。** 配列を入れ替えると、中身が同じでも Immer は
  // 変更として記録し、履歴に空の 1 段が積まれる（区間表と違い、ここは配列ごと
  // 差し替えるため値ごとの比較が効かない）。
  if (changedPatternIds(state.project.network.patterns, patterns).length === 0) {
    return { ok: true, message: '変わったパターンはありません' };
  }

  const result = state.editNetwork('停車パターンの変更', (def) => {
    def.patterns = [...patterns];
  });

  if (!result.ok) {
    const first = result.issues[0];
    return {
      ok: false,
      message:
        first === undefined
          ? '変更を適用できません'
          : `変更を適用できません: [${first.rule}] ${first.message}`,
    };
  }

  return { ok: true, message: '停車パターンを変えました' };
}
