/**
 * プロジェクトのシリアライズ（仕様書 §7.1）。
 *
 * `.uodia` は JSON・UTF-8・LF・インデント 2 スペース。圧縮しないのは、git で
 * 差分を取れるようにするためである。1 便あたりの永続化データは 5 フィールドしか
 * なく、100 便でも数十 KB に収まるため、サイズを削る意味がない。
 *
 * **同じ内容からは常に同じバイト列が出る**ことを保証する。保存のたびに差分が
 * 出ると、実際に何を変えたのかが git のログから読み取れなくなるためである。
 * これを構造体ごとに順序を書き下して実現すると、スキーマに項目を足したときに
 * 書き漏らして**データが静かに消える**。そこでキーを再帰的に辞書順へ整列させる
 * 汎用処理とし、スキーマの変更が自動的に反映されるようにしている。
 */

import type { Project } from '@/domain/model';

/**
 * プロジェクトを `.uodia` の中身にする。
 *
 * 末尾に改行を 1 つ置く。POSIX のテキストファイルの慣習であり、git が
 * 「\ No newline at end of file」を出さなくなる。
 */
export function serializeProject(project: Project): string {
  return `${JSON.stringify(sortKeys(project), null, 2)}\n`;
}

/**
 * オブジェクトのキーを再帰的に辞書順へ整列させる。
 *
 * 配列の順序は保つ。便の並びは利用者が並べ替えた結果であり、意味がある。
 */
function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
  if (typeof value !== 'object' || value === null) {
    return value;
  }
  const entries = Object.entries(value).sort(([a], [b]) => (a < b ? -1 : 1));
  return Object.fromEntries(entries.map(([key, item]) => [key, sortKeys(item)]));
}
