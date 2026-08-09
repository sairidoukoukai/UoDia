/**
 * PDF を組み立てる器（仕様書 v2 §5.4.2、T-77）。
 *
 * ## 書き出しが押されるまで何も読まない
 *
 * `pdf-lib`（206KB）・`fontkit`・Noto Sans JP（4.5MB）を**動的 import の中に
 * 閉じ込めてある。** Vite が別のチャンクに切るため、**初回ロードには 1 バイトも
 * 乗らない。**
 *
 * 仕様書 §9.1 の 1MB は**初回ロード**の話である。書き出しを押すまで読まない
 * ものは、そこに入らない。一度読めばブラウザが持つため、2 回目以降の書き出しでは
 * 落ちてこない。
 *
 * ## 紙の大きさ
 *
 * A4。**向きは求められた座標系から決める**（T-87）——ダイヤグラムは横、箱ダイヤは
 * 縦である。**描くときの座標は CSS px のまま**であり、紙に合わせる倍率は
 * `PdfDrawContext` が積む。
 */

import type { PDFDocument, PDFFont, PDFPage } from 'pdf-lib';
import type { PlatformAdapter } from '@/platform';
import { PdfDrawContext } from './PdfDrawContext';

/** A4 横（pt）。1pt = 1/72 インチ。 */
export const A4_LANDSCAPE_PT = Object.freeze({ width: 841.89, height: 595.28 });

/** A4 縦（pt）。**箱ダイヤが使う**（T-87）。 */
export const A4_PORTRAIT_PT = Object.freeze({ width: 595.28, height: 841.89 });

/**
 * 求められた座標系に合う紙の向き。
 *
 * **向きを引数で受け取らない。** 座標系が縦長なら紙も縦であり、**2 つが食い違う
 * 状態を作れないようにする**——食い違えば、`PdfDrawContext` が縮めて片側に
 * 余白を作るだけで、誰も気づかない。
 */
export function a4For(width: number, height: number): { width: number; height: number } {
  return height > width ? A4_PORTRAIT_PT : A4_LANDSCAPE_PT;
}

/** 組み立て中の PDF。 */
export interface PdfBuilder {
  /**
   * 1 ページ足し、その上に描く器を返す。
   *
   * @param width 描くときの座標系の幅（CSS px）
   */
  addPage(width: number, height: number): { page: PDFPage; ctx: PdfDrawContext };
  /** 出来上がったバイト列。 */
  save(): Promise<Uint8Array>;
}

export interface PdfBuilderOptions {
  /** フォントを読む口。**書き出しのときだけ呼ばれる。** */
  readonly platform: Pick<PlatformAdapter, 'loadExportFont'>;
  /** 文書の題名（PDF の情報欄に入る）。 */
  readonly title?: string;
}

/**
 * PDF の組み立てを始める。
 *
 * **ここで初めて `pdf-lib` とフォントが落ちてくる。**
 */
export async function createPdfBuilder(options: PdfBuilderOptions): Promise<PdfBuilder> {
  const [{ PDFDocument }, fontkit, { toPdfLibFontkit }, fontBytes] = await Promise.all([
    import('pdf-lib'),
    import('fontkit'),
    import('./fontkitAdapter'),
    options.platform.loadExportFont(),
  ]);

  const doc: PDFDocument = await PDFDocument.create();
  doc.registerFontkit(toPdfLibFontkit(fontkit));
  if (options.title !== undefined) doc.setTitle(options.title);
  doc.setCreator('UoDia');

  // **使った字だけを埋める。** 停留所名・便番号・運用番号を合わせても数百字で
  // あり、PDF に入るフォントは数十 KB に収まる（仕様書 v2 §5.4.2）。
  const font: PDFFont = await doc.embedFont(fontBytes, { subset: true });

  return {
    addPage(width: number, height: number) {
      const paper = a4For(width, height);
      const page = doc.addPage([paper.width, paper.height]);
      return { page, ctx: new PdfDrawContext({ page, font, width, height }) };
    },

    async save(): Promise<Uint8Array> {
      return doc.save();
    },
  };
}
