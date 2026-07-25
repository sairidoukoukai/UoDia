/**
 * `route.json` の読込（仕様書 §5.1、§5.5.2）。
 *
 * 読込は 3 段階で行い、**どの段階で失敗したかを型で区別する**。
 *
 * 1. `json`   — JSON として解釈できるか
 * 2. `schema` — 期待する形をしているか（T-04）
 * 3. `rules`  — データの内容が矛盾していないか（R-01〜R-09）
 *
 * 段階を混ぜると「ファイルが壊れている」のか「編集内容が矛盾している」のかを
 * 利用者に伝えられない。前者はファイルの復旧、後者は編集の修正と、取るべき
 * 行動が異なる。
 */

import {
  networkDefSchema,
  parseWithSchema,
  type NetworkDef,
  type SchemaIssue,
} from '@/domain/model';
import { validateNetwork, type NetworkIssue } from './validate';

export type LoadNetworkResult =
  | { readonly ok: true; readonly network: NetworkDef }
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
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    // String() は Error でも非 Error でも読める文字列を返すため、型で分岐しない。
    return { ok: false, stage: 'json', message: String(error) };
  }

  const schemaResult = parseWithSchema(networkDefSchema, parsed);
  if (!schemaResult.ok) {
    return { ok: false, stage: 'schema', issues: schemaResult.issues };
  }

  const issues = validateNetwork(schemaResult.value);
  if (issues.length > 0) {
    return { ok: false, stage: 'rules', issues };
  }

  return { ok: true, network: schemaResult.value };
}
