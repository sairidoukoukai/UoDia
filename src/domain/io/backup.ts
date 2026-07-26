/**
 * 自動バックアップの入れ物（仕様書 §6.8、§9.2）。
 *
 * 中身のプロジェクトだけを書くのでは足りない。復元するときに**いつの・どの
 * ファイルの編集内容なのか**を利用者に示せなければ、復元してよいかを判断
 * できないためである。
 *
 * `.uodia` 本体と違い、整形も鍵の整列もしない。バックアップは 5 分ごとに
 * 丸ごと書き換わるものであり、差分を読む相手が居ない。
 *
 * ## ファイルへの参照は持たない
 *
 * 保存先の名前だけを記録し、ハンドルは記録しない。ハンドルの実体は環境ごとに
 * 違い（Tauri はパス文字列、Web は `FileSystemFileHandle`）、JSON にできると
 * 限らないためである。片方の環境でだけ復元先が復活する、という振る舞いは
 * 「復元したのに保存先が違う」形の事故を招く。**復元した内容は保存先が
 * 未定の状態から始める。**
 */

import { z } from 'zod';
import { isoDateTimeSchema, type Project } from '@/domain/model';

/** バックアップであることの目印。他の JSON を読み違えないために置く。 */
export const BACKUP_FORMAT = 'uodia-backup';

export const backupEnvelopeSchema = z.object({
  format: z.literal(BACKUP_FORMAT),
  /** 書き出した時刻。復元するかの判断材料として利用者に見せる。 */
  savedAt: isoDateTimeSchema,
  /** 元のファイル名。保存していないプロジェクトなら `null`。 */
  fileName: z.string().nullable(),
  /**
   * プロジェクトの中身。ここでは形を検査しない。
   *
   * 検査は `loadProjectData` に任せる。参照の修復も版数の変換も、通常の
   * 読込とまったく同じ手順を通す必要がある。ここで別に検査すると、
   * 規則が 2 か所に分かれて食い違う。
   */
  project: z.unknown(),
});

export type BackupEnvelope = z.infer<typeof backupEnvelopeSchema>;

export function serializeBackup(
  project: Project,
  fileName: string | null,
  now: Date = new Date(),
): string {
  const envelope: BackupEnvelope = {
    format: BACKUP_FORMAT,
    savedAt: now.toISOString(),
    fileName,
    project,
  };
  return JSON.stringify(envelope);
}

export type ParseBackupResult =
  | { readonly ok: true; readonly envelope: BackupEnvelope }
  | { readonly ok: false; readonly message: string };

/**
 * バックアップを読む。
 *
 * 壊れていても例外は投げない。バックアップが読めないことは起動を止める理由に
 * ならず、「復元できるものは無かった」として先へ進めばよい。
 */
export function parseBackup(json: string): ParseBackupResult {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (error) {
    return { ok: false, message: `バックアップを読めません: ${String(error)}` };
  }

  const parsed = backupEnvelopeSchema.safeParse(raw);
  return parsed.success
    ? { ok: true, envelope: parsed.data }
    : { ok: false, message: 'バックアップの形式が違います' };
}
