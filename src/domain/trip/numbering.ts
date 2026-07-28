/**
 * 便番号の採番（仕様書 §6.1.6）。
 *
 * 営業便は方向ごとに、回送便は方向を分けず、いずれも始発時刻の昇順に振る。
 *
 * | 便の種別 | 例 |
 * | --- | --- |
 * | 営業便・吹田方面（`directionId: 0`） | `E1` `E2` `E3` … |
 * | 営業便・豊中方面（`directionId: 1`） | `W1` `W2` `W3` … |
 * | 回送便 | `D1` `D2` `D3` … |
 *
 * **回送便を方向で分けないのは、回送が案内の対象ではないからである。** 営業便の
 * 番号は利用者に示すものであり、行き先の向きが意味を持つ。回送に必要なのは
 * 「その日の何本目の回送か」だけであり、出庫と入庫を別々に数えると、営業所を
 * 経由しない回送（車両の差し替え）を表せなくなる。
 *
 * ## 便番号は持ち物ではない
 *
 * 返すのは `tripId` から便番号への対応表であり、便に書き込む関数は用意しない。
 * **番号を便に持たせると、1 便の時刻を変えるたびに全便を書き換えることになる。**
 * 取り消しの単位が「1 便の移動」ではなく「全便の書き換え」になってしまう
 * （仕様書 §6.1.6、§6.7）。表示するその場で引くこと。
 *
 * **採番は導出であり、既存の番号に依存しない。** 便を追加・削除・移動したあとに
 * 引き直せば、常に時刻順に詰まった番号が得られる。前回の番号を見て空き番号を
 * 探すような処理を持つと、履歴に依存して結果が変わり、同じダイヤから同じ番号が
 * 得られなくなる。
 */

import type { Trip } from '@/domain/model';
import type { NetworkIndex } from '@/domain/network';
import { compareTime, type Seconds } from '@/domain/time';
import { originTime } from './times';

/** 営業便の方向ごとの接頭辞。 */
export const DIRECTION_PREFIX: Readonly<Record<0 | 1, string>> = {
  0: 'E', // 吹田方面（東行き）
  1: 'W', // 豊中方面（西行き）
};

/** 回送便の接頭辞。方向で分けない。 */
export const DEADHEAD_PREFIX = 'D';

/**
 * 便番号を採番する。
 *
 * 番号が付かない便は表に含まれない。
 *
 * - 時刻が未入力の便は時刻順に並べようがないため採番しない
 * - `patternId` が解決できない便、時刻が表せる範囲を外れる便も同様
 */
export function numberTrips(trips: readonly Trip[], network: NetworkIndex): Map<string, string> {
  interface Departure {
    readonly tripId: string;
    readonly time: Seconds;
  }
  const eastbound: Departure[] = [];
  const westbound: Departure[] = [];
  const deadhead: Departure[] = [];

  for (const trip of trips) {
    const pattern = network.patternIndex(trip.patternId);
    if (pattern === undefined) continue;
    const time = originTime(trip, network);
    if (time === null) continue;

    const departure = { tripId: trip.tripId, time };
    if (pattern.pattern.isDeadhead) {
      deadhead.push(departure);
    } else if (pattern.pattern.directionId === 0) {
      eastbound.push(departure);
    } else {
      westbound.push(departure);
    }
  }

  const numbers = new Map<string, string>();
  for (const [prefix, departures] of [
    [DIRECTION_PREFIX[0], eastbound],
    [DIRECTION_PREFIX[1], westbound],
    [DEADHEAD_PREFIX, deadhead],
  ] as const) {
    // 同時刻の便があっても採番が入力の並びで変わらないよう、便 ID で決着させる。
    departures.sort((a, b) => compareTime(a.time, b.time) || a.tripId.localeCompare(b.tripId));
    departures.forEach(({ tripId }, index) => {
      numbers.set(tripId, `${prefix}${String(index + 1)}`);
    });
  }

  return numbers;
}
