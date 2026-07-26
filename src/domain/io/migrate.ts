/**
 * ファイル形式のマイグレーション（仕様書 §7.3）。
 *
 * **v1 では変換関数が 1 つも無い。** それでも枠組みを先に作るのは、実際に形式を
 * 変える段になってから仕組みを用意すると、その最初の 1 回を「読込処理に条件分岐を
 * 足す」で済ませてしまい、2 回目以降に分岐が積み上がるためである。
 *
 * マイグレーションは**スキーマ検証の前**に走る。古いファイルは現在のスキーマに
 * 適合しないのだから、検証を通してから変換することはできない。したがって変換関数が
 * 受け取るのは `unknown` であり、自分が扱う版の形を自分で確かめる責任を持つ。
 */

import { CURRENT_FORMAT_VERSION } from '@/domain/model';

/** 1 つ前の版から次の版への変換。 */
export interface Migration {
  /** この変換が受け取る版。 */
  readonly from: number;
  /** この変換が出力する版。 */
  readonly to: number;
  readonly migrate: (data: unknown) => unknown;
}

/**
 * 版数の昇順に並んだ変換の一覧。
 *
 * 形式を変えるときは、ここに `{ from: 1, to: 2, migrate }` を追加する。
 */
export const MIGRATIONS: readonly Migration[] = [];

export type MigrateResult =
  | { readonly ok: true; readonly data: unknown; readonly applied: readonly number[] }
  | { readonly ok: false; readonly reason: 'tooNew'; readonly formatVersion: number }
  | { readonly ok: false; readonly reason: 'noPath'; readonly formatVersion: number };

/**
 * ファイルの内容を現在の形式まで引き上げる。
 *
 * `migrations` を差し替えられるようにしてあるのは、変換が 1 つも無い今の段階でも
 * **枠組みそのものを動かして確かめられる**ようにするためである。動かしたことの
 * ない仕組みは、最初に使う日に必ず壊れている。
 *
 * @param data JSON として解釈しただけの値
 * @param formatVersion ファイルが名乗っている版数
 * @param target 引き上げ先の版数
 */
export function migrateProjectData(
  data: unknown,
  formatVersion: number,
  migrations: readonly Migration[] = MIGRATIONS,
  target: number = CURRENT_FORMAT_VERSION,
): MigrateResult {
  if (formatVersion > target) {
    return { ok: false, reason: 'tooNew', formatVersion };
  }

  let current = data;
  let version = formatVersion;
  const applied: number[] = [];

  while (version < target) {
    const migration = migrations.find((m) => m.from === version);
    if (migration === undefined) {
      // 版数の連なりに穴がある。変換を書き忘れたということであり、
      // 推測で読み進めるより開かない方が安全である。
      return { ok: false, reason: 'noPath', formatVersion: version };
    }
    current = migration.migrate(current);
    version = migration.to;
    applied.push(migration.to);
  }

  return { ok: true, data: current, applied };
}
