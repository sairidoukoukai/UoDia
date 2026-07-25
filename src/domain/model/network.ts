/**
 * ネットワーク定義（`route.json`）のスキーマ。仕様書 §5.1〜§5.5。
 *
 * 停留所・区間所要時間・停車パターンを定義する固定データ。プロジェクトファイル
 * には含めない。
 *
 * 本モジュールは**構造の検証のみ**を行う。停留所参照の実在性や区間表の網羅性
 * （R-02〜R-07）は T-06 が担う。構造と意味の検証を分けることで、エラーの原因が
 * 「JSON の形が違う」のか「データの内容が矛盾している」のか切り分けられる。
 */

import { z } from 'zod';
import { GRAIN_SECONDS } from '@/domain/time';
import { directionIdSchema, hexColorSchema, idSchema, runMinutesSchema } from './primitives';

/** ダイヤグラムの停留所線の描き方。 */
export const gridStyleSchema = z.enum(['bold', 'normal', 'dashed']);
export type GridStyle = z.infer<typeof gridStyleSchema>;

/**
 * 取扱区分（仕様書 §5.4）。その便がその停留所で乗客の乗り降りをどう扱うか。
 *
 * 「通過」は設けない。パターンに含まれない停留所は、その便が経由しないことを
 * 意味する。
 */
export const handlingSchema = z.enum(['stop', 'boardOnly', 'alightOnly']);
export type Handling = z.infer<typeof handlingSchema>;

/** 停留所（仕様書 §5.3）。千里営業所も停留所の一種として扱う。 */
export const stopSchema = z.object({
  /** GTFS `stop_id`。例: `1_0` */
  stopId: idSchema,
  /** GTFS `stop_name`。例: 豊中学舎 */
  stopName: z.string().min(1),
  /** ダイヤグラム縦軸・時刻表用の略称。UoDia 独自。例: 豊中 */
  shortName: z.string().min(1),
  /** 例: 豊中地区 */
  area: z.string(),
  /** ダイヤグラム縦軸の座標（任意単位）。表示専用で、便の時刻を拘束しない。 */
  axisPosition: z.number().finite(),
  gridStyle: gridStyleSchema,
  /** true の停留所は時刻表・ダイヤグラムに表示しない。内部データとしてのみ保持する。 */
  hiddenInEditor: z.boolean(),
  /** true の停留所は営業所。GTFS 出力から除外される。 */
  isDepot: z.boolean(),
});
export type Stop = z.infer<typeof stopSchema>;

/**
 * 区間（仕様書 §5.2）。隣接する 2 停留所を結ぶ**有向**の辺。
 *
 * 所要時間は停留所でも停車パターンでもなく、区間が持つ。往復で所要時間が
 * 異なり得るため有向とする（実際に箕面〜吹田間は経路が異なり 5 分ずれる）。
 */
export const segmentSchema = z.object({
  fromStopId: idSchema,
  toStopId: idSchema,
  runMinutes: runMinutesSchema,
});
export type Segment = z.infer<typeof segmentSchema>;

/** 停車パターン内の 1 停留所。 */
export const patternStopSchema = z.object({
  stopId: idSchema,
  handling: handlingSchema,
});
export type PatternStop = z.infer<typeof patternStopSchema>;

/**
 * 停車パターン（仕様書 §5.5）。
 *
 * **所要時間は持たない。** 停留所の並びのみを持ち、所要時間は区間表から引く。
 * 回送もパターンの一種として扱うことで、出入庫のための専用構造を不要にしている。
 */
export const stopPatternSchema = z.object({
  /** 例: `S1` */
  patternId: idSchema,
  /** GTFS `trip_headsign`。例: 直行吹田 */
  patternName: z.string().min(1),
  /** GTFS `route_long_name` の生成元。例: 豊中吹田線 */
  routeName: z.string().min(1),
  directionId: directionIdSchema,
  /** ダイヤグラムのスジ色。 */
  color: hexColorSchema,
  /** 便の新規作成時に選ばれる。方向ごとにちょうど 1 つ（R-05 で検証）。 */
  isDefault: z.boolean(),
  /** true なら回送。営業運行ではなく、GTFS 出力から除外される。 */
  isDeadhead: z.boolean(),
  /** 通過順。先頭が始発、末尾が終着。2 要素以上（R-06 で検証）。 */
  stopSequence: z.array(patternStopSchema),
});
export type StopPattern = z.infer<typeof stopPatternSchema>;

/** ネットワーク定義（仕様書 §5.1）。`route.json` の中身。 */
export const networkDefSchema = z.object({
  /** 本ファイルの版数。プロジェクトの `meta.routeVersion` との整合性検査に使う。 */
  version: z.number().int().min(1),
  name: z.string().min(1),
  /** 時刻の刻み（秒）。仕様書 §2.1 より 300 固定。 */
  timeGrain: z.literal(GRAIN_SECONDS),
  stops: z.array(stopSchema),
  segments: z.array(segmentSchema),
  patterns: z.array(stopPatternSchema),
});
export type NetworkDef = z.infer<typeof networkDefSchema>;
