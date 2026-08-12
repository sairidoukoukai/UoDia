/**
 * ポータブル版を装う（T-94、仕様書（ポータブル版）§5）。
 *
 * ## リソースの置き場所は OS ごとに違う
 *
 * Tauri は同梱リソースを実行ファイルからの相対で探す（`tauri-utils` の
 * `resource_dir_from`）。**3 つとも違う。**
 *
 * | OS | 探す先 |
 * | --- | --- |
 * | Windows | 実行ファイルと同じ階層 |
 * | Linux | `<実行ファイルの階層>/../lib/<productName>` |
 * | macOS | `<実行ファイルの階層>/../Resources`（`.app` の中） |
 *
 * **`resources/` に置くのは誤りである。** どの OS もそこを見ない。仕様書の初版は
 * そう書いていたが、実装のときに読み違いだと分かった（版数 1.1 で訂正）。
 *
 * **Linux の `lib/` は `productName` で決まる**（`UoDia`。小文字ではない）。
 * `tauri.conf.json` を直すとここも変わるため、**置いたものが読まれる場所に
 * あるかを最後に確かめる**（{@link verify}）。
 *
 * ## 目印を最初から入れる
 *
 * 展開しただけでポータブルとして動く（§5）。利用者に作らせると、その手順を
 * 説明する文章が要る——**入れておくほうが短い。**
 */

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

/** `tauri.conf.json` の `productName`。**Linux の `lib/` の名前を決める。** */
const PRODUCT_NAME = JSON.parse(
  readFileSync(join(root, 'src-tauri/tauri.conf.json'), 'utf8'),
).productName;

/** 版数。書庫の名前に入れる。 */
const VERSION = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;

/** 同梱するもの。`bundle.resources` と同じ対応にする。 */
const RESOURCES = [
  ['data/route.json', 'route.json'],
  ['assets/fonts/OFL.txt', 'OFL.txt'],
];

/** 目印。**中身は見られない**ので、何のためのものかだけ書いておく。 */
const MARKER_TEXT = [
  'このファイルがあると、UoDia は設定や自動保存を data/ に書きます。',
  '消すと、ふつうのインストール版と同じ場所（OS の設定ディレクトリ）に書きます。',
  '',
].join('\n');

function readme(platform) {
  return [
    `UoDia ${VERSION}（ポータブル版）`,
    '',
    '■ 使い方',
    '  このフォルダごと持ち歩けます。USB メモリに入れて別の端末で続きを描けます。',
    `  ${START[platform]}`,
    '',
    '■ 自分のものは data/ に入ります',
    '  設定・自動保存・最近使ったファイルが入ります。消すと初期状態に戻ります。',
    '  このフォルダの外には何も書きません。',
    '',
    '■ portable というファイルについて',
    '  これがあるとポータブルとして動きます。消すと、ふつうのインストール版と',
    '  同じ場所（OS の設定ディレクトリ）に書くようになります。',
    '',
    ...(platform === 'windows'
      ? [
          '■ 動かないときは',
          '  Microsoft Edge WebView2 ランタイムが要ります。Windows 10（2021 年以降の',
          '  更新）と Windows 11 には最初から入っています。入っていない場合は',
          '  Microsoft の配布ページから入れてください。',
          '',
        ]
      : []),
    ...(platform === 'macos'
      ? [
          '■ data/ は UoDia.app の「隣」に作られます',
          '  .app の中には書きません（書くと署名が壊れます）。UoDia.app だけを',
          '  別の場所へ移すと data/ は付いてきません。フォルダごと移してください。',
          '',
        ]
      : []),
    '■ 更新',
    '  自動更新はありません。新しい版の書庫を展開し、data/ を移してください。',
    '',
    '■ これは大阪大学の公式なソフトウェアではありません。',
    '',
  ].join('\n');
}

const START = {
  windows: 'UoDia.exe をダブルクリックで起動します。',
  linux: 'bin/uodia を実行します。',
  macos: 'UoDia.app を開きます。',
};

/**
 * 版面を組み立てる。
 *
 * @param platform `windows` / `linux` / `macos`
 * @param binary 出来上がった実行ファイル（macOS は `.app`）へのパス
 * @param out 組み立て先
 */
export function layout(platform, binary, out) {
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });

  if (platform === 'windows') {
    // **リソースは実行ファイルと同じ階層。** Windows だけは `resource_dir` が
    // 実行ファイルの階層をそのまま返す。
    cpSync(binary, join(out, 'UoDia.exe'));
    for (const [from, to] of RESOURCES) cpSync(join(root, from), join(out, to));
  } else if (platform === 'linux') {
    // **`bin/` に置く。** リソースを `../lib/<productName>` から読むため、
    // 実行ファイルを根の直下には置けない。
    mkdirSync(join(out, 'bin'), { recursive: true });
    mkdirSync(join(out, 'lib', PRODUCT_NAME), { recursive: true });
    cpSync(binary, join(out, 'bin', 'uodia'));
    for (const [from, to] of RESOURCES) {
      cpSync(join(root, from), join(out, 'lib', PRODUCT_NAME, to));
    }
  } else {
    // **`.app` はそのまま置く。** リソースは既に `Contents/Resources` にある。
    cpSync(binary, join(out, 'UoDia.app'), { recursive: true });
  }

  writeFileSync(join(out, 'portable'), MARKER_TEXT);
  writeFileSync(join(out, 'README.txt'), readme(platform));
}

/**
 * 置いたものが、Tauri が読む場所にあるかを確かめる。
 *
 * **`productName` を変えると Linux の `lib/` の名前が変わる。** 気づかないまま
 * 配ると、**起動して初めて「route.json を読み込めません」と出る。** ここで
 * 落としておけば、配る前に気づく。
 */
export function verify(platform, out) {
  const expected =
    platform === 'windows'
      ? [join(out, 'route.json'), join(out, 'OFL.txt')]
      : platform === 'linux'
        ? [join(out, 'lib', PRODUCT_NAME, 'route.json'), join(out, 'lib', PRODUCT_NAME, 'OFL.txt')]
        : [join(out, 'UoDia.app', 'Contents', 'Resources', 'route.json')];

  const missing = expected.filter((path) => !existsSync(path));
  if (missing.length > 0) {
    throw new Error(`同梱リソースが読まれる場所にありません:\n  ${missing.join('\n  ')}`);
  }

  // 目印と説明は 3 つとも要る。
  for (const name of ['portable', 'README.txt']) {
    if (!existsSync(join(out, name))) throw new Error(`${name} がありません`);
  }
}

/** 書庫の名前（§5）。 */
export function archiveName(platform, arch) {
  const ext = platform === 'linux' ? 'tar.gz' : 'zip';
  return `UoDia-${VERSION}-${platform}-${arch}-portable.${ext}`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [platform, binary, out] = process.argv.slice(2);
  if (platform === undefined || binary === undefined || out === undefined) {
    console.error('使い方: node scripts/package-portable.mjs <platform> <binary> <out>');
    process.exit(1);
  }

  layout(platform, binary, out);
  verify(platform, out);
  console.log(`組み立てました: ${out}`);
}
