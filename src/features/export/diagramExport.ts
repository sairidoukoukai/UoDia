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
 * drawDiagram(exportCtx, diagramExportScene(state), exportViewport(…)); // 書き出し
 * ```
 *
 * ## 画面と違えるのは 3 つだけ
 *
 * | | 画面 | 書き出し |
 * | --- | --- | --- |
 * | 配色 | テーマに従う | **明るいほうで固定**（紙に黒地は刷らない） |
 * | 視野 | 送りと拡大率 | **全便が入る範囲**（どこまで送っていたかは関係が無い） |
 * | 選択 | 光る | **落とす**（どの便を選んでいたかは配る絵に関係が無い） |
 *
 * **表示設定は画面のものをそのまま使う**（色・線種・フィルタ）。見えているものが
 * 出る——隠した便は出ない。
 */

import {
  AXIS_EDGE_MARGIN,
  AXIS_LABEL_WIDTH,
  DIAGRAM_END_TIME,
  DIAGRAM_START_TIME,
  LIGHT_THEME,
  TIME_LABEL_HEIGHT,
  selectDiagramScene,
  type DiagramScene,
  type Viewport,
} from '@/features/diagram';
import { SECONDS_PER_MINUTE } from '@/domain/time';
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
 * 描かれる時刻の範囲。
 *
 * **描ける範囲（7:00〜22:00）に収める。** `drawTrips` はそこで切り落としており
 * （`plotXRange`）、外へ広げても白い帯が伸びるだけである。**画面と同じ絵が出る**
 * ——画面に出ていない便は、書き出しても出ない。
 *
 * @returns 便が 1 つも無ければ表示範囲そのもの
 */
export function drawnTimeRange(scene: DiagramScene): {
  readonly from: number;
  readonly to: number;
} {
  let from = Number.POSITIVE_INFINITY;
  let to = Number.NEGATIVE_INFINITY;

  for (const trip of scene.trips) {
    for (const point of trip.points) {
      if (point.time < from) from = point.time;
      if (point.time > to) to = point.time;
    }
  }

  if (from > to) return { from: DIAGRAM_START_TIME, to: DIAGRAM_END_TIME };

  return {
    from: Math.max(DIAGRAM_START_TIME, roundDownToHour(from)),
    to: Math.min(DIAGRAM_END_TIME, roundUpToHour(to)),
  };
}

/** 1 時間（秒）。 */
const HOUR = 60 * SECONDS_PER_MINUTE;

function roundDownToHour(time: number): number {
  return Math.floor(time / HOUR) * HOUR;
}

function roundUpToHour(time: number): number {
  return Math.ceil(time / HOUR) * HOUR;
}

/**
 * 書き出す視野を組み立てる。
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
 */
export function exportViewport(scene: DiagramScene, page: ExportPage): Viewport {
  const time = drawnTimeRange(scene);

  const positions = scene.stops.map((stop) => stop.axisPosition);
  const startAxis = positions.length === 0 ? 0 : Math.min(...positions);
  const endAxis = positions.length === 0 ? 0 : Math.max(...positions);

  // 横は縦軸の欄の右から紙の端まで、縦は目盛の帯の下から紙の端まで使う。
  // 縦は上下に `AXIS_EDGE_MARGIN` を空ける（`axisToY` が上側を足しており、
  // 下側は端の停留所線に積まれるものが切れないために要る）。
  const plotWidth = page.width - AXIS_LABEL_WIDTH;
  const plotHeight = page.height - TIME_LABEL_HEIGHT - AXIS_EDGE_MARGIN * 2;

  const minutes = (time.to - time.from) / SECONDS_PER_MINUTE;
  const axisSpan = endAxis - startAxis;

  return {
    startTime: time.from,
    startAxis,
    // **0 で割らない。** 便が 1 つしか無くても、停留所が 1 つしか無くても、
    // 絵は出さなければならない。
    pxPerMinute: minutes > 0 ? plotWidth / minutes : 1,
    pxPerAxisUnit: axisSpan > 0 ? plotHeight / axisSpan : 1,
    originX: AXIS_LABEL_WIDTH,
    originY: TIME_LABEL_HEIGHT,
    width: page.width,
    height: page.height,
  };
}
