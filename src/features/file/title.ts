/**
 * ウィンドウ題名の組み立て（仕様書 §6.8）。
 *
 * 形式は `ファイル名 [*] — UoDia`。未保存であることを題名に出すのは、閉じる
 * 直前まで気づかせないためである。確認ダイアログは最後の砦であって、
 * それだけに頼ると「保存したつもり」で作業を続けることになる。
 */

export const APP_NAME = 'UoDia';

/** まだ保存していないプロジェクトの表示名。 */
export const UNTITLED = '無題';

/** 未保存を示す印。 */
export const DIRTY_MARK = '[*]';

/**
 * 題名を組み立てる。
 *
 * @param fileName 保存先の名前。まだ保存していなければ `null`
 * @param dirty 保存していない変更があるか
 */
export function formatWindowTitle(fileName: string | null, dirty: boolean): string {
  const name = fileName ?? UNTITLED;
  return dirty ? `${name} ${DIRTY_MARK} — ${APP_NAME}` : `${name} — ${APP_NAME}`;
}

/** 「名前を付けて保存」で最初に出す名前。 */
export function suggestFileName(fileName: string | null, documentName: string): string {
  if (fileName !== null) return fileName;
  const base = documentName.trim();
  return `${base === '' ? UNTITLED : base}.uodia`;
}
