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

import { serializeNetworkDef } from '@/domain/io';
import { segmentKey } from '@/domain/network';
import type { PlatformAdapter } from '@/platform';
import type { StopPattern } from '@/domain/model';
import type { AppStore } from '@/store';
import { changedPatternIds } from './patterns';
import type { SegmentEdits } from './segments';

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
export function applySegmentEdits(store: SettingsStore, edits: SegmentEdits): ApplyResult {
  const state = store.getState();
  if (state.networkDef === null) return { ok: false, message: '路線図を読み込んでいません' };

  const result = state.editNetwork('区間所要時間の変更', (def) => {
    for (const segment of def.segments) {
      const next = edits.get(segmentKey(segment.fromStopId, segment.toStopId));
      if (next !== undefined) segment.runMinutes = next;
    }
  });

  if (!result.ok) {
    // 検証（R-01〜R-12）を通らなかった。**状態は変わっていない。**
    const first = result.issues[0];
    return {
      ok: false,
      message:
        first === undefined ? '変更を適用できません' : `変更を適用できません: ${first.message}`,
    };
  }
  if (!result.changed) return { ok: true, message: '変わった区間はありません' };

  return { ok: true, message: '区間所要時間を変えました' };
}

/**
 * 停車パターンの変更を当てる（履歴に載る。§6.5.4、T-36）。
 *
 * 区間所要時間と同じで、**検証は `execute` が行う**。R-03（隣接停留所対が区間表に
 * あるか）に引っかかれば、その場で止まり、状態は変わらない。
 */
export function applyPatterns(store: SettingsStore, patterns: readonly StopPattern[]): ApplyResult {
  const state = store.getState();
  if (state.networkDef === null) return { ok: false, message: '路線図を読み込んでいません' };

  // **変わっていなければ触らない。** 配列を入れ替えると、中身が同じでも Immer は
  // 変更として記録し、履歴に空の 1 段が積まれる（区間表と違い、ここは配列ごと
  // 差し替えるため値ごとの比較が効かない）。
  if (changedPatternIds(state.networkDef.patterns, patterns).length === 0) {
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

/**
 * `route.json` へ書き戻す（§6.5.1）。書き戻せない環境では書き出す（§6.5.5）。
 *
 * @returns 画面に出す言葉。取り消されたときは `null`
 */
export async function saveNetworkDef(
  store: SettingsStore,
  platform: PlatformAdapter,
): Promise<string | null> {
  const def = store.getState().networkDef;
  if (def === null) return '路線図を読み込んでいません';

  const content = serializeNetworkDef(def);

  if (platform.capabilities.networkDefWritable) {
    await platform.saveNetworkDef(content);
    return 'route.json に書き戻しました';
  }

  // 書き戻せない環境では、内容と名前を渡してファイルに出す（§6.5.5）。同じ
  // 出口を使うのは、**保存の仕方を環境ごとに書き分けない**ためである。
  const handle = await platform.saveProjectAs(content, 'route.json');
  return handle === null ? null : 'route.json を書き出しました。差し替えてください';
}
