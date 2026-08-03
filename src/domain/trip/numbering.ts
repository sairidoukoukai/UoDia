/**
 * 便番号の採番（仕様書 §6.1.6）。
 *
 * 営業便に方向ごと、始発時刻の昇順で振る。
 *
 * | 便の種別 | 例 |
 * | --- | --- |
 * | 営業便・吹田方面（`directionId: 0`） | `E1` `E2` `E3` … |
 * | 営業便・豊中方面（`directionId: 1`） | `W1` `W2` `W3` … |
 *
 * **回送便には番号を振らない**（仕様書 §6.1.6、T-51）。番号は便を指すために
 * あり、指す必要が生じるのは画面に出るものだけである。回送便は列にならず
 * （§6.1.7）、前運用・後運用の欄に時刻として、ダイヤグラムでは営業便に続く
 * 破線として現れる。どちらも隣の営業便を指せば足りる。
 *
 * 展開した回送便が混じった並びを渡されても差し支えないよう、回送は**数えずに
 * 飛ばす**。数に入れると営業便の番号がずれる。
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

/**
 * 便番号を採番する。
 *
 * 番号が付かない便は表に含まれない。
 *
 * - **回送便**は番号を持たない
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

  for (const trip of trips) {
    const pattern = network.patternIndex(trip.patternId);
    if (pattern === undefined || pattern.pattern.isDeadhead) continue;
    const time = originTime(trip, network);
    if (time === null) continue;

    const departure = { tripId: trip.tripId, time };
    if (pattern.pattern.directionId === 0) {
      eastbound.push(departure);
    } else {
      westbound.push(departure);
    }
  }

  const numbers = new Map<string, string>();
  for (const [prefix, departures] of [
    [DIRECTION_PREFIX[0], eastbound],
    [DIRECTION_PREFIX[1], westbound],
  ] as const) {
    // 同時刻の便があっても採番が入力の並びで変わらないよう、便 ID で決着させる。
    departures.sort((a, b) => compareTime(a.time, b.time) || a.tripId.localeCompare(b.tripId));
    departures.forEach(({ tripId }, index) => {
      numbers.set(tripId, `${prefix}${String(index + 1)}`);
    });
  }

  return numbers;
}
