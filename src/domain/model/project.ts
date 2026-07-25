/**
 * プロジェクト（`.uodia` ファイル）のスキーマ。仕様書 §5.6〜§5.10、§7.2。
 *
 * 停留所・区間・パターンの定義は含まない（`route.json` から読む）。
 * 1 便あたりの永続化データは 5 フィールドのみで、100 便でも数十 KB に収まる。
 */

import { z } from 'zod';
import { fromHM } from '@/domain/time';
import { directionIdSchema, idSchema, isoDateTimeSchema, secondsSchema } from './primitives';

/** 現在のファイル形式の版数。破壊的変更のたびに繰り上げる（仕様書 §7.3）。 */
export const CURRENT_FORMAT_VERSION = 1;

/**
 * 基準時刻（仕様書 §5.6）。**便の時刻を決める唯一の入力。**
 *
 * 便の全停留所の時刻はこの 1 点から導出され、永続化されない。利用者が別の
 * 停留所の時刻を設定すると、このアンカーが丸ごと置き換わる。
 */
export const anchorSchema = z.object({
  /** パターンに含まれる停留所であること（T-11 の参照整合性検査で確認）。 */
  stopId: idSchema,
  time: secondsSchema,
});
export type Anchor = z.infer<typeof anchorSchema>;

/** 便（仕様書 §5.6）。停車パターンと基準時刻 1 点のみで完全に決まる。 */
export const tripSchema = z.object({
  /** GTFS `trip_id`。 */
  tripId: idSchema,
  /** 方向・行先・経由地を兼ねる。 */
  patternId: idSchema,
  anchor: anchorSchema,
  /** 運用番号。GTFS `block_id`。空文字は未割当を意味する。 */
  blockId: z.string(),
  /** 便番号。GTFS `trip_short_name`。 */
  tripShortName: z.string(),
  note: z.string().optional(),
});
export type Trip = z.infer<typeof tripSchema>;

/** ダイヤ（仕様書 §5.7）。運行日種別ごとの便の集合。 */
export const serviceSchema = z.object({
  /** GTFS `service_id`。 */
  serviceId: idSchema,
  /** 例: 授業期間平日ダイヤ */
  serviceName: z.string().min(1),
  /** 両方向・営業便・回送便のすべてを含む。 */
  trips: z.array(tripSchema),
});
export type Service = z.infer<typeof serviceSchema>;

/** ファイルのメタ情報（仕様書 §7.2）。 */
export const metaSchema = z.object({
  format: z.literal('uodia'),
  formatVersion: z.number().int().min(1),
  appVersion: z.string(),
  /** 依存する `route.json` の版数。不一致なら読込時に警告する。 */
  routeVersion: z.number().int().min(1),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type Meta = z.infer<typeof metaSchema>;

/** 文書情報。 */
export const documentInfoSchema = z.object({
  name: z.string(),
  author: z.string(),
  comment: z.string(),
});
export type DocumentInfo = z.infer<typeof documentInfoSchema>;

/** ダイヤグラムのスジの着色方法（仕様書 §6.2.4）。 */
export const colorModeSchema = z.enum(['pattern', 'block']);
export type ColorMode = z.infer<typeof colorModeSchema>;

/**
 * ダイヤグラムのビューポート（仕様書 §6.2.1、§6.2.3）。
 *
 * 表示範囲の既定は 7:00〜22:00。スクロール位置と拡大率を保存し、ファイルを
 * 開き直しても表示が再現されるようにする。
 */
export const diagramViewSchema = z.object({
  /** 横軸の拡大率（1 分あたりの px）。 */
  pxPerMinute: z.number().positive().default(3),
  /** 縦軸の拡大率（`axisPosition` 1 単位あたりの px）。 */
  pxPerAxisUnit: z.number().positive().default(6),
  /** 表示左端の時刻。 */
  scrollTime: secondsSchema.default(fromHM(7, 0)),
  /** 表示上端の軸位置。 */
  scrollAxis: z.number().default(0),
});
export type DiagramView = z.infer<typeof diagramViewSchema>;

/**
 * 表示設定（仕様書 §5.10）。プロジェクトに保存され、開き直しても再現される。
 *
 * すべての項目に既定値を与えている。古いファイルに項目が欠けていても、
 * マイグレーション処理を書かずに読み込めるようにするため。
 */
export const viewSettingsSchema = z.object({
  /** ダイヤグラム（上）が占める高さの比率。0〜1（仕様書 §6.4）。 */
  splitRatio: z.number().min(0.1).max(0.9).default(0.6),
  /** 編集中のダイヤ。null なら先頭のダイヤを使う。 */
  activeServiceId: idSchema.nullable().default(null),
  /** 時刻表の方向タブ。 */
  activeDirection: directionIdSchema.default(0),
  diagram: diagramViewSchema.default({}),
  colorMode: colorModeSchema.default('pattern'),
  /** 非表示にするパターン。 */
  hiddenPatternIds: z.array(idSchema).default([]),
  /** 非表示にする運用番号。 */
  hiddenBlockIds: z.array(idSchema).default([]),
  /** 非表示にする方向。 */
  hiddenDirections: z.array(directionIdSchema).default([]),
  /** 回送便を表示するか。 */
  showDeadhead: z.boolean().default(true),
  /** 検証パネルを開いているか。 */
  validationPanelOpen: z.boolean().default(true),
});
export type ViewSettings = z.infer<typeof viewSettingsSchema>;

/** プロジェクト全体（仕様書 §5.10、§7.2）。`.uodia` ファイルの中身。 */
export const projectSchema = z.object({
  meta: metaSchema,
  document: documentInfoSchema,
  services: z.array(serviceSchema),
  view: viewSettingsSchema.default({}),
});

/** 読み込んだ後のプロジェクト。既定値が適用済み。 */
export type Project = z.infer<typeof projectSchema>;

/** ファイルに書かれ得るプロジェクト。既定値のある項目は省略できる。 */
export type ProjectInput = z.input<typeof projectSchema>;
