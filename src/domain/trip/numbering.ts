/**
 * 便番号の採番（仕様書 §6.1.6）。
 *
 * 営業便に方向ごと、始発時刻の昇順で振る。
 *
 * | 便の種別 | 例 |
 * | --- | --- |
 * | 営業便・吹田方面（`directionId: 0`） | `E1` `E2` `E3` … |
 * | 営業便・豊中方面（`directionId: 1`） | `W1` `W2` `W3` … |
 * | **回送便** | **`D1` `D2` `D3` …**（方向で分けない） |
 *
 * ## 回送にも番号を振る（#259。§6.1.6 を改め）
 *
 * かつては振っていなかった。理由はこうだった。
 *
 * > 番号は便を指すためにあり、**指す必要が生じるのは画面に出るものだけ**である。
 * > 回送便は列にならず、前運用・次運用の欄に時刻として現れる。
 *
 * **停留所間の回送は画面に出る**（#247）——時刻表の列になり、ダイヤグラムの
 * スジになり、箱ダイヤの棒になる。**指す必要が生じた。** 取り消しではなく、
 * 書いてある理由に沿った結論の更新である。
 *
 * ## 別の系列にする
 *
 * **営業便と同じ系列に混ぜない。** 混ぜると、回送を 1 本置くだけで営業便の
 * 番号が繰り上がる。便番号は人が口にする識別子であり（「E3 が遅れている」）、
 * **回送を足して呼び名が変わるのは役に立たない。**
 *
 * **方向でも分けない。** 回送の向きは運用の都合であって、利用者が「上りの回送」
 * を探すことはない。
 *
 * ## 回送どうしは通しで時刻順に振る
 *
 * **出入庫と区別せず、始発時刻の昇順で 1 本の系列にする。** 番号を見れば早い便か
 * 遅い便かが分かる——それが時刻順に振る意味であり、途中で規則が変わる系列は
 * その意味を失う。
 *
 * **代わりに、同じ便が画面と GTFS で違う番号になることを許す。** 出入庫は保存
 * されず、要る場面で展開される（§6.1.7）。画面が採番に渡すのは保存された便だけ
 * であり、GTFS は展開したものも渡す。**間に出入庫が入れば、後ろの番号はその数だけ
 * ずれる。**
 *
 * | | 画面（保存された便だけ） | GTFS（展開したものも） |
 * | --- | --- | --- |
 * | 7:00 の出区 | 渡らない | `D1` |
 * | 10:00 の区間回送 | `D1` | `D2` |
 *
 * かつては**置かれた回送を先に振る**ことでこのずれを消していたが、**その代償は
 * 系列が時刻順でなくなること**だった。ずれるのは GTFS の `trip_id` の側であり、
 * 読むのは機械である。**人が口にするのは画面の番号のほうであり、そちらを時刻順に
 * 保つ。**
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

/** 回送便の接頭辞（#259）。**方向で分けない。** */
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
  const deadheads: Departure[] = [];

  for (const trip of trips) {
    const pattern = network.patternIndex(trip.patternId);
    if (pattern === undefined) continue;
    const time = originTime(trip, network);
    if (time === null) continue;

    const departure = { tripId: trip.tripId, time };
    if (pattern.pattern.isDeadhead) {
      // 置かれた回送も展開された出入庫も同じ系列に入れる。**分けない**——
      // 番号が時刻順であることを、系列の途中で崩さない。
      deadheads.push(departure);
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
    [DEADHEAD_PREFIX, deadheads],
  ] as const) {
    // 同時刻の便があっても採番が入力の並びで変わらないよう、便 ID で決着させる。
    departures.sort((a, b) => compareTime(a.time, b.time) || a.tripId.localeCompare(b.tripId));
    departures.forEach(({ tripId }, index) => {
      numbers.set(tripId, `${prefix}${String(index + 1)}`);
    });
  }

  return numbers;
}
