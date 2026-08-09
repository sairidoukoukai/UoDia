/**
 * 停留所の緯度経度（#198・#221、仕様書 v2 §3.4）。**純関数のみ。**
 *
 * **打つ場所はもう無い**（T-85）。緯度経度は `route.json` に書いてあり、停留所は
 * 動かない。ここに残るのは**欠けている停留所を名指しする**ためのものだけである。
 *
 * **値の形は検証しない。** 度の範囲は `latitudeSchema` / `longitudeSchema` が
 * 見ており、`route.json` を読み込む時点で弾かれる。打てなくなった以上、読み込みの
 * あとに範囲外の値が現れる道は無い。
 */

import type { Stop } from '@/domain/model';

/** 緯度経度がまだ入っていない停留所（R-15 が弾く先）。 */
export function stopsWithoutCoordinates(stops: readonly Stop[]): Stop[] {
  return stops.filter((stop) => stop.lat === undefined || stop.lon === undefined);
}
