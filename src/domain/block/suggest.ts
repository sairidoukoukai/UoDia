/**
 * 運用番号の自動採番（仕様書 §6.1.5、T-23）。
 *
 * 新しい便に付ける運用番号を**提案する**だけであり、決めはしない。提案値は
 * 通常の編集と同じように上書きでき、自動で付いたことを画面上で区別しない。
 * 区別すると「これは自分が書いたのか」を利用者に覚えさせることになる。
 *
 * ## 末尾に継ぐことしかしない
 *
 * 継ぎ先にするのは、**その運用の最後の便に続けて走れる**場合だけである
 * （終着停留所が一致し、終着時刻がその便の始発時刻以前）。運用の途中に割り込む
 * 提案はしない。割り込めば後続の便との繋がりが崩れ、V-01（停留所の不一致）か
 * V-02（折返し時分が負）を必ず生む。
 *
 * ## 継げなければ新しい運用を興す
 *
 * 該当が無ければ、まだ使われていない運用番号を作る（仕様書 §6.1.5、v4.11）。
 * **継げないとは「その車両ではもう走れない」ということであり、別の車両が要る。**
 *
 * 以前は空欄のままにしていた（「間違った提案より、提案しないほうがよい」）が、
 * それでは**白紙から作るかぎり運用番号が 1 つも付かなかった**（#87）。継げる運用が
 * 存在しないのだから最初の便には提案が出ず、2 便目もその 1 便目が運用を持たない
 * 以上どこにも継げない。以下ずっと空欄である。
 */

import type { Trip } from '@/domain/model';
import type { NetworkIndex } from '@/domain/network';
import { compareTime, type Seconds } from '@/domain/time';
import { originStopId, originTime } from '@/domain/trip';
import { deriveBlocks } from './derive';

/**
 * その便に付ける運用番号。
 *
 * 継げる運用があればその番号、無ければ新しい運用番号。**時刻や経路を解決
 * できない便だけが空文字（＝未割当）になる** — 何に継げるかを決めようがない。
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

  return best === null ? nextBlockId(others) : best.blockId;
}

/** 運用番号に使う文字の数。`A`〜`Z` を使い、尽きたら桁を増やす。 */
const LETTER_COUNT = 26;
const FIRST_LETTER = 'A'.charCodeAt(0);

/**
 * まだ使われていない運用番号（仕様書 §6.1.5）。
 *
 * `A` `B` … `Z` `AA` `AB` … の順に見て、最初の空きを返す。**空いた番号を
 * 埋め直す**のは、便を消したあとに `A` `C` と飛ぶのを避けるためである。
 * 運用番号は車両を指すものであり、番号が飛んでいることに意味は無い。
 */
export function nextBlockId(trips: readonly Trip[]): string {
  const used = new Set(trips.map((trip) => trip.blockId));
  for (let index = 0; ; index++) {
    const candidate = blockIdAt(index);
    if (!used.has(candidate)) return candidate;
  }
}

/**
 * 0 から数えて `index` 番目の運用番号。`A` `B` … `Z` `AA` `AB` … と続く。
 *
 * 文字を配列から引かず符号から作るのは、**添字が範囲を外れる場合を書かずに
 * 済ませる**ためである（`noUncheckedIndexedAccess`）。起こり得ない場合の
 * 分岐は、書けば必ず試されないまま残る。
 */
function blockIdAt(index: number): string {
  let rest = index;
  let name = '';
  do {
    name = String.fromCharCode(FIRST_LETTER + (rest % LETTER_COUNT)) + name;
    rest = Math.floor(rest / LETTER_COUNT) - 1;
  } while (rest >= 0);
  return name;
}

/**
 * 便に運用番号を提案して返す（仕様書 §6.1.5、T-23）。
 *
 * 提案するのは、**その便に初めて時刻が入り、運用番号がまだ空欄のとき**だけで
 * ある。仕様書の言う「新規便の作成時」がここに当たる。便を追加した時点では
 * 時刻が無く（`anchor: null`）、始発時刻を要する提案アルゴリズムを走らせようが
 * ないためである。
 *
 * 時刻を打ち直すたびに提案し直さないのは、利用者が消した運用番号を勝手に
 * 書き戻さないためである。提案値は普通の編集と同じように上書きでき、自動で
 * 付いたことは画面上で区別しない（§6.1.5）。
 *
 * @param before 書き換える前の便。新しく作った便では `undefined`
 */
export function withSuggestedBlockId(
  trip: Trip,
  before: Trip | undefined,
  trips: readonly Trip[],
  network: NetworkIndex,
): Trip {
  if (before?.anchor != null || trip.blockId !== '') return trip;

  const blockId = suggestBlockId(trip, trips, network);
  return blockId === '' ? trip : { ...trip, blockId };
}
