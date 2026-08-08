/**
 * 一斉出力に入るもの（仕様書 v2 §5.2）。
 *
 * **並びがそのまま作る順であり、進み具合に出る順である**（§5.9）。
 *
 * ## なぜ定数ではなく関数か
 *
 * PDF はフォントを要り、フォントを読めるのは `PlatformAdapter` だけである
 * （`src/features/` から `fetch` は呼べない）。**器を渡してから表が決まる。**
 */

import type { PlatformAdapter } from '@/platform';
import type { ExportProducer } from './artifacts';
import { diagramPdfProducer } from './diagramPdf';
import { diagramPngProducer } from './diagramPng';
import { timetableCsvProducer } from './timetableCsv';

/**
 * 一斉出力に入るもの。
 *
 * | 入っているか | 中身 | 足す先 |
 * | --- | --- | --- |
 * | ○ | ダイヤグラム.png | T-75 |
 * | ○ | ダイヤグラム.pdf | T-78 |
 * | ○ | 時刻表_豊中方面.csv・時刻表_吹田方面.csv | T-76 |
 * | | 箱ダイヤ.pdf | T-80 |
 *
 * GTFS は入らない（仕様書 v2 §5.7）。GTFS 画面の書き出しタブから出す。
 *
 * **時刻表は方向の順に並べる**（1 = 豊中方面、0 = 吹田方面）。仕様書 v2 §5.3 の
 * 並びに合わせてある。
 */
export function exportProducers(
  platform: Pick<PlatformAdapter, 'loadExportFont'>,
): readonly ExportProducer[] {
  return [
    diagramPngProducer,
    diagramPdfProducer(platform),
    timetableCsvProducer(1),
    timetableCsvProducer(0),
  ];
}
