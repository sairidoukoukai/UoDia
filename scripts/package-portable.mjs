/**
 * ポータブル版を装う（T-94、仕様書（ポータブル版）§5）。
 *
 * ## 同梱リソースは無くなった（T-96）
 *
 * かつては `route.json` を Tauri のリソースとして隣に置いていた。**置き場所が
 * OS ごとに違い**、外すと起動して初めて分かる種類の失敗になっていた。
 *
 * **`route.json` は実行ファイルの中にある**（`frontendDist` に埋まる）。Web 版が
 * `?url` で取り込んでおり、デスクトップ版も同じ道を通るようになった
 * （`src/platform/networkSeed.ts`）。**同じものを 2 か所から配るのをやめた。**
 *
 * 結果、**Linux の `bin/` も要らなくなった**——あれはリソースを
 * `../lib/<productName>` から読むためだけの入れ子だった。
 *
 * ## `OFL.txt` は根に置く
 *
 * Noto Sans JP は OFL-1.1 であり、フォントは実行ファイルの中に埋まっている。
 * ライセンス本文もヘルプから読めるが（`?raw` で埋まっている）、**開かない人にも
 * 見えるところに 1 つ置く。**
 *
 * ## 目印はもう入れない（T-95）
 *
 * T-93 では `portable` という目印を同梱していた。**配るのがポータブル版だけに
 * なった以上、見分ける相手が居ない**（#245）。
 */

import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

/** 版数。書庫の名前に入れる。 */
const VERSION = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;

/**
 * Linux のアプリ一覧に出すための雛形（T-95）。
 *
 * **登録はしない。** 書庫を展開しただけでアプリ一覧に出す方法は無く、置き先も
 * 人によって違う（`~/.local/share/applications/`）。**置きたい人が置ける形で
 * 同梱する**にとどめる。
 *
 * `Exec` と `Icon` は展開先で変わるため、`README.txt` で書き換えを促す。
 */
const DESKTOP_ENTRY = [
  '[Desktop Entry]',
  'Type=Application',
  'Name=UoDia',
  'Comment=再履バスのダイヤグラム設計ソフトウェア',
  'Exec=/path/to/UoDia/uodia',
  'Icon=/path/to/UoDia/icon.png',
  'Categories=Utility;',
  'Terminal=false',
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
    '■ 消すとき',
    '  インストールしていないので、フォルダごと消せば何も残りません。',
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
    ...(platform === 'linux'
      ? [
          '■ アプリ一覧に出したいときは',
          '  uodia.desktop の Exec と Icon を、このフォルダの実際の場所に書き換えて',
          '  ~/.local/share/applications/ に置いてください。置かなくても動きます。',
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
  linux: 'uodia を実行します。',
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

  // **実行ファイルは根の直下に置く。** 同梱リソースが無くなり、入れ子にする
  // 理由が消えた（macOS の `.app` だけは中身ごと 1 つの塊である）。
  if (platform === 'windows') {
    cpSync(binary, join(out, 'UoDia.exe'));
  } else if (platform === 'linux') {
    cpSync(binary, join(out, 'uodia'));
    cpSync(join(root, 'src-tauri/icons/128x128.png'), join(out, 'icon.png'));
    writeFileSync(join(out, 'uodia.desktop'), DESKTOP_ENTRY);
  } else {
    cpSync(binary, join(out, 'UoDia.app'), { recursive: true });
  }

  cpSync(join(root, 'assets/fonts/OFL.txt'), join(out, 'OFL.txt'));
  writeFileSync(join(out, 'README.txt'), readme(platform));
}

/**
 * 配る形になっているかを確かめる。
 *
 * **同梱リソースの置き場所を見る工程は無くなった**（T-96）。リソースが 1 つも
 * 無いためであり、確かめるものが減ったのではなく、**外す余地そのものが消えた。**
 *
 * 代わりに**実行ファイルの中を見る**（{@link verifyEmbedded}）。路線もフォントも
 * そこに埋まっており、埋まっていなければ**起動して初めて分かる。**
 */
export function verify(platform, out) {
  const binary =
    platform === 'windows'
      ? join(out, 'UoDia.exe')
      : platform === 'linux'
        ? join(out, 'uodia')
        : join(out, 'UoDia.app');

  const missing = [join(out, 'OFL.txt'), join(out, 'README.txt'), binary].filter(
    (path) => !existsSync(path),
  );
  if (missing.length > 0) {
    throw new Error(`配る形になっていません:\n  ${missing.join('\n  ')}`);
  }

  if (platform !== 'macos') verifyEmbedded(binary);
}

/**
 * 路線とフォントが実行ファイルに埋まっているかを確かめる。
 *
 * **中身は読めない**（Tauri は資産を圧縮して埋める）。読むのは `dist/` が出した
 * **資産の名前**であり、それが実行ファイルの中に現れるかを見る。
 *
 * **これが外れると、起動して初めて「route.json を取得できません」と出る。**
 * 配る前に落としておく。
 *
 * macOS は `.app` の中の実行ファイルを掘る必要があり、名前も違う。**そこまでは
 * 見ない**——3 つとも同じ `dist/` から作られるため、1 つで外れれば全部で外れる。
 */
function verifyEmbedded(binary) {
  const assets = readdirSync(join(root, 'dist/assets'));
  const wanted = [
    assets.find((name) => /^route-.*\.json$/.test(name)),
    assets.find((name) => /^NotoSansJP-.*\.otf$/.test(name)),
  ];

  if (wanted.some((name) => name === undefined)) {
    throw new Error(
      'dist/assets に路線かフォントがありません（先に build:web を走らせてください）',
    );
  }

  const bytes = readFileSync(binary, 'latin1');
  const missing = wanted.filter((name) => !bytes.includes(name));
  if (missing.length > 0) {
    throw new Error(`実行ファイルに埋まっていません:\n  ${missing.join('\n  ')}`);
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
