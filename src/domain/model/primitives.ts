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

/**
 * 暦の上の日（`YYYY-MM-DD`）。運行日カレンダー（#197、仕様書 v2 §4.4）で使う。
 *
 * **文字列で持つ。** `Date` を持つと、保存のたびにタイムゾーンの解釈が挟まる。
 * 時刻ではなく暦の上の日を指しているのだから、`2026-08-06` という文字列が
 * そのまま値である。これは時刻を秒で持っていること（{@link secondsSchema}）と
 * 矛盾しない——**あちらは 1 日の中の位置、こちらは暦の上の日**である。
 *
 * **形と、実在する日付であることの両方を見る。** 形だけでは `2026-02-30` が
 * 通ってしまい、範囲を展開したときに静かにずれる。
 */
export const calendarDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, { message: '日付は YYYY-MM-DD 形式で指定してください' })
  .refine(isRealDate, { message: '存在しない日付です' });

/**
 * 暦の上の日（`YYYY-MM-DD`）。**中身はただの文字列である。**
 *
 * 別名を付けるのは、引数が 2 つ以上並んだときに「どちらが日付か」を型で読める
 * ようにするためであり、`string` と区別できる型を作るためではない。
 */
export type CalendarDate = z.infer<typeof calendarDateSchema>;

/** `YYYY-MM-DD` が実在する日を指すか。閏日と月末の桁溢れを弾く。 */
function isRealDate(value: string): boolean {
  const [year, month, day] = value.split('-').map(Number);
  if (year === undefined || month === undefined || day === undefined) return false;

  // **UTC で組む。** ローカル時刻で組むと、実行環境の時差によって日付が 1 日
  // ずれ、同じファイルが環境によって通ったり弾かれたりする。
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}
