/**
 * Rust 側のコマンドと TypeScript 側の呼び出しが噛み合っていることの検証（T-13）。
 *
 * `invoke('name', { args })` はただの文字列とオブジェクトであり、**綴りを間違えても
 * 型検査は通る**。食い違いは実行時に初めて、しかも「保存できない」といった形で
 * 現れる。両側の宣言を読み比べて、機械的に突き合わせる。
 *
 * Tauri は JS 側の camelCase を Rust 側の snake_case へ自動で変換する。この
 * 対応も含めて確かめる。
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const rustSource = readFileSync(
  fileURLToPath(new URL('../../src-tauri/src/commands.rs', import.meta.url)),
  'utf8',
);
const registrationSource = readFileSync(
  fileURLToPath(new URL('../../src-tauri/src/lib.rs', import.meta.url)),
  'utf8',
);
const tsSource = readFileSync(fileURLToPath(new URL('./tauri.ts', import.meta.url)), 'utf8');

/** Rust 側のコマンド名と、`AppHandle` を除いた引数名。 */
function parseRustCommands(): Map<string, string[]> {
  const commands = new Map<string, string[]>();
  const pattern = /#\[tauri::command\]\s*pub\s+(?:async\s+)?fn\s+(\w+)\s*\(([^)]*)\)/g;

  for (const match of rustSource.matchAll(pattern)) {
    const [, name = '', rawParams = ''] = match;
    const params = rawParams
      .split(',')
      .map((p) => p.trim())
      .filter((p) => p !== '' && !p.includes('AppHandle'))
      .map((p) => p.split(':')[0]?.trim() ?? '');
    commands.set(name, params);
  }
  return commands;
}

/** TypeScript 側が呼んでいるコマンド名と、渡している引数名。 */
function parseTsInvocations(): Map<string, string[]> {
  const invocations = new Map<string, string[]>();
  const pattern = /invoke(?:<[^>]*>)?\(\s*'([\w]+)'\s*(?:,\s*\{([^}]*)\})?\s*\)/g;

  for (const match of tsSource.matchAll(pattern)) {
    const [, name = '', rawArgs] = match;
    const args =
      rawArgs === undefined
        ? []
        : rawArgs
            .split(',')
            .map((a) => a.trim())
            .filter((a) => a !== '')
            .map((a) => a.split(':')[0]?.trim() ?? '');
    invocations.set(name, args);
  }
  return invocations;
}

function toSnakeCase(value: string): string {
  return value.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

const rustCommands = parseRustCommands();
const tsInvocations = parseTsInvocations();

describe('コマンドの突き合わせ', () => {
  it('Rust 側のコマンドを読み取れている（解析が壊れていない）', () => {
    expect(rustCommands.size).toBeGreaterThan(5);
    expect([...rustCommands.keys()]).toContain('save_project_file');
  });

  it('TypeScript 側の呼び出しを読み取れている', () => {
    expect(tsInvocations.size).toBeGreaterThan(5);
    expect([...tsInvocations.keys()]).toContain('save_project_file');
  });

  it('**呼んでいるコマンドがすべて Rust 側に存在する**', () => {
    const missing = [...tsInvocations.keys()].filter((name) => !rustCommands.has(name));
    expect(missing).toEqual([]);
  });

  it('**Rust 側のコマンドがすべて呼ばれている**（使われない口を残さない）', () => {
    const unused = [...rustCommands.keys()].filter((name) => !tsInvocations.has(name));
    expect(unused).toEqual([]);
  });

  it('**すべてのコマンドが `invoke_handler` に登録されている**', () => {
    const unregistered = [...rustCommands.keys()].filter(
      (name) => !registrationSource.includes(`commands::${name}`),
    );
    expect(unregistered).toEqual([]);
  });

  it('引数の名前と個数が一致する（camelCase ↔ snake_case）', () => {
    const mismatches: string[] = [];
    for (const [name, args] of tsInvocations) {
      const params = rustCommands.get(name) ?? [];
      const expected = [...params].sort((a, b) => a.localeCompare(b));
      const actual = args.map(toSnakeCase).sort((a, b) => a.localeCompare(b));
      if (JSON.stringify(expected) !== JSON.stringify(actual)) {
        mismatches.push(`${name}: Rust=[${expected.join(',')}] TS=[${actual.join(',')}]`);
      }
    }
    expect(mismatches).toEqual([]);
  });
});
