/**
 * 停留所の緯度経度の入力（#198、仕様書 v2 §3.4）。**純関数のみ。**
 */

import type { NetworkDef, Stop } from '@/domain/model';

/** 画面に出す 1 行。 */
export interface StopCoordinateRow {
  readonly stopId: string;
  readonly stopName: string;
  /** 車庫であること。**出す先が `stops.txt` の `location_type: 1` になる。** */
  readonly isDepot: boolean;
  /** いまの値。まだ無ければ空文字。 */
  readonly lat: string;
  readonly lon: string;
}

/** 打ち直した値。**鍵は `stopId`。** */
export type CoordinateEdits = ReadonlyMap<string, { readonly lat: string; readonly lon: string }>;

/** 何も打ち直していない状態。**同じ参照を返す**（購読が無駄に動かない）。 */
export const NO_COORDINATE_EDITS: CoordinateEdits = new Map();

/** 数を欄の文字にする。**まだ無ければ空文字**（`0` と見分ける）。 */
function show(value: number | undefined): string {
  return value === undefined ? '' : String(value);
}

/**
 * 画面に出す行。**定義の並びをそのまま使う。**
 *
 * 並べ替えないのは、`route.json` を手で直すときに突き合わせられるようにする
 * ためである（`settings/segments.ts` と同じ判断）。
 *
 * **車庫も出す**（版数 3.0 で改めた）。`stops.txt` に出す以上、座標が要る
 * （仕様書 v2 §6.5.2）。
 */
export function stopCoordinateRows(network: NetworkDef): StopCoordinateRow[] {
  return network.stops.map((stop) => ({
    stopId: stop.stopId,
    stopName: stop.stopName,
    isDepot: stop.isDepot,
    lat: show(stop.lat),
    lon: show(stop.lon),
  }));
}

/**
 * 打たれた文字を度にする。受け取れなければ `null`。
 *
 * **空文字は `undefined` を返す**——「消した」ことを表せないと、一度入れた値を
 * 取り消せなくなる。
 */
export function parseDegrees(text: string, limit: number): number | null | undefined {
  const trimmed = text.trim();
  if (trimmed === '') return undefined;

  const value = Number(trimmed);
  if (!Number.isFinite(value)) return null;
  if (value < -limit || value > limit) return null;
  return value;
}

/** 緯度として読む（±90）。 */
export const parseLat = (text: string): number | null | undefined => parseDegrees(text, 90);
/** 経度として読む（±180）。 */
export const parseLon = (text: string): number | null | undefined => parseDegrees(text, 180);

/** 読めない値が入っている行の `stopId`。 */
export function invalidRows(edits: CoordinateEdits): string[] {
  const invalid: string[] = [];
  for (const [stopId, { lat, lon }] of edits) {
    if (parseLat(lat) === null || parseLon(lon) === null) invalid.push(stopId);
  }
  return invalid;
}

/** いまの定義と違う行だけを残す。**同じ値を打ち直しても変更にしない。** */
export function changedCoordinates(
  network: NetworkDef,
  edits: CoordinateEdits,
): Map<string, { lat: number | undefined; lon: number | undefined }> {
  const changed = new Map<string, { lat: number | undefined; lon: number | undefined }>();

  for (const stop of network.stops) {
    const edit = edits.get(stop.stopId);
    if (edit === undefined) continue;

    const lat = parseLat(edit.lat);
    const lon = parseLon(edit.lon);
    if (lat === null || lon === null) continue;

    if (lat !== stop.lat || lon !== stop.lon) changed.set(stop.stopId, { lat, lon });
  }

  return changed;
}

/** 緯度経度がまだ入っていない停留所（R-15 が弾く先）。 */
export function stopsWithoutCoordinates(stops: readonly Stop[]): Stop[] {
  return stops.filter((stop) => stop.lat === undefined || stop.lon === undefined);
}
