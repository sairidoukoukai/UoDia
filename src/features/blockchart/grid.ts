/**
 * 箱ダイヤを格子に割る（仕様書 v2 §5.5.6、#220、T-87）。**純関数のみ。**
 *
 * ## 1 マスに 1 運用
 *
 * v2 は**全運用を 1 ページに収めた 1 枚**としていた。取り消す。
 *
 * 運用が増えるほど段が詰まり、**1 台ぶんの形が読めなくなる。** 箱ダイヤは車の
 * 動きを追う図であり、追えなくなったらそれは箱ダイヤではない。
 *
 * ```
 * ┌──────────┬──────────┐
 * │ 運用 1   │ 運用 2   │   3 行 2 列。1 マスに 1 運用。
 * ├──────────┼──────────┤
 * │ 運用 3   │ 運用 4   │   7 つめからはページを足す。
 * ├──────────┼──────────┤
 * │ 運用 5   │ （空欄） │   空きマスは詰めない。
 * └──────────┴──────────┘
 * ```
 *
 * ## 段の高さは全マスで同じ
 *
 * **最も便の多い運用**から決め、全マスで使う。マスごとに便の数から決めると、
 * 隣と見比べたときに**「便が多いのか、段が広いのか」が読めない。** 揃えておけば、
 * 段の位置がマスをまたいで揃う。
 *
 * ## 何ページになるかは描く前に分かる
 *
 * 運用の数を 6 で割るだけである（§5.5.6）。**段の間隔を一定にした判断
 * （§5.5.2）がここでも効いている**——中身を描いてみるまで分からない、という
 * ことにならない。
 *
 * ## マスへの割り当ては視野で行う
 *
 * `ctx` に平行移動を積まない（実装計画書 v2.1 §3.3）。`DrawContext` の 14
 * メソッドを増やさないためであり、**マスの矩形をそのまま視野に入れれば済む。**
 */

import type { BlockChartScene } from './scene';
import {
  STOP_LABEL_HEIGHT,
  fitBlockChart,
  fitRowHeight,
  type BlockChartViewport,
} from './viewport';

/** 格子の行数。 */
export const GRID_ROWS = 3;
/** 格子の列数。 */
export const GRID_COLUMNS = 2;
/** 1 ページに入るマスの数。 */
export const CELLS_PER_PAGE = GRID_ROWS * GRID_COLUMNS;

/** 紙の大きさ。 */
export interface BlockChartPageSize {
  readonly width: number;
  readonly height: number;
}

/** 格子の 1 マス。 */
export interface BlockChartCell {
  /**
   * そのマスに描くもの。**運用は 1 つだけ入っている。**
   *
   * `drawBlockChart` は渡された場面の運用を全部描く。**1 つに絞った場面を渡す**
   * ことで、描画側に「何番目の運用だけを描け」と伝える必要が無くなる。
   */
  readonly scene: BlockChartScene;
  readonly viewport: BlockChartViewport;
}

/**
 * 何ページになるか。**描く前に分かる。**
 *
 * 運用が 1 つも無くても 1 ページ返す——**白紙でも紙は出す。** 0 ページの PDF は
 * 開けない。
 */
export function blockChartPageCount(scene: BlockChartScene): number {
  return Math.max(1, Math.ceil(scene.blocks.length / CELLS_PER_PAGE));
}

/**
 * ページごとのマスを組み立てる。
 *
 * **空きマスは返さない。** 描くものが無いマスに視野を与えても、`drawBlockChart`
 * が地色を塗るだけである——**空欄のまま**にするという決め（§5.5.6）は、呼ばない
 * ことで守る。
 *
 * @returns ページの配列。各ページはそのページに入るマスの配列
 */
export function blockChartCells(
  scene: BlockChartScene,
  page: BlockChartPageSize,
): readonly (readonly BlockChartCell[])[] {
  const cellWidth = page.width / GRID_COLUMNS;
  const cellHeight = page.height / GRID_ROWS;
  const rowHeight = sharedRowHeight(scene, cellHeight);

  const pages: (readonly BlockChartCell[])[] = [];

  for (let start = 0; start < scene.blocks.length; start += CELLS_PER_PAGE) {
    const blocks = scene.blocks.slice(start, start + CELLS_PER_PAGE);

    pages.push(
      blocks.map((block, index) => {
        const column = index % GRID_COLUMNS;
        const row = Math.floor(index / GRID_COLUMNS);
        const left = column * cellWidth;
        const top = row * cellHeight;

        // **横軸はそのまま渡す。** マスごとに走っている停留所へ詰めると、隣の
        // マスと停留所の位置が食い違い、形を見比べられなくなる。
        const cellScene: BlockChartScene = { ...scene, blocks: [block] };

        return {
          scene: cellScene,
          viewport: fitBlockChart(cellScene, {
            left,
            top,
            width: left + cellWidth,
            height: top + cellHeight,
            rowHeight,
          }),
        };
      }),
    );
  }

  return pages.length === 0 ? [[]] : pages;
}

/**
 * 全マスで使う段の高さ（px）。**最も便の多い運用に合わせる。**
 *
 * その運用がマスに収まる高さを採れば、ほかはすべて収まる。
 */
function sharedRowHeight(scene: BlockChartScene, cellHeight: number): number {
  // マスの中は運用 1 つであり、運用と運用のあいだの隙間は入らない。
  const most = scene.blocks.reduce((max, block) => Math.max(max, block.bars.length), 0);

  return fitRowHeight(most, cellHeight - STOP_LABEL_HEIGHT);
}
