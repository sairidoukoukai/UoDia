/**
 * ダイヤグラムを PNG にする（仕様書 v2 §5.4.1、#192、T-75）。
 *
 * ## ここにあるのは器だけである
 *
 * 何をどう描くかは `diagramExport.ts` が決め、実際に描くのは `drawDiagram` で
 * ある。**このファイルが持つのは canvas を用意して PNG に固める手順**——
 * jsdom に 2D コンテキストが無く、単体テストでは通せない部分に限る。
 *
 * `canvasHost.ts` が画面に対してしているのと同じ形にしてある（大きさと倍率を
 * 合わせ、`ctx` に変換を掛け、CSS px で描く）。
 */

import { drawDiagram } from '@/features/diagram';
import type { ExportProducer, ExportSource } from './artifacts';
import {
  A4_LANDSCAPE_300DPI,
  diagramExportScene,
  exportBands,
  pixelSize,
  type ExportPage,
} from './diagramExport';

/** 一斉出力の中でのファイル名（仕様書 v2 §5.3）。 */
export const DIAGRAM_PNG_NAME = 'ダイヤグラム.png';

export interface DiagramPngOptions {
  readonly page?: ExportPage;
  /**
   * 描き先の canvas を作る。既定は `document.createElement('canvas')`。
   *
   * **差し替えられるようにしてあるのは、この 1 行だけが環境に縛られている**
   * ためである。
   */
  readonly createCanvas?: (width: number, height: number) => HTMLCanvasElement;
}

/** ダイヤグラムを描いた PNG のバイト列を作る。 */
export async function renderDiagramPng(
  source: ExportSource,
  options: DiagramPngOptions = {},
): Promise<Uint8Array> {
  const page = options.page ?? A4_LANDSCAPE_300DPI;
  const size = pixelSize(page);
  const canvas = (options.createCanvas ?? createCanvas)(size.width, size.height);

  const ctx = canvas.getContext('2d');
  if (ctx === null) throw new Error('この環境では絵を描けません');

  // **CSS px で描けるようにする。** 掛けないと、字の大きさも線の太さも
  // 画面用の値のまま 3508px の紙に置かれ、絵だけが大きくなる。
  ctx.setTransform(page.scale, 0, 0, page.scale, 0, 0);
  const scene = diagramExportScene(source.state);
  // **段の数だけ呼ぶ**（T-86）。描画関数は変えていない——視野が 3 つになった
  // だけである。段はそれぞれ自分の帯だけを塗るため、順に描いても消し合わない。
  for (const band of exportBands(scene, page)) {
    drawDiagram(ctx, scene, band.viewport);
  }

  return toPngBytes(canvas);
}

/** 一斉出力に入るダイヤグラム PNG。 */
export const diagramPngProducer: ExportProducer = {
  label: 'ダイヤグラム',
  fileName: DIAGRAM_PNG_NAME,
  build: (source) => renderDiagramPng(source),
};

function createCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

/**
 * canvas を PNG のバイト列にする。
 *
 * `toBlob` を使う。`toDataURL` は base64 の文字列を経由するぶんだけ、3508 ×
 * 2480 の絵では余計な写しが 1 つ増える。
 */
async function toPngBytes(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, 'image/png');
  });
  if (blob === null) throw new Error('PNG に固められません');

  return new Uint8Array(await blob.arrayBuffer());
}
