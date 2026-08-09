/**
 * 書き出すダイヤグラムの場面と視野（仕様書 v2 §5.4.1、T-75）。**DOM に触らない。**
 *
 * ## 新しい描画コードを書かない
 *
 * `drawDiagram` は `(ctx, scene, viewport)` の 3 引数で完結している（実装計画書
 * §3.5）。**書くのは引数だけである。**
 *
 * ```ts
 * drawDiagram(screenCtx, scene, viewportOf(view, width, height));       // 画面
 * drawDiagram(exportCtx, diagramExportScene(state), band.viewport);     // 書き出し
 * ```
 *
 * ## 画面と違えるのは 3 つだけ
 *
 * | | 画面 | 書き出し |
 * | --- | --- | --- |
 * | 配色 | テーマに従う | **明るいほうで固定**（紙に黒地は刷らない） |
 * | 視野 | 送りと拡大率 | **固定の 3 段**（どこまで送っていたかは関係が無い） |
 * | 選択 | 光る | **落とす**（どの便を選んでいたかは配る絵に関係が無い） |
 *
 * **表示設定は画面のものをそのまま使う**（色・線種・フィルタ）。見えているものが
 * 出る——隠した便は出ない。
 */

import {
  AXIS_EDGE_MARGIN,
  AXIS_LABEL_WIDTH,
  LIGHT_THEME,
  TIME_LABEL_HEIGHT,
  selectDiagramScene,
  type DiagramScene,
  type Viewport,
} from '@/features/diagram';
import { fromHM, SECONDS_PER_MINUTE } from '@/domain/time';
import type { AppState } from '@/store';

/**
 * 書き出す絵の大きさ（仕様書 v2 §5.4.1）。
 *
 * **A4 横 300dpi 相当**（3508 × 2480px）。紙に載せることを前提とする。
 *
 * ## 論理の大きさと倍率に分けてある
 *
 * 描画側の字の大きさも線の太さも余白も、**すべて CSS px で書かれている**
 * （縦軸の欄は 56px、目盛の帯は 24px、字は 12px）。3508px の canvas に等倍で
 * 描くと、**絵だけが大きくなって字が芥子粒になる。**
 *
 * 画面が画素密度に対してしていることと同じである（`paintDiagram`）——`ctx` に
 * 倍率を掛け、座標は CSS px のまま渡す。1754 × 1240 は A4 横の 150dpi 相当で
 * あり、それを 2 倍して 300dpi に届かせる。
 */
export interface ExportPage {
  /** 描くときの座標系の幅（CSS px）。 */
  readonly width: number;
  readonly height: number;
  /** 実際の画素にするときの倍率。 */
  readonly scale: number;
}

/** A4 横 300dpi 相当（3508 × 2480px）。 */
export const A4_LANDSCAPE_300DPI: ExportPage = Object.freeze({
  width: 1754,
  height: 1240,
  scale: 2,
});

/** 実際の画素の大きさ。 */
export function pixelSize(page: ExportPage): { readonly width: number; readonly height: number } {
  return { width: page.width * page.scale, height: page.height * page.scale };
}

/**
 * 書き出す場面を組み立てる。
 *
 * **選択と引きずりを落とす。** どの便を選んでいたか、いま何を掴んでいるかは、
 * 配る絵に関係が無い。落とさないと、**選んだまま書き出した人にだけ違う絵が出る。**
 *
 * 配色は {@link LIGHT_THEME} で固定する（§5.4.1）。**画面が暗い配色でも、紙に
 * 黒地は刷らない。**
 */
export function diagramExportScene(state: AppState): DiagramScene {
  return selectDiagramScene(withoutSelection(state), LIGHT_THEME);
}

const NO_SELECTION: readonly string[] = [];

/** 選択と引きずりを落とした状態。 */
function withoutSelection(state: AppState): AppState {
  const { ui } = state;
  if (ui.selectedTripIds.length === 0 && ui.selectionRect === null && ui.tripShift === null) {
    // **触らずに返す。** 別の物を作ると場面の記憶化（`memoizeByIdentity`）が
    // 毎回外れる。
    return state;
  }
  return {
    ...state,
    ui: { ...ui, selectedTripIds: NO_SELECTION, selectionRect: null, tripShift: null },
  };
}

/**
 * 段の時間帯（仕様書 v2 §5.4.1、#219、T-86）。**固定である。**
 *
 * ## なぜ全便が入る範囲をやめたのか
 *
 * 15 時間を紙の幅（1698px）に詰めると **1 分が約 1.9px** になる。A4 横に刷ると
 * **5 分の折返しが 0.5mm** であり、**線が縦に見える。** 折返しの長さはダイヤを
 * 読むときに数える値であって、潰してよい部分ではない。
 *
 * 3 段に割れば 1 分が約 4.7px になる。**同じ紙で 2.5 倍**である。
 *
 * ## なぜ便に合わせないのか
 *
 * 段の境目が**日によって動かない**ようにするためである。合わせると、朝の便を
 * 1 本足しただけで 3 段すべての時間帯がずれ、**前に配った紙と見比べられない。**
 *
 * ## 1 時間ずつ重ねる
 *
 * 境目をまたぐ便が、**どちらの段でも端で切れて終わる**ことを避ける。12:00 の便は
 * 1 段目の終わりにも 2 段目の始まりにも出る。
 *
 * ## 22:00 以降は白紙になる
 *
 * 3 段目は 23:00 までだが、描ける範囲は 22:00 までである（`DIAGRAM_END_TIME`）。
 * `plotXRange` がそこで切り落とすため、**右端の 1 時間は線も字も出ない。**
 * 範囲を広げないのは、**画面に出ない時間帯を紙にだけ出さない**ためである。
 */
export const EXPORT_BAND_RANGES: readonly { readonly from: number; readonly to: number }[] =
  Object.freeze([
    { from: fromHM(7, 0), to: fromHM(13, 0) },
    { from: fromHM(12, 0), to: fromHM(18, 0) },
    { from: fromHM(17, 0), to: fromHM(23, 0) },
  ]);

/** 1 段ぶん。 */
export interface ExportBand {
  /** 段の左端が指す時刻（秒）。 */
  readonly from: number;
  /** 段の右端が指す時刻（秒）。 */
  readonly to: number;
  /** その段に描くための視野。 */
  readonly viewport: Viewport;
}

/**
 * 書き出す段を組み立てる。
 *
 * **紙の大きさに合わせて拡大率を決める。** 画面は拡大率が先にあって見える範囲が
 * 決まるが、書き出しは**入れるものが先にあって拡大率が決まる。**
 *
 * ```
 * 画面   : 拡大率 → 見える範囲
 * 書き出し: 入れるもの → 拡大率
 * ```
 *
 * **送りの位置は見ない**（受入条件）。書き出したものを見る人に「画面をどこまで
 * スクロールしていたか」は関係が無い。
 *
 * **段は紙を 3 等分する。** 便の多い時間帯を広く取ることはしない——段ごとに縦の
 * 縮尺が変わると、**同じ傾きが同じ速さを表さなくなる。**
 *
 * **便が 1 本も無い段も出す。** 時間帯が固定である以上、出さないと段の数が日に
 * よって変わり、紙の形が揃わない。
 */
export function exportBands(scene: DiagramScene, page: ExportPage): readonly ExportBand[] {
  const axis = axisRange(scene);
  const bandHeight = page.height / EXPORT_BAND_RANGES.length;

  // 横は縦軸の欄の右から紙の端まで使う。
  const plotWidth = page.width - AXIS_LABEL_WIDTH;
  // 縦は段の中の、目盛の帯の下から段の地まで。上下に `AXIS_EDGE_MARGIN` を
  // 空ける（`axisToY` が上側を足しており、下側は端の停留所線に積まれるものが
  // 切れないために要る）。
  const plotHeight = bandHeight - TIME_LABEL_HEIGHT - AXIS_EDGE_MARGIN * 2;

  return EXPORT_BAND_RANGES.map((range, index) => {
    const top = index * bandHeight;
    const minutes = (range.to - range.from) / SECONDS_PER_MINUTE;

    return {
      from: range.from,
      to: range.to,
      viewport: {
        startTime: range.from,
        startAxis: axis.start,
        // **0 で割らない。** 便が 1 つしか無くても、停留所が 1 つしか無くても、
        // 絵は出さなければならない。
        pxPerMinute: minutes > 0 ? plotWidth / minutes : 1,
        pxPerAxisUnit: axis.span > 0 ? plotHeight / axis.span : 1,
        originX: AXIS_LABEL_WIDTH,
        originY: top + TIME_LABEL_HEIGHT,
        top,
        width: page.width,
        height: top + bandHeight,
      },
    };
  });
}

/**
 * 縦軸に入れる軸位置の範囲。
 *
 * **全段で同じ値を使う。** 段ごとに走っている停留所だけへ詰めると、段をまたいで
 * 同じ停留所が違う高さに来る——**縦に並べた意味が消える。**
 */
function axisRange(scene: DiagramScene): { readonly start: number; readonly span: number } {
  const positions = scene.stops.map((stop) => stop.axisPosition);
  if (positions.length === 0) return { start: 0, span: 0 };

  const start = Math.min(...positions);
  return { start, span: Math.max(...positions) - start };
}
