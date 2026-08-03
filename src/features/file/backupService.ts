/**
 * 自動バックアップと復元（仕様書 §6.8、§9.2、T-18）。
 *
 * ## 何をもって「異常終了」とみなすか
 *
 * 異常終了そのものは検出しない。**バックアップが残っていること**をもって、
 * 前回が正常に終わらなかったと判断する。そのために、正常な経路では必ず消す。
 *
 * - 保存・新規作成・ファイルを開く → 未保存でなくなった時点で消す（`start`）
 * - 閉じる → `discard()` を呼ぶ（`App`）
 *
 * 「終了時に印を書く」方式にしないのは、**強制終了では終了時の処理が走らない**
 * ためである。走らないことを前提にできる仕掛けでなければ、異常終了を捉えられない。
 *
 * ## 書くのは未保存のときだけ
 *
 * 保存済みの内容を書き写しても、復元できるものは増えない。逆に、保存済みの
 * バックアップが残っていると、起動のたびに要らない復元を勧めることになる。
 */

import { parseBackup, loadProjectData, serializeBackup } from '@/domain/io';
import type { Project } from '@/domain/model';
import type { PlatformAdapter } from '@/platform';
import {
  DEFAULT_BACKUP_INTERVAL_MS,
  selectIsDirty,
  selectNetwork,
  type AppState,
  type AppStoreHook,
} from '@/store';
import type { BackupDialogs } from './prompts';

/** 復元できる編集内容。 */
export interface RecoverableBackup {
  readonly project: Project;
  /** 元のファイル名。保存していなかったなら空文字。 */
  readonly fileName: string;
  readonly savedAt: string;
}

export interface BackupServiceOptions {
  readonly platform: PlatformAdapter;
  readonly store: AppStoreHook;
  /**
   * 書き出す間隔（ミリ秒）。既定 5 分。
   *
   * 設定欄は T-35 で作る。ここで受け取れるようにしてあるのは、そのときに
   * 渡す先を用意しておくためと、試験で待たずに済ませるためである。
   */
  readonly intervalMs?: number;
  readonly now?: () => Date;
}

export interface BackupService {
  /**
   * 必要なら今すぐ書き出す。書いたら `true`。
   *
   * 未保存の変更が無ければ何もしない。
   */
  backupNow(): Promise<boolean>;
  /**
   * 定期的な書き出しを始める。戻り値を呼ぶと止まる。
   *
   * 併せて、未保存でなくなったバックアップを消す。
   */
  start(): () => void;
  /**
   * 前回の編集内容が残っていれば返す。無ければ `null`。
   *
   * 読めない・古い形式・ネットワーク定義と噛み合わない、のいずれでも `null` を
   * 返す。バックアップが読めないことは起動を止める理由にならない。
   */
  findRecoverable(): Promise<RecoverableBackup | null>;
  /**
   * 残っていれば尋ね、答えに従う。復元したら `true`。
   *
   * **復元しないと答えられたらバックアップを捨てる。** 残しておくと起動の
   * たびに同じことを尋ねることになる。
   */
  offerRecovery(dialogs: BackupDialogs): Promise<boolean>;
  /** バックアップを捨てる。 */
  discard(): Promise<void>;
}

export function createBackupService(options: BackupServiceOptions): BackupService {
  const { platform, store } = options;
  const intervalMs = options.intervalMs ?? DEFAULT_BACKUP_INTERVAL_MS;
  const now = options.now ?? ((): Date => new Date());

  async function discard(): Promise<void> {
    try {
      await platform.clearBackup();
    } catch {
      // 消せなくても編集は続けられる。次の書き出しで上書きされる。
    }
  }

  const service: BackupService = {
    async backupNow(): Promise<boolean> {
      const state = store.getState();
      if (!selectIsDirty(state) || state.project === null) return false;

      try {
        await platform.writeBackup(
          serializeBackup(state.project, state.file.handle?.name ?? null, now()),
        );
        return true;
      } catch {
        // 書けなくても編集は続けられる。ここで手を止めるほうが害が大きい。
        return false;
      }
    },

    start(): () => void {
      const timer = setInterval(() => {
        void service.backupNow();
      }, intervalMs);

      // 未保存でなくなった瞬間に消す。保存・新規作成・ファイルを開く、の
      // いずれもここを通る。個々の操作に消す処理を足して回るより漏れにくい。
      let wasDirty = selectIsDirty(store.getState());
      const unsubscribe = store.subscribe((state: AppState) => {
        const dirty = selectIsDirty(state);
        if (wasDirty && !dirty) void discard();
        wasDirty = dirty;
      });

      return () => {
        clearInterval(timer);
        unsubscribe();
      };
    },

    async findRecoverable(): Promise<RecoverableBackup | null> {
      let raw: string | null;
      try {
        raw = await platform.readBackup();
      } catch {
        return null;
      }
      if (raw === null) return null;

      const parsed = parseBackup(raw);
      if (!parsed.ok) return null;

      const network = selectNetwork(store.getState());
      if (network === null) return null;

      const loaded = loadProjectData(parsed.envelope.project, network);
      if (!loaded.ok) return null;

      return {
        project: loaded.project,
        fileName: parsed.envelope.fileName ?? '',
        savedAt: parsed.envelope.savedAt,
      };
    },

    async offerRecovery(dialogs: BackupDialogs): Promise<boolean> {
      const found = await service.findRecoverable();
      if (found === null) {
        // 読めないものが残っている場合もあるため、念のため消しておく。
        await discard();
        return false;
      }

      if (!(await dialogs.confirmRecover(found.fileName, found.savedAt))) {
        await discard();
        return false;
      }

      // 復元した内容はどこにも保存されていない。**最初から未保存として扱う。**
      // 保存済みに見せると、そのまま閉じて同じ内容をもう一度失うことになる。
      store.getState().restoreProject(found.project);
      return true;
    },

    discard,
  };

  return service;
}
