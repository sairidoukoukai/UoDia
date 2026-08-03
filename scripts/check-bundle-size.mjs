/**
 * 実行ファイルの大きさを確かめる（T-41、仕様書 §9.1）。
 *
 * **入れ物ではなく中身を測る。** インストーラ（`.deb` / `.msi` / `.dmg`）は
 * 圧縮の効き方が OS ごとに違い、同じ数字として比べられない。目標が言っている
 * のは「配ったものが 30MB に収まるか」であり、それは**実行ファイル**の大きさで
 * 判断するのが素直である。
 *
 * 使い方: node scripts/check-bundle-size.mjs
 */

import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** 仕様書 §9.1 の目標値。 */
const LIMIT_MB = 30;

const RELEASE = 'src-tauri/target/release';
/** OS ごとの実行ファイル。どれか 1 つがあればよい。 */
const CANDIDATES = ['uodia', 'uodia.exe', 'UoDia', 'UoDia.exe'];

function findBinary() {
  for (const name of CANDIDATES) {
    const path = join(RELEASE, name);
    try {
      const stat = statSync(path);
      if (stat.isFile()) return { path, bytes: stat.size };
    } catch {
      // 次の候補へ。
    }
  }
  return null;
}

/** 配る形のもの。**組み立ての途中に出る中身は数えない。** */
const BUNDLE_SUFFIXES = ['.deb', '.rpm', '.AppImage', '.msi', '.exe', '.dmg', '.app', '.tar.gz'];

/** 出来上がった配布物（一覧に出すだけ）。 */
function listBundles() {
  const root = join(RELEASE, 'bundle');
  const found = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = join(dir, entry.name);
      const packaged = BUNDLE_SUFFIXES.some((suffix) => entry.name.endsWith(suffix));

      if (entry.isDirectory()) {
        // `.app` は中身ではなく塊として見せる。`UoDia.AppDir` のような
        // 組み立ての途中は開かない。
        if (packaged) found.push({ path, bytes: null });
        else if (!entry.name.includes('.')) walk(path);
      } else if (packaged) {
        found.push({ path, bytes: statSync(path).size });
      }
    }
  };
  walk(root);
  return found;
}

const mb = (bytes) => (bytes / 1024 / 1024).toFixed(1);

const binary = findBinary();
if (binary === null) {
  console.error(`実行ファイルが見つかりません（${RELEASE} を探しました）`);
  process.exit(1);
}

console.log('配布物:');
for (const item of listBundles()) {
  console.log(`  ${item.path}${item.bytes === null ? '' : ` (${mb(item.bytes)}MB)`}`);
}

console.log(`\n実行ファイル: ${binary.path} = ${mb(binary.bytes)}MB（目標 ${LIMIT_MB}MB 以内）`);

if (binary.bytes > LIMIT_MB * 1024 * 1024) {
  console.error(`✖ 目標を超えています`);
  process.exit(1);
}
console.log('✓ 目標を満たしています');
