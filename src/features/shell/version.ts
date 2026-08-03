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
