/**
 * 書き出す zip の名前（仕様書 v2 §5.3、T-74）。**純関数のみ。**
 *
 * 形は `文書名_日付.zip` とする。**日付を入れるのは、配った先で新旧が並ぶ**
 * ためである。中身を開かずに、どちらが新しいかが分かる。
 */

/** 文書名もファイル名も無いときに使う名前。 */
export const UNTITLED_EXPORT = '無題';

/**
 * ファイル名に使えない文字。
 *
 * Windows が禁じるものを並べてある。**最も狭いところに合わせる**——同じ操作が
 * 環境によって成功したり失敗したりするのが、いちばん分かりにくい。
 */
const FORBIDDEN = new Set(Array.from('\\/:*?"<>|'));

/** これより小さい符号位置は落とす（制御文字）。 */
const FIRST_PRINTABLE = 0x20;

/**
 * 書き出す zip の名前を組み立てる。
 *
 * @param documentName 文書情報の名前（仕様書 §6.4）
 * @param fileName 開いているファイルの名前。保存していなければ `null`
 * @param at 日付
 */
export function exportFileName(documentName: string, fileName: string | null, at: Date): string {
  return `${baseNameOf(documentName, fileName)}_${stamp(at)}.zip`;
}

/**
 * 名前の本体を決める。
 *
 * **文書名を先に見る**（仕様書 v2 §5.3）。文書名は「このダイヤは何か」を書く
 * ところであり、ファイル名は置き場所の都合で付くこともある。どちらも無ければ
 * {@link UNTITLED_EXPORT}。
 */
function baseNameOf(documentName: string, fileName: string | null): string {
  const document = sanitize(documentName);
  if (document !== '') return document;

  const file = sanitize(stripExtension(fileName ?? ''));
  return file === '' ? UNTITLED_EXPORT : file;
}

/** `.uodia` を落とす。書き出すのは zip であり、拡張子を 2 つ並べない。 */
function stripExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot <= 0 ? name : name.slice(0, dot);
}

/** ファイル名に使えない文字を落とす。**途中の空白はそのまま残す。** */
function sanitize(name: string): string {
  return Array.from(name)
    .filter((character) => {
      if (FORBIDDEN.has(character)) return false;
      return (character.codePointAt(0) ?? 0) >= FIRST_PRINTABLE;
    })
    .join('')
    .trim();
}

/** `20260809`。**区切りを入れない**——名前の中で日付だと分かれば足りる。 */
function stamp(at: Date): string {
  const year = at.getFullYear();
  const month = at.getMonth() + 1;
  const day = at.getDate();
  return `${String(year)}${String(month).padStart(2, '0')}${String(day).padStart(2, '0')}`;
}
