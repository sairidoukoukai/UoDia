/**
 * fontkit を pdf-lib に繋ぐ（T-77）。
 *
 * ## なぜ `@pdf-lib/fontkit` を使わないか
 *
 * **サブセット化した日本語フォントが壊れる。** 実際に確かめた結果である。
 *
 * | 組み合わせ | 出来た PDF | 外の道具（`pdftotext` / `mutool`）で描かせると |
 * | --- | --- | --- |
 * | `@pdf-lib/fontkit` + サブセット | 20KB | **「埋め込みフォントが不正」。** 字は環境のフォントで代替される |
 * | `@pdf-lib/fontkit` + 全部埋める | 3.8MB | 「フォントの種別と中身が食い違う」の警告 |
 * | **`fontkit` 2.x + サブセット** | **20KB** | **警告なし。全部埋めたものと同じ絵が出る** |
 *
 * **代替されて字が出るのは、その環境に日本語フォントがあるからにすぎない。**
 * 埋め込む理由がまるごと消えるため、この道は採れない。
 *
 * ## 繋ぎ目は 1 つだけ
 *
 * `pdf-lib` 1.17 はサブセットに `encodeStream()` を求めるが、fontkit 2.x が
 * 持っているのは `encode()` である。**その 1 点だけを埋める。**
 */

import type { PDFDocument } from 'pdf-lib';

/** `pdf-lib` が受け取る fontkit の型。**その口だけを名指しする。** */
type PdfLibFontkit = Parameters<PDFDocument['registerFontkit']>[0];

/** `pdf-lib` が読む最小限の流れ（`CustomFontSubsetEmbedder.serializeFont`）。 */
interface ByteStream {
  on(event: 'data', handler: (bytes: Uint8Array) => void): ByteStream;
  on(event: 'end', handler: () => void): ByteStream;
  on(event: 'error', handler: (error: unknown) => void): ByteStream;
}

/**
 * バイト列を 1 度だけ流す。**Node の `stream` は使わない**——ブラウザで動く必要が
 * ある。
 *
 * 流し始めるのを次の周回まで待つのは、`pdf-lib` が `.on('data')` から
 * `.on('error')` まで**繋げて**書くためである。すぐ流すと、`end` を受け取る側が
 * まだ登録されていない。
 */
function streamOf(bytes: Uint8Array): ByteStream {
  const handlers = new Map<string, (value?: never) => void>();

  queueMicrotask(() => {
    (handlers.get('data') as ((bytes: Uint8Array) => void) | undefined)?.(bytes);
    handlers.get('end')?.();
  });

  const stream: ByteStream = {
    on(event: string, handler: (value?: never) => void): ByteStream {
      handlers.set(event, handler);
      return stream;
    },
  } as ByteStream;

  return stream;
}

/** fontkit 2.x が返すサブセット（使うところだけ）。 */
interface Subset {
  encode(): Uint8Array;
  encodeStream?: () => ByteStream;
}

interface FontkitFont {
  createSubset(): Subset;
}

interface Fontkit2 {
  create(bytes: Uint8Array, postscriptName?: string): FontkitFont;
}

/**
 * `pdf-lib` に渡せる形の fontkit を作る。
 *
 * @param fontkit `fontkit` 2.x の名前空間
 */
export function toPdfLibFontkit(fontkit: Fontkit2): PdfLibFontkit {
  const adapter = {
    create(bytes: Uint8Array, postscriptName?: string): FontkitFont {
      const font = fontkit.create(bytes, postscriptName);
      const createSubset = font.createSubset.bind(font);

      font.createSubset = (): Subset => {
        const subset = createSubset();
        subset.encodeStream = (): ByteStream => streamOf(subset.encode());
        return subset;
      };

      return font;
    },
  };

  // ここで満たしているのは `pdf-lib` が実際に呼ぶ部分だけである。
  return adapter as unknown as PdfLibFontkit;
}
