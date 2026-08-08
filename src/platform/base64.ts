/**
 * バイト列を base64 にする（T-74）。
 *
 * ## なぜ要るか
 *
 * Tauri のコマンド引数は JSON で渡る。**JSON にバイト列は無い。** 数値の配列に
 * すると 1 バイトあたり 3〜4 文字になり、300dpi の画像を包んだ zip では受け渡し
 * だけで数十 MB になる。base64 は 4/3 倍で済む。
 *
 * ## なぜ `btoa` をそのまま呼ばないか
 *
 * `btoa` は文字列を取る。`String.fromCharCode(...bytes)` で渡すと、**引数の数が
 * 上限を超えて落ちる**——数 MB の書庫では確実に起きる。区切って渡す。
 */

/**
 * 一度に `fromCharCode` へ渡すバイト数。
 *
 * 引数の個数には処理系ごとの上限がある（数万〜十数万）。**下回っていれば速さは
 * ほとんど変わらない**ため、余裕をもって小さく取る。
 */
const CHUNK = 0x8000;

/** バイト列を base64 文字列にする。 */
export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let at = 0; at < bytes.length; at += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(at, at + CHUNK));
  }
  return btoa(binary);
}
