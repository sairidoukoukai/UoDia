/**
 * GTFS のファイルを書く（仕様書 v2 §6.3.1、T-82）。**純関数のみ。**
 *
 * ## 共通仕様は実例に合わせる
 *
 * | 項目 | 決め |
 * | --- | --- |
 * | 文字コード | **UTF-8（BOM 付き）**——12 ファイルすべて |
 * | 改行 | **LF** |
 * | 末尾 | 改行を 1 つ置く |
 * | 時刻 | **`7:15:00`**（時は 0 詰めしない） |
 * | 日付 | **`20260401`** |
 * | 空の値 | 空文字（**列そのものは残す**） |
 *
 * **BOM を付けるのは、実例がそうなっているから**である（時刻表 CSV の §5.6.3 は
 * Excel のためであり、理由が違う）。読む相手が既に決まっている以上、揃える。
 *
 * ## 時刻表 CSV とは別に書く
 *
 * `domain/export/csv.ts` は改行が CRLF である（RFC 4180）。**GTFS は LF** で
 * あり、揃えられない。**引用の仕方だけを借りる。**
 */

import { csvField, type CsvRows } from '../csv';
import { toHM, type Seconds } from '@/domain/time';
import type { CalendarDate } from '@/domain/model';

/** 改行。**CRLF ではない。** */
const LF = '\n';

/** UTF-8 の BOM。 */
const BOM = [0xef, 0xbb, 0xbf];

/** GTFS の 1 ファイル。 */
export interface GtfsFile {
  /** zip の中での名前（`agency.txt` など）。 */
  readonly name: string;
  readonly bytes: Uint8Array;
}

/** 行を GTFS の本文にする。**末尾に改行を 1 つ置く。** */
export function toGtfsText(rows: CsvRows): string {
  return rows.map((row) => row.map(csvField).join(',')).join(LF) + LF;
}

/** 行を GTFS のファイルにする。**BOM を付ける。** */
export function toGtfsFile(name: string, rows: CsvRows): GtfsFile {
  return { name, bytes: encode(toGtfsText(rows)) };
}

/** 素通しするファイル（`shapes.txt`）。**BOM が無ければ付ける。** */
export function passthroughFile(name: string, text: string): GtfsFile {
  // 実例は BOM 付きである。既に付いていれば二重にしない。
  return { name, bytes: text.startsWith('﻿') ? encodeRaw(text) : encode(text) };
}

function encode(text: string): Uint8Array {
  const body = new TextEncoder().encode(text);
  const bytes = new Uint8Array(BOM.length + body.length);
  bytes.set(BOM, 0);
  bytes.set(body, BOM.length);
  return bytes;
}

/** BOM を足さずにそのまま符号化する。 */
function encodeRaw(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

/**
 * 時刻を GTFS の形にする。**`7:15:00`。時は 0 詰めしない。**
 *
 * **24 時を超える表記もそのまま**である（`25:30:00`）。GTFS は「その日の
 * 始発から数えた時刻」を求めており、24 を超える値を正しいものとして扱う。
 */
export function formatGtfsTime(time: Seconds): string {
  const { hours, minutes } = toHM(time);
  return `${String(hours)}:${String(minutes).padStart(2, '0')}:00`;
}

/** 日付を GTFS の形にする。**`20260401`。** */
export function formatGtfsDate(date: CalendarDate): string {
  return date.replaceAll('-', '');
}
