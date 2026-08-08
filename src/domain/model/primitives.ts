/**
 * データモデル全体で共有する基本スキーマ。
 *
 * 方針: **スキーマを唯一の定義源とし、TypeScript 型は `z.infer` で導出する。**
 * 型とスキーマを別々に書くと、片方だけ変更されたときに検証が素通りする事故が
 * 起きる（実装計画書 T-04）。
 */

import { z } from 'zod';
import { GRAIN_SECONDS, MAX_SECONDS, type Seconds } from '@/domain/time';

/**
 * エンティティ ID。空文字を許さない。
 *
 * 形式（UUID v4 など）は検査しない。ID の正しさは「参照先が実在するか」で
 * 決まるものであり、それは T-11 の参照整合性検査が担う。ここで形式を縛ると、
 * 手書きの `route.json`（`1_0` や `S1`）を受け付けられなくなる。
 */
export const idSchema = z.string().min(1, { message: 'ID は空にできません' });

/**
 * 00:00 からの経過秒数。5 分の倍数であることを検証したうえで
 * {@link Seconds} 型に変換する（仕様書 §2.1）。
 */
export const secondsSchema = z
  .number()
  .int({ message: '時刻は整数でなければなりません' })
  .min(0, { message: '時刻は負であってはなりません' })
  .max(MAX_SECONDS, { message: `時刻は ${String(MAX_SECONDS)} 秒以下でなければなりません` })
  .refine((v) => v % GRAIN_SECONDS === 0, {
    message: `時刻は ${String(GRAIN_SECONDS)} 秒（5 分）の倍数でなければなりません`,
  })
  .transform((v): Seconds => v as Seconds);

/** 所要時間（分）。5 の倍数であること（仕様書 §5.5.2 R-01）。 */
export const runMinutesSchema = z
  .number()
  .int({ message: '所要時間は整数でなければなりません' })
  .min(0, { message: '所要時間は負であってはなりません' })
  .refine((v) => v % 5 === 0, { message: '所要時間は 5 の倍数でなければなりません' });

/** `#RRGGBB` 形式の色。 */
export const hexColorSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, { message: '色は #RRGGBB 形式で指定してください' });

/**
 * GTFS の色（`RRGGBB`。**`#` を付けない**）。
 *
 * **画面用の {@link hexColorSchema} と別に持つ**（仕様書 v2 §6.8）。書式が違う
 * だけではなく、**用途が違う**——画面の色はスジを描くための濃い色、GTFS の色は
 * 一覧や地図の地色として使う淡い色である。片方から計算すると、どちらの用途にも
 * 合わない色が出る。
 */
export const gtfsColorSchema = z
  .string()
  .regex(/^[0-9a-fA-F]{6}$/, { message: 'GTFS の色は RRGGBB 形式（# なし）で指定してください' });

/**
 * 緯度（度）。GTFS `stop_lat`。
 *
 * **範囲だけを見る。** 日本の範囲に縛らない——縛れば「正しい値を弾かない」ことを
 * 確かめる手立てが要り、その手立ては地理の知識になる。
 */
export const latitudeSchema = z
  .number()
  .finite()
  .min(-90, { message: '緯度は -90 以上でなければなりません' })
  .max(90, { message: '緯度は 90 以下でなければなりません' });

/** 経度（度）。GTFS `stop_lon`。 */
export const longitudeSchema = z
  .number()
  .finite()
  .min(-180, { message: '経度は -180 以上でなければなりません' })
  .max(180, { message: '経度は 180 以下でなければなりません' });

/** 方向。0 = 吹田方面 / 1 = 豊中方面（仕様書 §2）。 */
export const directionIdSchema = z.union([z.literal(0), z.literal(1)]);
export type DirectionId = z.infer<typeof directionIdSchema>;

/**
 * 方向の全部。**並びは 0 → 1（吹田方面 → 豊中方面）で固定する。**
 *
 * 時刻表を最大化して 2 方向を並べるとき、上に来るのは吹田方面である（#145）。
 * ダイヤグラムの縦軸は豊中が上であり（§6.2.1）、豊中発＝吹田方面を上に置くと
 * 絵と表の上下が揃う。**同じ参照を返す**（購読が無駄に動かない）。
 */
export const DIRECTIONS: readonly DirectionId[] = Object.freeze([0, 1]);

/** ISO 8601 の日時文字列。 */
export const isoDateTimeSchema = z.string().refine((v) => !Number.isNaN(Date.parse(v)), {
  message: '日時は ISO 8601 形式で指定してください',
});
