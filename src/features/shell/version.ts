/**
 * このソフトの版数。
 *
 * **`package.json` から読む。** 書き写すと、上げ忘れた版数がそのまま配布物の
 * 中で「版数 0.1.0」と名乗る。版数を決める場所は `package.json` 1 つとし、
 * Tauri の設定（`tauri.conf.json`）と Rust 側（`Cargo.toml`）も同じ値を持つ。
 *
 * 束ねるときに残るのは文字列 1 つだけである（名前付きで取り出しているため、
 * `package.json` の他の項目は入らない）。
 */

import { version } from '../../../package.json';

export const APP_VERSION: string = version;

/**
 * 著作権表示（T-56、仕様書 v1.1 §3.1）。
 *
 * **画面に出す。** インストーラと実行ファイルのプロパティ（`tauri.conf.json` の
 * `bundle.copyright`）にしか無い状態では、**誰が作ったのかを画面から確かめられない。**
 * デスクトップ版はまだしも、Web 版には bundle 設定そのものが無い。
 *
 * **年は増やさない。** 毎年書き換える運用を前提にした表示は必ず古くなる。
 *
 * 版数と同じくここに置くのは、`tauri.conf.json` と TypeScript の両方に手で書くと、
 * **来年になって片方だけ直す**ためである。値そのものを共有できない（`tauri.conf.json`
 * は Rust 側がビルド時に読む）以上、せめて TypeScript 側の出どころは 1 つにする。
 */
export const COPYRIGHT = '© 2026 再履バス同好会';
