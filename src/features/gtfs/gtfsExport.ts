/**
 * GTFS を書き出す（仕様書 v2 §6、#163、T-82）。
 *
 * ## 一斉出力とは別の道を通る
 *
 * **GTFS は一斉出力に含めない**（§5.7）。揃っているもの（絵・表）と、揃うのに
 * 条件が要るもの（緯度経度・運行日）を、**同じ包みに入れない。**
 *
 * ただし**包み方は同じ**である——`buildZip`（`domain/io/zip.ts`）で 1 つの zip に
 * まとめ、`platform.saveExport` で保存する。**書庫を 2 通り作らない。**
 *
 * ## `shapes.txt` はここで読む
 *
 * 素通しするファイルであり（§6.5.7）、**何にも依存しない。** 組み立てる側
 * （`domain/export/gtfs`）に持たせず、**書き出すときに読んで渡す。**
 */

import { buildGtfs } from '@/domain/export';
import { buildZip } from '@/domain/io';
import type { PlatformAdapter } from '@/platform';
import { selectActiveService, selectNetwork, type AppStoreHook } from '@/store';

/** 書き出す zip の名前。**文書名や日付を入れない**——中身が GTFS だと分かればよい。 */
export const GTFS_ZIP_NAME = 'GTFS.zip';

/** 失敗を伝える口。 */
export interface GtfsExportDialogs {
  showError(message: string): Promise<void>;
}

export interface GtfsExportOptions {
  readonly platform: Pick<PlatformAdapter, 'saveExport'>;
  readonly store: AppStoreHook;
  readonly dialogs: GtfsExportDialogs;
  /** 現在時刻。zip の日時に入る。 */
  readonly now?: () => Date;
  /** `shapes.txt` の中身を読む。既定は同梱のものを読む。 */
  readonly loadShapes?: () => Promise<string>;
}

/**
 * 同梱の `shapes.txt` を読む。**書き出しが押されるまで読まない。**
 *
 * 70KB あり、起動のたびに落とす理由が無い。
 */
async function loadBundledShapes(): Promise<string> {
  return (await import('../../../assets/gtfs/shapes.txt?raw')).default;
}

/**
 * GTFS を書き出す。
 *
 * @returns 書けたら `true`。取り消し・失敗は `false`
 */
export async function exportGtfs(options: GtfsExportOptions): Promise<boolean> {
  const { platform, store, dialogs } = options;
  const now = options.now ?? ((): Date => new Date());

  const state = store.getState();
  const network = selectNetwork(state);
  const service = selectActiveService(state);
  if (network === null || service === null) {
    await dialogs.showError('書き出せるダイヤがありません');
    return false;
  }

  try {
    const shapes = await (options.loadShapes ?? loadBundledShapes)();
    const files = buildGtfs({ network, service, shapes });
    // **12 ファイルを 1 つの zip に。** 中身は既に UTF-8 のバイト列である。
    const zip = buildZip(
      files.map((file) => ({ name: file.name, bytes: file.bytes })),
      { modifiedAt: now() },
    );

    return await platform.saveExport(zip, GTFS_ZIP_NAME);
  } catch (error) {
    await dialogs.showError(
      `GTFS を書き出せませんでした: ${error instanceof Error ? error.message : String(error)}`,
    );
    return false;
  }
}
