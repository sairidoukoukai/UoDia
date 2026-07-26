/**
 * プラットフォーム境界が機械的に守られていることの検証（T-12 の受入条件）。
 *
 * 「Tauri API を直接呼ばない」は方針を書くだけでは守られない。**その方針を破った
 * コードが実際に弾かれること**を確かめる。設定からルールを外してしまえばこの
 * テストが落ちるため、境界が静かに消えることがない。
 *
 * ESLint を子プロセスで起動すると 1 件あたり数秒かかるため、API を直接使う。
 * 一時ファイルを実際に作るのは、型情報を用いるルールが有効であり、存在しない
 * ファイルは TypeScript のプロジェクトに属さないと判断されるためである。
 */

import { ESLint } from 'eslint';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// ESLint の初回起動は TypeScript のプロジェクトを読み込むため数秒かかる。
// 他のテストと同時に走ると既定の 5 秒を超えることがある。
vi.setConfig({ testTimeout: 60000 });

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const scratchDirs: string[] = [];

let eslint: ESLint;

beforeAll(() => {
  eslint = new ESLint({ cwd: repoRoot });
});

afterAll(() => {
  for (const dir of scratchDirs) rmSync(dir, { recursive: true, force: true });
});

/** 断片を指定のディレクトリに置いて検査し、報告されたルール名を返す。 */
async function lintSnippet(directory: string, source: string): Promise<string[]> {
  const dir = mkdtempSync(join(repoRoot, directory, 'boundary-'));
  scratchDirs.push(dir);
  const file = join(dir, 'sample.ts');
  writeFileSync(file, source, 'utf8');

  const results = await eslint.lintFiles([file]);
  return results.flatMap((result) => result.messages.map((m) => m.ruleId ?? 'parse-error'));
}

describe('ドメイン層とフィーチャ層はプラットフォーム API を直接使えない', () => {
  it('src/domain で Tauri API の import が弾かれる', async () => {
    const rules = await lintSnippet(
      'src/domain',
      "import { invoke } from '@tauri-apps/api/core';\nexport const x = invoke;\n",
    );
    expect(rules).toContain('no-restricted-imports');
  });

  it('src/features で Tauri API の import が弾かれる', async () => {
    const rules = await lintSnippet(
      'src/features',
      "import { invoke } from '@tauri-apps/api/core';\nexport const x = invoke;\n",
    );
    expect(rules).toContain('no-restricted-imports');
  });

  it('特定の実装への直接 import が弾かれる', async () => {
    const rules = await lintSnippet(
      'src/features',
      "import { x } from '@/platform/tauri';\nexport const y = x;\n",
    );
    expect(rules).toContain('no-restricted-imports');
  });

  it('src/domain でブラウザの永続化 API が弾かれる', async () => {
    const rules = await lintSnippet('src/domain', 'export const x = localStorage.getItem("a");\n');
    expect(rules).toContain('no-restricted-globals');
  });

  it('src/domain で DOM への依存が弾かれる', async () => {
    const rules = await lintSnippet('src/domain', 'export const x = document.title;\n');
    expect(rules).toContain('no-restricted-globals');
  });

  it('src/features では DOM を使える（画面を描く以上避けられない）', async () => {
    const rules = await lintSnippet('src/features', 'export const x = document.title;\n');
    expect(rules).not.toContain('no-restricted-globals');
  });

  it('**境界を守ったコードは通る**（何でも弾く設定になっていない）', async () => {
    const rules = await lintSnippet(
      'src/features',
      "import type { PlatformAdapter } from '@/platform';\nexport type X = PlatformAdapter;\n",
    );
    expect(rules).toEqual([]);
  });
});
