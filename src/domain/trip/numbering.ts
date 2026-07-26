/**
 * 便番号の採番（仕様書 §6.1.6）。
 *
 * 方向ごとに始発時刻の昇順で `E1` `E2` `E3` … / `W1` `W2` `W3` … と振る。
 * `E` は吹田方面（`directionId: 0`）、`W` は豊中方面（`directionId: 1`）。
 *
 * **採番は導出であり、既存の番号に依存しない。** 便を追加・削除・移動したあとに
 * 振り直せば、常に時刻順に詰まった番号が得られる。前回の番号を見て空き番号を
 * 探すような処理を持つと、履歴に依存して結果が変わり、同じダイヤから同じ番号が
 * 得られなくなる。
 */

import type { Trip } from '@/domain/model';
import type { NetworkIndex } from '@/domain/network';
import { compareTime, type Seconds } from '@/domain/time';
import { originTime } from './times';

/** 方向ごとの接頭辞。 */
export const DIRECTION_PREFIX: Readonly<Record<0 | 1, string>> = {
  0: 'E', // 吹田方面（東行き）
  1: 'W', // 豊中方面（西行き）
};

/**
 * 便番号を採番する。
 *
 * 返すのは `tripId` から便番号への対応表。便そのものは書き換えない。呼び出し側が
 * どの便に適用するかを決められるようにするためと、採番結果を適用前に画面へ
 * 出せるようにするため。
 *
 * 番号が付かない便は表に含まれない。
 *
 * - **回送便**は営業運行ではないため採番しない（利用者向けの番号であるため）
 * - 時刻が未入力の便は時刻順に並べようがないため採番しない
 * - `patternId` が解決できない便も同様
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
  for (const [directionId, departures] of [
    [0, eastbound],
    [1, westbound],
  ] as const) {
    // 同時刻の便があっても採番が入力の並びで変わらないよう、便 ID で決着させる。
    departures.sort((a, b) => compareTime(a.time, b.time) || a.tripId.localeCompare(b.tripId));
    departures.forEach(({ tripId }, index) => {
      numbers.set(tripId, `${DIRECTION_PREFIX[directionId]}${String(index + 1)}`);
    });
  }

  return numbers;
}

/**
 * 採番結果を便に適用した新しい配列を返す。
 *
 * 番号が付かない便（回送・時刻未入力）の `tripShortName` は**空文字にする**。
 * 前回の採番で付いた番号が残ると、時刻を消したのに番号だけ残る、回送に変えたのに
 * 営業便の番号が残る、といった食い違いが生じるため。
 */
export function applyTripNumbers(trips: readonly Trip[], network: NetworkIndex): Trip[] {
  const numbers = numberTrips(trips, network);
  return trips.map((trip) => ({ ...trip, tripShortName: numbers.get(trip.tripId) ?? '' }));
}
