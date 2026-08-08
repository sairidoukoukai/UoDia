/**
 * 箱ダイヤを PDF にする（仕様書 v2 §5.5.6、#194、T-80）。
 *
 * ## 1 枚だけ出す
 *
 * **運用ごとの出力（#193）は廃止した。** 全運用を 1 ページに収める。
 *
 * 箱ダイヤは車の動きを追う図であり、**追うべき車は 5 台ほどしかない。** 1 枚に
 * 並べて見比べられるなら、**1 台ずつ切り出したものは同じ情報を 5 回配るだけに
 * なる。**
 *
 * ## 改ページを持たない
 *
 * 段が何段になっても 1 ページに収まるよう縮める（`fitBlockChart`）。**段の間隔を
 * 一定にした判断が、ここで効く**——図の高さは便の数だけで決まるため、**収まるか
 * どうかを描く前に計算できる。** 折返しの長さに比例させていたら、収まるかどうかが
 * 中身次第になり、改ページを避けられなかった。
 *
 * ## 配色は明るいほうで固定
 *
 * ダイヤグラムと同じである（§5.4.1）。紙に黒地は刷らない。
 */

import { LIGHT_THEME } from '@/features/diagram';
import { drawBlockChart, fitBlockChart, selectBlockChartScene } from '@/features/blockchart';
import type { PlatformAdapter } from '@/platform';
import type { ExportProducer, ExportSource } from './artifacts';
import { A4_LANDSCAPE_300DPI, type ExportPage } from './diagramExport';

/** 一斉出力の中でのファイル名（仕様書 v2 §5.3）。 */
export const BLOCK_CHART_PDF_NAME = '箱ダイヤ.pdf';

export interface BlockChartPdfOptions {
  readonly page?: ExportPage;
}

/** 箱ダイヤを描いた PDF のバイト列を作る。**A4 横 1 ページ。** */
export async function renderBlockChartPdf(
  source: ExportSource,
  platform: Pick<PlatformAdapter, 'loadExportFont'>,
  options: BlockChartPdfOptions = {},
): Promise<Uint8Array> {
  const page = options.page ?? A4_LANDSCAPE_300DPI;

  const { createPdfBuilder } = await import('./pdf');
  const builder = await createPdfBuilder({ platform, title: source.project.document.name });

  const { ctx } = builder.addPage(page.width, page.height);
  const scene = selectBlockChartScene(source.state, LIGHT_THEME);
  drawBlockChart(ctx, scene, fitBlockChart(scene, page));
  ctx.finish();

  return builder.save();
}

/** 一斉出力に入る箱ダイヤ PDF。 */
export function blockChartPdfProducer(
  platform: Pick<PlatformAdapter, 'loadExportFont'>,
): ExportProducer {
  return {
    label: '箱ダイヤ',
    fileName: BLOCK_CHART_PDF_NAME,
    build: (source) => renderBlockChartPdf(source, platform),
  };
}
