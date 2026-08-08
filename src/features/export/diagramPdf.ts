/**
 * ダイヤグラムを PDF にする（仕様書 v2 §5.4.2、#192、T-78）。
 *
 * ## PNG と同じところから出る
 *
 * 場面も視野も PNG と同じ関数から取る（`diagramExport.ts`）。**違うのは器だけ
 * である。**
 *
 * ```ts
 * drawDiagram(canvasCtx, scene, viewport);   // ダイヤグラム.png
 * drawDiagram(pdfCtx,    scene, viewport);   // ダイヤグラム.pdf
 * ```
 *
 * **片方だけを直して見た目がずれることが、構造上起きない。**
 *
 * ## 重いものは押されてから読む
 *
 * `pdf-lib` もフォントも、この `build` が呼ばれて初めて落ちてくる
 * （`pdf/pdfDocument.ts`）。**初回ロードには乗らない。**
 */

import { drawDiagram } from '@/features/diagram';
import type { PlatformAdapter } from '@/platform';
import type { ExportProducer, ExportSource } from './artifacts';
import {
  A4_LANDSCAPE_300DPI,
  diagramExportScene,
  exportViewport,
  type ExportPage,
} from './diagramExport';

/** 一斉出力の中でのファイル名（仕様書 v2 §5.3）。 */
export const DIAGRAM_PDF_NAME = 'ダイヤグラム.pdf';

export interface DiagramPdfOptions {
  readonly page?: ExportPage;
}

/** ダイヤグラムを描いた PDF のバイト列を作る。**A4 横 1 ページ。** */
export async function renderDiagramPdf(
  source: ExportSource,
  platform: Pick<PlatformAdapter, 'loadExportFont'>,
  options: DiagramPdfOptions = {},
): Promise<Uint8Array> {
  const page = options.page ?? A4_LANDSCAPE_300DPI;

  const { createPdfBuilder } = await import('./pdf');
  const builder = await createPdfBuilder({ platform, title: source.project.document.name });

  const { ctx } = builder.addPage(page.width, page.height);
  const scene = diagramExportScene(source.state);
  drawDiagram(ctx, scene, exportViewport(scene, page));
  // 積んだ変換を降ろす。降ろさないと、次に足したページが前の変換を引き継ぐ。
  ctx.finish();

  return builder.save();
}

/** 一斉出力に入るダイヤグラム PDF。 */
export function diagramPdfProducer(
  platform: Pick<PlatformAdapter, 'loadExportFont'>,
): ExportProducer {
  return {
    label: 'ダイヤグラム（PDF）',
    fileName: DIAGRAM_PDF_NAME,
    build: (source) => renderDiagramPdf(source, platform),
  };
}
