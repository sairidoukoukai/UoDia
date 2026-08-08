/**
 * CSV の組み立て（仕様書 v2 §5.6.3、実装計画書 v2 §3.5、T-76）。**純関数のみ。**
 *
 * ここにあるのは**書式だけ**である。何を並べるかは呼ぶ側が決める——この層に
 * 停留所も便も出てこない。
 *
 * ## 決めごとは 3 つ
 *
 * | 項目 | 決め | 理由 |
 * | --- | --- | --- |
 * | 文字コード | **UTF-8（BOM 付き）** | **付けないと Excel が化けさせる。** 停留所名が読めなければ CSV の意味が無い |
 * | 改行 | CRLF | RFC 4180 |
 * | 引用符 | 値に `,` `"` 改行が含まれるときだけ | 同上 |
 *
 * **`.uodia` は BOM なしと決めてある**（仕様書 §7.1）。逆にするのは**読む相手が
 * 違う**からである——`.uodia` を読むのはこのアプリ、CSV を読むのは表計算ソフトと
 * 人である。
 */

/** 行の並び。1 行は升目の並び。 */
export type CsvRows = readonly (readonly string[])[];

/** 改行（RFC 4180）。 */
const CRLF = '\r\n';

/**
 * UTF-8 の BOM。
 *
 * **Excel はこれを見て UTF-8 だと判断する。** 無いと環境の既定（日本語 Windows
 * では CP932）で読まれ、停留所名が化ける。
 */
const BOM = [0xef, 0xbb, 0xbf];

/** 囲む必要のある文字（RFC 4180）。 */
function needsQuotes(value: string): boolean {
  return value.includes(',') || value.includes('"') || value.includes('\n') || value.includes('\r');
}

/**
 * 升目 1 つを書く。
 *
 * 囲むのは要るときだけである。**すべてを囲むと、囲みを解かない読み手で
 * 引用符が値の一部として出る。**
 */
export function csvField(value: string): string {
  // 引用符そのものは 2 つ重ねて表す（RFC 4180）。
  return needsQuotes(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

/** 行を CSV の文字列にする。**末尾にも改行を置く**（RFC 4180 は任意とする）。 */
export function toCsv(rows: CsvRows): string {
  return rows.map((row) => row.map(csvField).join(',')).join(CRLF) + CRLF;
}

/**
 * CSV をファイルに書けるバイト列にする。**BOM を付ける。**
 *
 * 文字列ではなくバイト列を返すのは、書き出しが zip に包むためである
 * （`domain/io/zip.ts`）。文字列のまま渡すと、包む側が符号化を決めることになる。
 */
export function encodeCsv(rows: CsvRows): Uint8Array {
  const body = new TextEncoder().encode(toCsv(rows));
  const bytes = new Uint8Array(BOM.length + body.length);
  bytes.set(BOM, 0);
  bytes.set(body, BOM.length);
  return bytes;
}
