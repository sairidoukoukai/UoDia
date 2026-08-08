/**
 * 一斉出力（仕様書 v2 §5、T-74）。
 *
 * ## 順番が決まっている
 *
 * **全部を作り終えてから書く**（§5.3）。作りながら書くと、途中で失敗したときに
 * 半分だけ入った zip が残る。これはプロジェクトの保存がアトミックであること
 * （仕様書 §10.3）と同じ考え方であり、**「失敗したら何も起きていない」を保つ。**
 *
 * ```
 * 便があるか → 全部作る → 1 つの zip に包む → 保存先を尋ねる → 書く
 *      ↓            ↓
 *   何もしない   何も書かない
 * ```
 *
 * ## 取り消しと失敗を区別する
 *
 * `fileService` と同じ約束にする——行えたら `true`、取り消しは `false`、本当の
 * 失敗は `dialogs.showError` で伝えたうえで `false`。**保存先を選ばずに閉じたら
 * 何も起きない**（受入条件）。
 */

import { buildZip, type ZipEntry } from '@/domain/io';
import type { PlatformAdapter } from '@/platform';
import { selectActiveService, selectNetwork, type AppStoreHook } from '@/store';
import { EXPORT_PRODUCERS, type ExportProducer, type ExportSource } from './artifacts';
import { exportFileName } from './exportName';

/** 進み具合（§5.9）。**何を作っているかを出す。** */
export interface ExportProgress {
  /** いま作っているもの（「箱ダイヤ」）。 */
  readonly label: string;
  /** 何番目か（1 から数える）。 */
  readonly index: number;
  readonly total: number;
}

/** 失敗を伝える口。`FileDialogs` をそのまま渡せる形にしてある。 */
export interface ExportDialogs {
  showError(message: string): Promise<void>;
}

export interface ExportServiceOptions {
  readonly platform: PlatformAdapter;
  readonly store: AppStoreHook;
  readonly dialogs: ExportDialogs;
  /** 書き出すもの。既定は {@link EXPORT_PRODUCERS}。 */
  readonly producers?: readonly ExportProducer[];
  /** 現在時刻。テストを決定的にするために差し替えられる。 */
  readonly now?: () => Date;
  /**
   * 画面に描き直す機会を渡す（§5.9）。
   *
   * **1 つ作るたびに呼ぶ。** これが無いと、300dpi の画像を 4 枚作るあいだ窓が
   * 固まり、進み具合を出しても誰も見られない。
   */
  readonly yieldToUi?: () => Promise<void>;
}

export interface ExportService {
  /**
   * すべてを書き出す。
   *
   * @param onProgress 作っているものを伝える。終わったら `null` で呼ぶ
   * @returns 書けたら `true`。取り消し・失敗は `false`
   */
  run(onProgress?: (progress: ExportProgress | null) => void): Promise<boolean>;
}

/** 進み具合を利用者に見せる一文にする（§5.9）。 */
export function formatProgress(progress: ExportProgress): string {
  return `${progress.label}を作っています（${String(progress.index)}/${String(progress.total)}）`;
}

/** 既定の描き直しの機会。**次の描画まで待つ。** */
function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

export function createExportService(options: ExportServiceOptions): ExportService {
  const { platform, store, dialogs } = options;
  const producers = options.producers ?? EXPORT_PRODUCERS;
  const now = options.now ?? ((): Date => new Date());
  const yieldToUi = options.yieldToUi ?? nextFrame;

  return {
    async run(onProgress): Promise<boolean> {
      const report = (progress: ExportProgress | null): void => {
        onProgress?.(progress);
      };

      const state = store.getState();
      const { project } = state;
      const network = selectNetwork(state);
      const service = selectActiveService(state);

      if (project === null || network === null || service === null) {
        await dialogs.showError('書き出せるダイヤがありません');
        return false;
      }

      // **便が 1 つも無ければファイルを作らない**（§5.8）。空の絵と空の表を
      // 包んだ zip を配っても、受け取った側は何も分からない。
      if (service.trips.length === 0) {
        await dialogs.showError('便がありません。書き出すものがありません');
        return false;
      }

      const source: ExportSource = { project, network, service, settings: state.settings };

      let entries: ZipEntry[];
      try {
        entries = await buildAll(producers, source, report, yieldToUi);
      } catch (error) {
        report(null);
        await dialogs.showError(reasonOf(error));
        return false;
      }

      const suggestedName = exportFileName(
        project.document.name,
        state.file.handle?.name ?? null,
        now(),
      );

      try {
        const zip = buildZip(entries, { modifiedAt: now() });
        return await platform.saveExport(zip, suggestedName);
      } catch (error) {
        await dialogs.showError(`書き出せませんでした: ${reasonOf(error)}`);
        return false;
      } finally {
        report(null);
      }
    },
  };
}

/**
 * すべての中身を作る。**1 つでも失敗したら投げる。**
 *
 * どれを作っていて失敗したかを添える（§5.8）。「書き出せません」だけでは、
 * 直す先が絵なのか表なのか分からない。
 */
async function buildAll(
  producers: readonly ExportProducer[],
  source: ExportSource,
  report: (progress: ExportProgress | null) => void,
  yieldToUi: () => Promise<void>,
): Promise<ZipEntry[]> {
  const entries: ZipEntry[] = [];

  for (const [index, producer] of producers.entries()) {
    report({ label: producer.label, index: index + 1, total: producers.length });
    // 描き直す機会を先に渡す。作り始めてからでは、いま出した進み具合が
    // 画面に出ないまま次へ進む。
    await yieldToUi();

    try {
      entries.push({ name: producer.fileName, bytes: await producer.build(source) });
    } catch (error) {
      throw new Error(`${producer.label}を作れませんでした: ${reasonOf(error)}`, { cause: error });
    }
  }

  return entries;
}

/**
 * 失敗の理由を一文にする。
 *
 * **`Error` の中身だけを取る。** `String(error)` は `Error: ` を頭に付けるため、
 * 包み直すたびに「Error: 箱ダイヤを作れませんでした: Error: 描けません」と
 * 積み重なる。利用者が読むのは理由であって、例外の型名ではない。
 */
function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
