/**
 * PDF の部品が初回ロードに乗っていないことの検証（T-77、仕様書 v2 §5.4.2）。
 *
 * ## なぜ組み上げずに確かめるのか
 *
 * 出来た `dist/` を数えるほうが直接的だが、**それには毎回組み上げが要る。**
 * 一方、初回ロードに乗ってしまう原因はいつも同じである——**どこかが `pdf-lib`
 * や `fontkit` を静的に import した。** 原因のほうを見れば、組み上げずに、
 * かつ壊れた瞬間に分かる。
 *
 * ```
 * 起動時に読む道 ──静的 import──> pdf-lib   ← これが 1 本でもあれば負け
 * 書き出しの道   ──import()────> pdf-lib   ← こちらだけにする
 * ```
 *
 * 組み上げ側の割り当ては `vite.config.ts` の `manualChunks` が持つ（`pdf` と
 * いう別のチャンクに置く）。**そちらも一緒に確かめる**——片方だけ直しても、
 * 初回ロードからは外れない。
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../../..', import.meta.url));
const sourceRoot = join(root, 'src');

/** 書き出しのときだけ読んでよいもの。 */
const LAZY_PACKAGES = ['pdf-lib', 'fontkit'];

/**
 * 静的に import してよいファイル。
 *
 * **どれも `import()` の先にしか現れない。** `pdf/` の中で静的に繋ぐのは
 * かまわない——その塊ごと遅れて落ちてくる。
 */
const ALLOWED = ['src/features/export/pdf/'];

function sourceFiles(directory: string): string[] {
  const found: string[] = [];
  for (const name of readdirSync(directory)) {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) {
      found.push(...sourceFiles(path));
    } else if (/\.tsx?$/.test(name) && !/\.(test|spec)\.tsx?$/.test(name)) {
      found.push(path);
    }
  }
  return found;
}

/** そのファイルが静的に import しているパッケージ。 */
function staticImports(source: string): string[] {
  const found: string[] = [];
  // `import ... from 'x'` と `import 'x'`。**`await import('x')` は拾わない**
  // ——行頭の `import` だけを見る。
  for (const match of source.matchAll(/^import\s[^;]*?from\s+'([^']+)'/gm)) {
    if (match[1] !== undefined) found.push(match[1]);
  }
  for (const match of source.matchAll(/^import\s+'([^']+)'/gm)) {
    if (match[1] !== undefined) found.push(match[1]);
  }
  return found;
}

/** 型だけの import か。**型は実行時に残らない。** */
function isTypeOnly(source: string, module: string): boolean {
  return new RegExp(`^import\\s+type\\s[^;]*?from\\s+'${module}'`, 'm').test(source);
}

describe('起動時に読む道から切り離されている', () => {
  const files = sourceFiles(sourceRoot);

  it('走査できている（空振りしていない）', () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it('**`pdf-lib` と `fontkit` を静的に import していない**（受入条件）', () => {
    const offenders: string[] = [];

    for (const path of files) {
      const relative = path.slice(root.length);
      if (ALLOWED.some((prefix) => relative.startsWith(prefix))) continue;

      const source = readFileSync(path, 'utf8');
      for (const module of staticImports(source)) {
        if (!LAZY_PACKAGES.includes(module)) continue;
        // 型だけならバンドルに残らない。
        if (isTypeOnly(source, module)) continue;
        offenders.push(`${relative}: ${module}`);
      }
    }

    expect(offenders).toEqual([]);
  });

  it('**フォントも動的にしか読まない**（4.5MB を起動のたびに落とさない）', () => {
    const offenders = files.filter((path) => {
      const source = readFileSync(path, 'utf8');
      return /^import\s[^;]*NotoSansJP/m.test(source);
    });

    expect(offenders).toEqual([]);
  });
});

describe('組み上げ側の割り当て（`vite.config.ts`）', () => {
  const config = readFileSync(join(root, 'vite.config.ts'), 'utf8');

  it('**PDF の部品を `vendor` に混ぜない**', () => {
    // 混ぜると、`import()` で切り離しても起動のたびに落ちてくる。
    expect(config).toContain("'pdf'");
    for (const name of LAZY_PACKAGES) {
      expect(config).toContain(`'${name}'`);
    }
  });
});
