/**
 * 箱ダイヤを PDF にする（仕様書 v2 §5.5.6、#194・#220、T-80・T-87）。
 *
 * ## 1 マスに 1 運用
 *
 * **全運用を 1 枚に収める形（T-80）は取り消した**（#220）。運用が増えるほど段が
 * 詰まり、**1 台ぶんの形が読めなくなる。** 箱ダイヤは車の動きを追う図であり、
 * 追えなくなったらそれは箱ダイヤではない。
 *
 * A4 縦を **3 行 2 列**に割り、1 マスに 1 運用ずつ描く（`blockChartCells`）。
 *
 * ## 改ページしてよい
 *
 * 7 つめの運用からはページを足す。**何ページになるかは描く前に分かる**——運用の
 * 数を 6 で割るだけである。**段の間隔を一定にした判断（§5.5.2）はここでも
 * 効いている。**
 *
 * ## 配色は明るいほうで固定
 *
 * ダイヤグラムと同じである（§5.4.1）。紙に黒地は刷らない。
 */

import { LIGHT_THEME } from '@/features/diagram';
import { blockChartCells, drawBlockChart, selectBlockChartScene } from '@/features/blockchart';
import type { PlatformAdapter } from '@/platform';
import type { ExportProducer, ExportSource } from './artifacts';
import { A4_PORTRAIT_300DPI, type ExportPage } from './diagramExport';

/** 一斉出力の中でのファイル名（仕様書 v2 §5.3）。 */
export const BLOCK_CHART_PDF_NAME = '箱ダイヤ.pdf';

export interface BlockChartPdfOptions {
  readonly page?: ExportPage;
}

/** 箱ダイヤを描いた PDF のバイト列を作る。**A4 縦・3 行 2 列。** */
export async function renderBlockChartPdf(
  source: ExportSource,
  platform: Pick<PlatformAdapter, 'loadExportFont'>,
  options: BlockChartPdfOptions = {},
): Promise<Uint8Array> {
  const page = options.page ?? A4_PORTRAIT_300DPI;

  const { createPdfBuilder } = await import('./pdf');
  const builder = await createPdfBuilder({ platform, title: source.project.document.name });

  const scene = selectBlockChartScene(source.state, LIGHT_THEME);

  for (const cells of blockChartCells(scene, page)) {
    const { ctx } = builder.addPage(page.width, page.height);
    // **空きマスには何も描かない**（§5.5.6）。`cells` にそもそも入っていない。
    for (const cell of cells) {
      drawBlockChart(ctx, cell.scene, cell.viewport);
    }
    // 積んだ変換を降ろす。降ろさないと、次に足したページが前の変換を引き継ぐ。
    ctx.finish();
  }

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
