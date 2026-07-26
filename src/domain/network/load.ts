/**
 * `route.json` の読込（仕様書 §5.1、§5.5.2）。
 *
 * 読込は 3 段階で行い、**どの段階で失敗したかを型で区別する**。
 *
 * 1. `json`   — JSON として解釈できるか
 * 2. `schema` — 期待する形をしているか（T-04）
 * 3. `rules`  — データの内容が矛盾していないか（R-01〜R-10）
 *
 * 段階を混ぜると「ファイルが壊れている」のか「編集内容が矛盾している」のかを
 * 利用者に伝えられない。前者はファイルの復旧、後者は編集の修正と、取るべき
 * 行動が異なる。
 *
 * 成功時は生の `NetworkDef` ではなく索引化した `NetworkIndex` を返す（T-07）。
 * 索引の構築は R-03・R-06・R-10 が満たされていることを前提とするため、検証を
 * 通った直後のこの場所が、それを保証できる唯一の地点である。生の定義は
 * `NetworkIndex.def` から取れる。
 */

import { networkDefSchema, parseWithSchema, type SchemaIssue } from '@/domain/model';
import { parseJson } from '@/domain/util';
import { buildNetworkIndex, type NetworkIndex } from './networkIndex';
import { validateNetwork, type NetworkIssue } from './validate';

export type LoadNetworkResult =
  | { readonly ok: true; readonly network: NetworkIndex }
  | { readonly ok: false; readonly stage: 'json'; readonly message: string }
  | { readonly ok: false; readonly stage: 'schema'; readonly issues: readonly SchemaIssue[] }
  | { readonly ok: false; readonly stage: 'rules'; readonly issues: readonly NetworkIssue[] };

/**
 * `route.json` の内容を読み込む。
 *
 * 文字列を受け取るのは、ファイルの取得方法が環境によって異なるため
 * （デスクトップはファイル、Web は静的アセット）。ドメイン層は I/O を持たない
 * という方針に従い、読み出しは `PlatformAdapter` の責務とする。
 */
export function loadNetworkDef(json: string): LoadNetworkResult {
  const parsed = parseJson(json);
  if (!parsed.ok) {
    return { ok: false, stage: 'json', message: parsed.message };
  }

  const schemaResult = parseWithSchema(networkDefSchema, parsed.value);
  if (!schemaResult.ok) {
    return { ok: false, stage: 'schema', issues: schemaResult.issues };
  }

  const issues = validateNetwork(schemaResult.value);
  if (issues.length > 0) {
    return { ok: false, stage: 'rules', issues };
  }

  return { ok: true, network: buildNetworkIndex(schemaResult.value) };
}
