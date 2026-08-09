/*
 * `fontkitAdapter` はここから出さない。**動的 import の中だけで使う**もので
 * あり、ここで静的に繋ぐと Vite が別のチャンクへ動かせなくなる
 * （`pdfDocument.ts`）。
 */

export { PdfDrawContext, fontSizeOf, toRgb, type PdfDrawContextOptions } from './PdfDrawContext';

export {
  A4_LANDSCAPE_PT,
  createPdfBuilder,
  type PdfBuilder,
  type PdfBuilderOptions,
} from './pdfDocument';
