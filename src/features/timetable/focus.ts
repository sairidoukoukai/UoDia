/**
 * 時刻表の列へ焦点を移す（仕様書 §6.3.4 のジャンプ、T-31）。
 *
 * **表の作りを知っているのは時刻表だけにする。** ダイヤグラム側から
 * `.timetable__column` のような綴りを書くと、表の組み方を変えた日に、
 * 関わりの無いはずの機能が黙って壊れる。
 *
 * 列を画面へ入れるのは選択への追随が済ませている（T-38）。ここでするのは
 * 焦点を移すことだけである——**押した人の手をそこへ連れて行く**。
 */

/**
 * その便の列見出しへ焦点を移す。
 *
 * @returns 見つかって焦点を移せたか。**別の方向の便や、消えた便では `false`**
 */
export function focusTripColumn(tripId: string, root: ParentNode = document): boolean {
  // **綴りを組み立てて引かない。** 便 ID は利用者のファイルから来る文字列で
  // あり、選択子に埋め込むと引用符 1 つで壊れる。並べてから見比べる。
  for (const cell of root.querySelectorAll<HTMLElement>('[data-trip-id]')) {
    if (cell.dataset.tripId !== tripId) continue;

    const column = cell.querySelector<HTMLElement>('.timetable__column');
    if (column === null) return false;

    column.focus();
    return true;
  }

  return false;
}
