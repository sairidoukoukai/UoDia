/**
 * スキーマ検証の結果を扱うヘルパ。
 *
 * 仕様書 §7.4 は「検証失敗時は不正なパスを示してファイルを開かない」と定める。
 * Zod の `ZodError` をそのまま UI に出すと読めないため、`services[0].trips[3].anchor.time`
 * のような JSON パス付きの文にして返す。
 */

import type { z } from 'zod';

export interface SchemaIssue {
  /** 不正な箇所の JSON パス。例: `services[0].trips[3].anchor.time` */
  readonly path: string;
  readonly message: string;
}

export type ParseResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly issues: readonly SchemaIssue[] };

/**
 * スキーマで検証する。例外は投げず、失敗時は問題の一覧を返す。
 *
 * 例外にしないのは、ファイル読込の失敗が「起きて当たり前」の事象であり、
 * 呼び出し側が必ず扱うべきものだからである。戻り値で表すことで扱い漏れを
 * 型で防ぐ。
 */
export function parseWithSchema<T extends z.ZodTypeAny>(
  schema: T,
  data: unknown,
): ParseResult<z.infer<T>> {
  const result = schema.safeParse(data);
  if (result.success) {
    return { ok: true, value: result.data as z.infer<T> };
  }
  return { ok: false, issues: result.error.issues.map(toSchemaIssue) };
}

function toSchemaIssue(issue: z.ZodIssue): SchemaIssue {
  return { path: formatPath(issue.path), message: issue.message };
}

/**
 * Zod のパス配列を JSON パス風の文字列にする。
 *
 * `['services', 0, 'trips', 3, 'anchor', 'time']`
 *   → `services[0].trips[3].anchor.time`
 */
export function formatPath(path: readonly (string | number | symbol)[]): string {
  if (path.length === 0) {
    return '(ルート)';
  }
  let out = '';
  for (const key of path) {
    if (typeof key === 'number') {
      out += `[${String(key)}]`;
    } else if (out === '') {
      out = String(key);
    } else {
      out += `.${String(key)}`;
    }
  }
  return out;
}

/** 問題の一覧を人が読める複数行の文にする。 */
export function formatIssues(issues: readonly SchemaIssue[]): string {
  return issues.map((i) => `${i.path}: ${i.message}`).join('\n');
}
