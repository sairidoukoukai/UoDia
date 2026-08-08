/**
 * 箱ダイヤの座標系（仕様書 v2 §5.5.2、T-79）。**純関数のみ。**
 *
 * ## ダイヤグラムと軸が入れ替わっている
 *
 * | | ダイヤグラム | 箱ダイヤ |
 * | --- | --- | --- |
 * | 横 | 時刻 | **停留所**（`axisPosition`） |
 * | 縦 | 停留所 | **便の順序**（時刻ではない） |
 *
 * **縦は時間ではない。** 折返しが長い便ほど深く下ろす、ということはしない
 * （§5.5.2）。段は 1 便につき 1 つであり、間隔はどこでも同じである。
 *
 * そう決めた結果が 2 つある。
 *
 * 1. **図の高さが便の数だけで決まる。** 運用を並べたときに段が揃い、何便の
 *    運用かを高さで比べられる
 * 2. **休憩の長さは形に出ない。** 30 分の折返しと 3 時間の待機が同じ間隔になる
 *    ——これは時刻を字で添えて補う
 */

import type { BlockChartScene } from './scene';

export interface BlockChartViewport {
  /** 描画領域の左端（運用番号を出す欄の幅）。 */
  readonly originX: number;
  /** 描画領域の上端（停留所名を出す帯の高さ）。 */
  readonly originY: number;
  /** 左端が指す `axisPosition`。**一番左の停留所。** */
  readonly startAxis: number;
  /** `axisPosition` 1 単位あたりの px。**横方向である。** */
  readonly pxPerAxisUnit: number;
  /** 1 段の高さ（px）。**どこでも同じ。** */
  readonly rowHeight: number;
  /** 運用と運用のあいだに空ける段数（見分けるための隙間）。 */
  readonly blockGapRows: number;
  readonly width: number;
  readonly height: number;
}

/** 運用番号を出す欄の幅。 */
export const BLOCK_LABEL_WIDTH = 56;
/** 停留所名を出す帯の高さ。 */
export const STOP_LABEL_HEIGHT = 24;
/**
 * 図の左右に空ける余白（px）。
 *
 * 端の停留所線に棒の端が張り付くと、**添える時刻が紙からはみ出す。** 幅は
 * 添えるもので決まる——`12:40` を 11px で置くと約 34px であり、間合いを足して
 * 48px とする。**余白を先に決めて字を切るのではなく、字から余白を決める。**
 */
export const CHART_EDGE_MARGIN = 48;
/** 運用と運用のあいだ。**1 段ぶん空ける。** */
export const BLOCK_GAP_ROWS = 1;

/** 停留所（`axisPosition`）→ x 座標。 */
export function axisToX(axisPosition: number, viewport: BlockChartViewport): number {
  return (
    viewport.originX +
    CHART_EDGE_MARGIN +
    (axisPosition - viewport.startAxis) * viewport.pxPerAxisUnit
  );
}

/**
 * 段 → y 座標。**段の中心を返す。**
 *
 * @param row 図全体を通した段の番号（0 から数える）
 */
export function rowToY(row: number, viewport: BlockChartViewport): number {
  return viewport.originY + (row + 0.5) * viewport.rowHeight;
}

/**
 * 運用ごとの、図全体を通した先頭の段の番号。
 *
 * 運用のあいだに {@link BlockChartViewport.blockGapRows} ぶんの隙間を挟む。
 */
export function blockRowOffsets(
  scene: BlockChartScene,
  viewport: BlockChartViewport,
): readonly number[] {
  const offsets: number[] = [];
  let row = 0;

  for (const block of scene.blocks) {
    offsets.push(row);
    row += block.bars.length + viewport.blockGapRows;
  }

  return offsets;
}

/**
 * 図の高さ（px）。**描く前に分かる**（§5.5.6）。
 *
 * 段の間隔が一定であるため、**便の数を数えるだけで求まる。** 折返しの長さに
 * 比例させていたら、収まるかどうかが中身次第になり、改ページを避けられなかった。
 */
export function chartHeight(scene: BlockChartScene, viewport: BlockChartViewport): number {
  const rows = scene.blocks.reduce((total, block) => total + block.bars.length, 0);
  // 隙間は運用と運用のあいだにだけ入る（最後の運用の下には要らない）。
  const gaps = Math.max(0, scene.blocks.length - 1) * viewport.blockGapRows;

  return viewport.originY + (rows + gaps) * viewport.rowHeight;
}

export interface BlockChartFitOptions {
  readonly width: number;
  readonly height: number;
  /**
   * 段の高さの下限（px）。**これ以上は縮めない**（§5.5.6 の受入条件）。
   *
   * 字が読める大きさを保つ。**収まらないなら、収まらないまま描く**——読めない
   * 絵を出すより、はみ出していることが見えるほうがよい。
   */
  readonly minRowHeight?: number;
  /** 段の高さの上限。**運用が少ないときに間延びさせない。** */
  readonly maxRowHeight?: number;
}

/**
 * 段の高さの既定の下限・上限（px）。
 *
 * **紙 1 枚に載る図であり、画面の表ではない。** 上限を画面並みに詰めると、
 * 13 段の図が A4 の上 3 割に固まって残りが白紙になる。下限は字が読める大きさで
 * 決まる（時刻は 11px）。
 */
export const MIN_ROW_HEIGHT = 14;
export const MAX_ROW_HEIGHT = 64;

/**
 * 紙に収まる視野を組み立てる（§5.5.6）。
 *
 * **入れるものが先にあって、段の高さが決まる。** ダイヤグラムの書き出しと同じ
 * 考え方である（`features/export/diagramExport.ts`）。
 */
export function fitBlockChart(
  scene: BlockChartScene,
  options: BlockChartFitOptions,
): BlockChartViewport {
  const minRowHeight = options.minRowHeight ?? MIN_ROW_HEIGHT;
  const maxRowHeight = options.maxRowHeight ?? MAX_ROW_HEIGHT;

  const rows = scene.blocks.reduce((total, block) => total + block.bars.length, 0);
  const gaps = Math.max(0, scene.blocks.length - 1) * BLOCK_GAP_ROWS;
  const units = rows + gaps;

  const available = options.height - STOP_LABEL_HEIGHT;
  const rowHeight =
    units === 0 ? maxRowHeight : Math.min(maxRowHeight, Math.max(minRowHeight, available / units));

  const positions = scene.stops.map((stop) => stop.axisPosition);
  const startAxis = positions.length === 0 ? 0 : Math.min(...positions);
  const span = positions.length === 0 ? 0 : Math.max(...positions) - startAxis;
  const plotWidth = options.width - BLOCK_LABEL_WIDTH - CHART_EDGE_MARGIN * 2;

  return {
    originX: BLOCK_LABEL_WIDTH,
    originY: STOP_LABEL_HEIGHT,
    startAxis,
    pxPerAxisUnit: span > 0 ? plotWidth / span : 1,
    rowHeight,
    blockGapRows: BLOCK_GAP_ROWS,
    width: options.width,
    height: options.height,
  };
}
