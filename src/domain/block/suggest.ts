/**
 * 運用番号の自動採番（仕様書 §6.1.5、T-23）。
 *
 * 新しい便に付ける運用番号を**提案する**だけであり、決めはしない。提案値は
 * 通常の編集と同じように上書きでき、自動で付いたことを画面上で区別しない。
 * 区別すると「これは自分が書いたのか」を利用者に覚えさせることになる。
 *
 * ## 末尾に継ぐことしかしない
 *
 * 提案するのは、**その運用の最後の便に続けて走れる**場合だけである
 * （終着停留所が一致し、終着時刻がその便の始発時刻以前）。運用の途中に割り込む
 * 提案はしない。割り込めば後続の便との繋がりが崩れ、V-01（停留所の不一致）か
 * V-02（折返し時分が負）を必ず生む。
 *
 * 該当が無ければ空欄のままとする。**間違った提案より、提案しないほうがよい。**
 * 空欄は V-07（情報）で拾われ、利用者が自分で埋められる。
 */

import type { Trip } from '@/domain/model';
import type { NetworkIndex } from '@/domain/network';
import { compareTime, type Seconds } from '@/domain/time';
import { originStopId, originTime } from '@/domain/trip';
import { deriveBlocks } from './derive';

/**
 * その便に提案する運用番号。該当が無ければ空文字（＝未割当）。
 *
 * @param trip 提案を受ける便。時刻が入っていること
 * @param trips 同じダイヤの便。**両方向を渡す**こと。運用は方向をまたぐ
 *   （工学部前へ着いた車がそのまま豊中方面へ折り返す）ため、片方向だけを見ると
 *   最も自然な継ぎ先を取り逃がす
 */
export function suggestBlockId(trip: Trip, trips: readonly Trip[], network: NetworkIndex): string {
  const startStopId = originStopId(trip, network);
  const startTime = originTime(trip, network);
  if (startStopId === null || startTime === null) return '';

  // 自分自身は継ぎ先になり得ない。まだ運用に属していなくても、同じ便が
  // 「直前の便」として現れる形は作らない。
  const others = trips.filter((other) => other.tripId !== trip.tripId);

  let best: { blockId: string; endTime: Seconds } | null = null;
  for (const block of deriveBlocks(others, network).blocks) {
    // 運用は必ず 1 便以上を含む（`derive.ts` の `BlockTrips`）。先頭を取り出して
    // おけば、1 便だけの運用でも末尾が必ず決まる。
    const [first, ...rest] = block.trips;
    const last = rest.at(-1) ?? first;

    if (last.terminalStopId !== startStopId) continue;
    if (compareTime(last.terminalTime, startTime) > 0) continue;

    // 終着時刻が最も遅いものを選ぶ（仕様書 §6.1.5）。同着なら運用番号の
    // 昇順で決める。`deriveBlocks` が運用番号順に返すため、後から来たものを
    // 採らなければそれで決まる。
    if (best === null || compareTime(last.terminalTime, best.endTime) > 0) {
      best = { blockId: block.blockId, endTime: last.terminalTime };
    }
  }

  return best === null ? '' : best.blockId;
}
