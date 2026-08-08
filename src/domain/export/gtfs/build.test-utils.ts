/**
 * GTFS の検証で使う便の組み立て（T-82）。
 *
 * **`createTrip` をそのまま使う。** テスト用に便を手で組むと、時刻の導出や
 * 運用番号の提案を通らないものが出来上がり、**実際には作れない便**で書き出しを
 * 確かめることになる。
 */

import type { Trip } from '@/domain/model';
import type { NetworkIndex } from '@/domain/network';
import { createTrip } from '@/domain/service';
import { fromHM } from '@/domain/time';

/** 便を 1 つ足し、運用番号を付ける。 */
export function addTripForTest(
  trips: readonly Trip[],
  patternId: string,
  stopId: string,
  hour: number,
  minute: number,
  blockId: string,
  network: NetworkIndex,
): Trip[] {
  const inserted = createTrip(trips, patternId, stopId, fromHM(hour, minute), network);
  if (inserted === null) throw new Error(`便を作れません: ${patternId}`);

  return inserted.trips.map((trip) =>
    inserted.added.some((added) => added.tripId === trip.tripId) ? { ...trip, blockId } : trip,
  );
}
