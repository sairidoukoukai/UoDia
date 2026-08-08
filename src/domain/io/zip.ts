/**
 * 無圧縮 zip の組み立て（実装計画書 v2 §3.1、仕様書 v2 §5.3、T-74）。**純関数のみ。**
 *
 * ## なぜ自前で書くか
 *
 * **圧縮しないと決めてある**（仕様書 v2 §5.3）。包むものの大半は PNG と PDF で
 * あり、どちらも既に圧縮されている。圧縮しないなら zip に要るのは、3 種類の
 * レコードと CRC32 だけである——**圧縮アルゴリズムを持ち込む必要が無い。**
 *
 * ## 何を書き、何を書かないか
 *
 * | | |
 * | --- | --- |
 * | 書く | ローカルファイルヘッダ・中央ディレクトリ・終端レコード（EOCD） |
 * | 書かない | 圧縮（method は常に 0 = store）・暗号化・分割・zip64 |
 *
 * **zip64 を書かない代わりに、上限を超えたら断る**（{@link ZIP32_LIMIT}）。黙って
 * 壊れた書庫を作るより、作れないと言うほうがよい。300dpi の画像を数枚包む用途で
 * 4GiB に届くことは無く、届いたならそれは別の不具合である。
 *
 * ## 名前は UTF-8 で書く
 *
 * zip の古い決めでは、ファイル名の文字コードは CP437 である。日本語を入れる
 * 手立ては 2 つあり、**汎用ビット 11（言語エンコーディングフラグ）を立てて
 * UTF-8 で書く**ほうを採る。これは APPNOTE 6.3.0 が定めた道であり、Windows の
 * エクスプローラも `unzip` も macOS の Finder もこれを読む。
 */

/** 無圧縮 zip の 1 件。 */
export interface ZipEntry {
  /** 書庫の中での名前。区切りは `/`。**日本語をそのまま入れてよい。** */
  readonly name: string;
  readonly bytes: Uint8Array;
}

export interface BuildZipOptions {
  /**
   * 各項目に記録する更新日時。既定は現在時刻。
   *
   * **地方時として記録する。** zip の日時に時間帯の情報は無く、読む側は書かれた
   * 値をそのまま表示する（仕様は DOS の日時であり、これは地方時である）。
   */
  readonly modifiedAt?: Date;
}

/**
 * zip32 が扱える大きさの上限（4GiB − 1）。
 *
 * ヘッダの大きさ欄が 4 バイトであることから来る。これを超えるものは zip64 でしか
 * 表せない。
 */
export const ZIP32_LIMIT = 0xffff_ffff;

/** 無圧縮（store）。 */
const METHOD_STORE = 0;
/** 展開に要る版数。2.0（= 20）。無圧縮と通常の書庫はこれで足りる。 */
const VERSION_NEEDED = 20;
/**
 * 作った側の版数。上位バイトが**作った環境**、下位が版数（3 = Unix、20 = 2.0）。
 *
 * **MS-DOS（0）を名乗ってはならない。** Info-ZIP の `unzip` は、DOS で作られた
 * 書庫の名前を CP437 として扱い、**UTF-8 の印（{@link FLAG_UTF8}）より先に
 * 文字コードを変換してしまう。** 日本語の名前がキリル文字に化けることを実際に
 * 確かめている（`zip.test.ts`）。Unix を名乗れば、名前はバイト列のまま渡る。
 *
 * Unix を名乗る以上、**権限も書かなければならない**（{@link EXTERNAL_ATTRIBUTES}）。
 */
const VERSION_MADE_BY = (3 << 8) | 20;
/**
 * 外部属性。上位 16 ビットが Unix の権限（`0100644` = 通常ファイル・rw-r--r--）。
 *
 * **0 のままにしてはならない。** Unix を名乗った書庫で属性が 0 だと、`unzip` は
 * それを権限として当ててしまい、**取り出したファイルが誰にも読めなくなる**
 * （`----------`。実際に確かめている）。
 */
const EXTERNAL_ATTRIBUTES = 0o100644 << 16;
/** 汎用ビット 11。**名前とコメントが UTF-8 であることを表す。** */
const FLAG_UTF8 = 0x0800;

const LOCAL_HEADER_SIGNATURE = 0x04034b50;
const CENTRAL_HEADER_SIGNATURE = 0x02014b50;
const EOCD_SIGNATURE = 0x06054b50;

const LOCAL_HEADER_SIZE = 30;
const CENTRAL_HEADER_SIZE = 46;
const EOCD_SIZE = 22;

/**
 * 無圧縮 zip を組み立てる。
 *
 * @throws 名前が重なっているとき、または 4GiB を超えるとき
 */
export function buildZip(entries: readonly ZipEntry[], options: BuildZipOptions = {}): Uint8Array {
  assertNoDuplicates(entries);

  const modifiedAt = options.modifiedAt ?? new Date();
  const { time, date } = dosDateTime(modifiedAt);

  const encoder = new TextEncoder();
  const prepared = entries.map((entry) => {
    const name = encoder.encode(entry.name);
    return { name, bytes: entry.bytes, crc: crc32(entry.bytes) };
  });

  // 先に全体の大きさを決めてから 1 度だけ確保する。継ぎ足しながら組むと、
  // 数 MB の書庫で配列の複製が何度も起きる。
  const localSize = prepared.reduce(
    (total, item) => total + LOCAL_HEADER_SIZE + item.name.length + item.bytes.length,
    0,
  );
  const centralSize = prepared.reduce(
    (total, item) => total + CENTRAL_HEADER_SIZE + item.name.length,
    0,
  );
  const total = localSize + centralSize + EOCD_SIZE;
  if (total > ZIP32_LIMIT) {
    throw new RangeError(`書庫が大きすぎます（${String(total)} バイト）`);
  }

  const buffer = new Uint8Array(total);
  const view = new DataView(buffer.buffer);
  let at = 0;

  /** 各項目のローカルヘッダが書庫の先頭から何バイト目にあるか。 */
  const offsets: number[] = [];

  for (const item of prepared) {
    if (item.bytes.length > ZIP32_LIMIT) {
      throw new RangeError(`ファイルが大きすぎます（${String(item.bytes.length)} バイト）`);
    }
    offsets.push(at);

    view.setUint32(at, LOCAL_HEADER_SIGNATURE, true);
    view.setUint16(at + 4, VERSION_NEEDED, true);
    view.setUint16(at + 6, FLAG_UTF8, true);
    view.setUint16(at + 8, METHOD_STORE, true);
    view.setUint16(at + 10, time, true);
    view.setUint16(at + 12, date, true);
    view.setUint32(at + 14, item.crc, true);
    // 無圧縮であるから、圧縮後と圧縮前の大きさは等しい。
    view.setUint32(at + 18, item.bytes.length, true);
    view.setUint32(at + 22, item.bytes.length, true);
    view.setUint16(at + 26, item.name.length, true);
    view.setUint16(at + 28, 0, true);
    at += LOCAL_HEADER_SIZE;

    buffer.set(item.name, at);
    at += item.name.length;
    buffer.set(item.bytes, at);
    at += item.bytes.length;
  }

  const centralStart = at;

  for (const [index, item] of prepared.entries()) {
    view.setUint32(at, CENTRAL_HEADER_SIGNATURE, true);
    view.setUint16(at + 4, VERSION_MADE_BY, true);
    view.setUint16(at + 6, VERSION_NEEDED, true);
    view.setUint16(at + 8, FLAG_UTF8, true);
    view.setUint16(at + 10, METHOD_STORE, true);
    view.setUint16(at + 12, time, true);
    view.setUint16(at + 14, date, true);
    view.setUint32(at + 16, item.crc, true);
    view.setUint32(at + 20, item.bytes.length, true);
    view.setUint32(at + 24, item.bytes.length, true);
    view.setUint16(at + 28, item.name.length, true);
    // 追加領域・コメント・分割は持たない。
    view.setUint16(at + 30, 0, true);
    view.setUint16(at + 32, 0, true);
    view.setUint16(at + 34, 0, true);
    view.setUint16(at + 36, 0, true);
    view.setUint32(at + 38, EXTERNAL_ATTRIBUTES, true);
    view.setUint32(at + 42, offsets[index] ?? 0, true);
    at += CENTRAL_HEADER_SIZE;

    buffer.set(item.name, at);
    at += item.name.length;
  }

  view.setUint32(at, EOCD_SIGNATURE, true);
  view.setUint16(at + 4, 0, true);
  view.setUint16(at + 6, 0, true);
  view.setUint16(at + 8, prepared.length, true);
  view.setUint16(at + 10, prepared.length, true);
  view.setUint32(at + 12, centralSize, true);
  view.setUint32(at + 16, centralStart, true);
  view.setUint16(at + 20, 0, true);

  return buffer;
}

/**
 * 名前の重なりを断る。
 *
 * zip は同じ名前を 2 度書くことを禁じていないが、**展開すると片方が消える。**
 * 6 つのファイルを出したつもりで 5 つしか出ない、という形で現れるため、
 * 組み立てる時点で止める。
 */
function assertNoDuplicates(entries: readonly ZipEntry[]): void {
  const seen = new Set<string>();
  for (const entry of entries) {
    if (seen.has(entry.name)) {
      throw new Error(`名前が重なっています: ${entry.name}`);
    }
    seen.add(entry.name);
  }
}

/**
 * DOS 形式の日時（{@link buildZip} が各項目に書く）。
 *
 * **秒は 2 秒刻みである。** DOS の日時は 4 バイトしか無く、秒に 5 ビットしか
 * 割かれていない。**1980 年より前は表せない**ため、その場合は 1980-01-01 に
 * 丸める。
 */
export function dosDateTime(at: Date): { readonly time: number; readonly date: number } {
  const year = at.getFullYear();
  if (year < 1980) return { time: 0, date: (1 << 5) | 1 };

  const time = (at.getHours() << 11) | (at.getMinutes() << 5) | (at.getSeconds() >> 1);
  const date = ((year - 1980) << 9) | ((at.getMonth() + 1) << 5) | at.getDate();
  return { time, date };
}

/** CRC32 の表。最初に要ったときに 1 度だけ作る。 */
let crcTable: Uint32Array | null = null;

function tableOf(): Uint32Array {
  if (crcTable !== null) return crcTable;

  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      // 0xEDB88320 は CRC-32/ISO-HDLC の生成多項式を逆順にしたもの。
      value = (value & 1) === 1 ? (value >>> 1) ^ 0xedb88320 : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  crcTable = table;
  return table;
}

/**
 * CRC-32（zip が各項目に書く検査値）。
 *
 * **展開ツールはこれを照合する。** 誤ると「書庫が壊れている」と言われ、中身が
 * 正しくても取り出せない。
 */
export function crc32(bytes: Uint8Array): number {
  const table = tableOf();
  let crc = 0xffff_ffff;
  for (const byte of bytes) {
    crc = (crc >>> 8) ^ (table[(crc ^ byte) & 0xff] ?? 0);
  }
  return (crc ^ 0xffff_ffff) >>> 0;
}
