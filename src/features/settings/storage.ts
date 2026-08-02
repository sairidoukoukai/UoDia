/**
 * 設定の保存と読み出し（仕様書 §6.5、T-39）。
 *
 * **プロジェクトとは別に置く。** 履歴段数もバックアップ間隔もテーマも「この道具を
 * どう使うか」であり、開いたファイルによって変わるものではない。
 *
 * ## 読めなければ既定に倒す
 *
 * 壊れた設定ファイルで起動できなくなるのは、失うものに対して代償が大きい。設定は
 * 作り直せる。読めなかったことを利用者に知らせもしない——**次に何かを変えた時点で
 * 上書きされる**ため、放っておけば直る。
 */

import type { PlatformAdapter } from '@/platform';
import { parseSettings, serializeSettings, type AppStore, type PersistedSettings } from '@/store';

export interface SettingsStorageOptions {
  readonly platform: Pick<PlatformAdapter, 'readSettings' | 'writeSettings'>;
  readonly store: {
    getState(): AppStore;
    subscribe(listener: (state: AppStore) => void): () => void;
  };
}

/** 保存する分だけを取り出す。**隠し設定の有効・無効は含めない**（§6.5.4）。 */
export function persistedOf(store: SettingsStorageOptions['store']): PersistedSettings {
  const { theme, backupIntervalMs, defaultDiagramView } = store.getState().settings;
  return { theme, backupIntervalMs, defaultDiagramView };
}

/** 保存されている設定を読んで当てる。 */
export async function loadSettings(options: SettingsStorageOptions): Promise<void> {
  const json = await options.platform.readSettings().catch(() => null);
  options.store.getState().setSettings(parseSettings(json));
}

/**
 * 設定が変わったら書く。返った関数を呼ぶと止まる。
 *
 * **中身が変わったときだけ書く。** ストアの購読はどの変更でも走る（便を 1 つ
 * 動かしても呼ばれる）ため、比べずに書くと打鍵のたびにファイルへ触れる。
 */
export function watchSettings(options: SettingsStorageOptions): () => void {
  let written = serializeSettings(persistedOf(options.store));

  return options.store.subscribe(() => {
    const next = serializeSettings(persistedOf(options.store));
    if (next === written) return;

    written = next;
    void options.platform.writeSettings(next).catch(() => {
      // 書けなくても編集は続けられる。次に変えたときにまた試す。
    });
  });
}
