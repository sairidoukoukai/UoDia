/**
 * 配布物をあらかじめ圧縮する（T-42、仕様書 §10.4）。
 *
 * **静的ホスティングが自分で圧縮してくれるとは限らない。** 置くだけの配信先
 * （ファイルサーバ、社内の共有領域）では、`.gz` / `.br` を隣に置いておけば、
 * 対応しているサーバがそれを配る。対応していなくても、元のファイルがそのまま
 * 配られるだけで害はない。
 *
 * 依存を増やさないよう、Node の `zlib` だけで行う。
 *
 * 使い方: node scripts/compress-dist.mjs [dist]
 */

import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';

const root = process.argv[2] ?? 'dist';

/** 圧縮して意味のあるもの。画像や地図（.map）は配信に載らないため触らない。 */
const TARGETS = ['.html', '.js', '.css', '.json', '.svg'];
/** これより小さいものは圧縮しない。**縮まないうえに要求が 1 つ増える。** */
const MIN_BYTES = 1024;

const files = [];
const walk = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path);
    else if (TARGETS.some((suffix) => entry.name.endsWith(suffix))) files.push(path);
  }
};
walk(root);

let raw = 0;
let gzip = 0;

for (const path of files) {
  const bytes = statSync(path).size;
  raw += bytes;
  if (bytes < MIN_BYTES) continue;

  const content = readFileSync(path);
  const gz = gzipSync(content, { level: 9 });
  const br = brotliCompressSync(content, {
    params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_SIZE_HINT]: bytes },
  });

  writeFileSync(`${path}.gz`, gz);
  writeFileSync(`${path}.br`, br);
  gzip += gz.length;
}

const mb = (bytes) => `${(bytes / 1024).toFixed(0)}KB`;
console.log(`圧縮しました: ${String(files.length)} 件 / 元 ${mb(raw)} → gzip ${mb(gzip)}`);
