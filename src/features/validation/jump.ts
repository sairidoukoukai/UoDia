/**
 * 指摘から「どこへ飛ぶか」を決める（仕様書 §6.6、T-34）。
 *
 * 指摘が指しているのは便か運用である（`ValidationTarget`）。飛び先はそこから
 * 決まる——**選ぶ便**、時刻表の**方向タブ**、ダイヤグラムの**送り先**。
 *
 * DOM もストアも見ない純関数にしてある。飛ぶこと自体は 3 つの状態を書き換える
 * 操作であり、どれを書き換えるかを画面の側で組み立てると、方向だけ切り替わって
 * 選択が付いてこない、といった半端な移動が生まれる。
 */

import type { Trip } from '@/domain/model';
import type { NetworkIndex } from '@/domain/network';
import { compareTime, MAX_SECONDS, SECONDS_PER_MINUTE, type Seconds } from '@/domain/time';
import { originTime } from '@/domain/trip';
import type { ValidationIssue } from '@/domain/validation';

/**
 * 飛び先。**時刻が無い便もある**（`anchor` が `null`。V-08 が指すのはまさに
 * それである）ため、送り先は `null` になりうる。
 *
 * **方向タブは持たない**（T-38）。選んだ便の方向は時刻表が自分で開く
 * （`directionToShow`）。飛ぶ側が指図すると、同じ規則が 2 か所に書かれる。
 */
export interface JumpTarget {
  /** 選ぶ便。指す先が無ければ空。 */
  readonly tripIds: readonly string[];
  /** ダイヤグラムで見せたい時刻。決められなければ `null`。 */
  readonly time: Seconds | null;
}

const NOWHERE: JumpTarget = { tripIds: [], time: null };

/**
 * 指摘の飛び先。
 *
 * 運用を指す指摘（V-01・V-02・V-05 など）では、**その運用の便をすべて選ぶ**。
 * 運用の中の 2 便の関係が問題なのであり、片方だけを選んでも何が起きているのか
 * 分からない。
 */
export function jumpTargetOf(
  issue: ValidationIssue,
  trips: readonly Trip[],
  network: NetworkIndex,
): JumpTarget {
  const targeted =
    issue.target.tripId === undefined
      ? issue.target.blockId === undefined
        ? []
        : trips.filter((trip) => trip.blockId === issue.target.blockId)
      : trips.filter((trip) => trip.tripId === issue.target.tripId);

  if (targeted.length === 0) return NOWHERE;

  return { tripIds: targeted.map((trip) => trip.tripId), time: earliest(targeted, network) };
}

/** 選んだ便のうち一番早い始発時刻。どれも時刻が無ければ `null`。 */
function earliest(trips: readonly Trip[], network: NetworkIndex): Seconds | null {
  let found: Seconds | null = null;
  for (const trip of trips) {
    const time = originTime(trip, network);
    if (time === null) continue;
    if (found === null || compareTime(time, found) < 0) found = time;
  }
  return found;
}

/**
 * 飛び先の時刻を画面に入れるための送り位置。
 *
 * **端に貼り付けない。** 左端ちょうどに置くと、その便へ入ってくる回送や 1 本前の
 * 便が画面の外に残り、何と何が問題なのかが見えない。少し手前から見せる。
 */
export const JUMP_LEAD_MINUTES = 20;

export function scrollTimeFor(time: Seconds, leadMinutes = JUMP_LEAD_MINUTES): number {
  return clamp(time - leadMinutes * SECONDS_PER_MINUTE, 0, MAX_SECONDS);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
