/**
 * 運用番号の自動採番の検証（T-23、仕様書 §6.1.5）。
 *
 * 受入条件は「**提案された運用番号が V-01・V-02 に違反しない**」の 1 つ。
 * 提案を当てはめた結果を検証器（T-10）に通し、指摘が増えないことを直接見る。
 * 提案の中身を書き写した期待値と突き合わせるだけでは、規則の側を間違えたときに
 * 両方が同じように間違う。
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Trip } from '@/domain/model';
import { loadNetworkDef, type NetworkIndex } from '@/domain/network';
import { fromHM } from '@/domain/time';
import { validateService } from '@/domain/validation';
import { suggestBlockId } from './suggest';

const routeJsonPath = fileURLToPath(new URL('../../../data/route.json', import.meta.url));
const loaded = loadNetworkDef(readFileSync(routeJsonPath, 'utf8'));
if (!loaded.ok) throw new Error('route.json を読み込めません');
const network: NetworkIndex = loaded.network;

/**
 * 便を作る。
 *
 * 吹田方面 S1（豊中学舎 → 工学部前、30 分）と豊中方面 T1（工学部前 → 豊中学舎、
 * 30 分）を組み合わせると、1 台の車が往復する運用になる。
 */
function makeTrip(
  tripId: string,
  patternId: string,
  hm: readonly [number, number] | null,
  blockId = '',
): Trip {
  const pattern = network.patternIndex(patternId);
  if (pattern === undefined) throw new Error(`パターン ${patternId} がありません`);
  return {
    tripId,
    patternId,
    anchor: hm === null ? null : { stopId: pattern.originStopId, time: fromHM(hm[0], hm[1]) },
    blockId,
  };
}

/** V-01・V-02 の指摘だけを取り出す。 */
function connectionIssues(trips: readonly Trip[]): string[] {
  return validateService(trips, network)
    .filter((issue) => issue.id === 'V-01' || issue.id === 'V-02')
    .map((issue) => `${issue.id}: ${issue.message}`);
}

describe('継ぎ先の選び方', () => {
  it('**終着停留所と時刻が繋がる運用を提案する**', () => {
    // A: 豊中 8:00 発 → 工学部前 8:30 着。次の便は工学部前 8:40 発。
    const existing = [makeTrip('t1', 'S1', [8, 0], 'A')];
    const next = makeTrip('t2', 'T1', [8, 40]);

    expect(suggestBlockId(next, existing, network)).toBe('A');
  });

  it('**停留所が繋がらなければ提案しない**', () => {
    // A は工学部前で終わる。豊中学舎発の便は継げない。
    const existing = [makeTrip('t1', 'S1', [8, 0], 'A')];
    const next = makeTrip('t2', 'S1', [9, 0]);

    expect(suggestBlockId(next, existing, network)).toBe('');
  });

  it('**時刻が繋がらなければ提案しない**（終着より前には発てない）', () => {
    const existing = [makeTrip('t1', 'S1', [8, 0], 'A')];
    const next = makeTrip('t2', 'T1', [8, 25]);

    expect(suggestBlockId(next, existing, network)).toBe('');
  });

  it('折返し 0 分でも提案する（下限は 0 分）', () => {
    const existing = [makeTrip('t1', 'S1', [8, 0], 'A')];
    const next = makeTrip('t2', 'T1', [8, 30]);

    expect(suggestBlockId(next, existing, network)).toBe('A');
  });

  it('**終着時刻が最も遅い運用を選ぶ**', () => {
    const existing = [
      makeTrip('t1', 'S1', [7, 0], 'A'), // 工学部前 7:30 着
      makeTrip('t2', 'S1', [8, 0], 'B'), // 工学部前 8:30 着
      makeTrip('t3', 'S1', [7, 30], 'C'), // 工学部前 8:00 着
    ];
    const next = makeTrip('t4', 'T1', [9, 0]);

    expect(suggestBlockId(next, existing, network)).toBe('B');
  });

  it('同着なら運用番号の昇順で決める', () => {
    const existing = [makeTrip('t1', 'S1', [8, 0], 'B'), makeTrip('t2', 'S1', [8, 0], 'A')];
    const next = makeTrip('t3', 'T1', [9, 0]);

    expect(suggestBlockId(next, existing, network)).toBe('A');
  });

  it('**運用の末尾だけを見る**（途中には割り込まない）', () => {
    // A は 工学部前 8:30 着 → 豊中 9:10 着 で終わる。工学部前 8:40 発の便は
    // 途中になら入るが、後続との繋がりを壊すため提案しない。
    const existing = [makeTrip('t1', 'S1', [8, 0], 'A'), makeTrip('t2', 'T1', [8, 40], 'A')];
    const next = makeTrip('t3', 'T1', [8, 45]);

    expect(suggestBlockId(next, existing, network)).toBe('');
  });

  it('**方向をまたいで継げる**（工学部前で折り返す）', () => {
    const existing = [makeTrip('t1', 'T1', [8, 0], 'A')]; // 工学部前 → 豊中 8:30 着
    const next = makeTrip('t2', 'S1', [8, 35]); // 豊中 8:35 発

    expect(suggestBlockId(next, existing, network)).toBe('A');
  });

  it('入庫した運用には継がない（営業所で終わっている）', () => {
    const existing = [makeTrip('t1', 'DS-in', [8, 0], 'A')]; // 工学部前 → 千里営業所
    const next = makeTrip('t2', 'S1', [9, 0]);

    expect(suggestBlockId(next, existing, network)).toBe('');
  });

  it('自分自身は継ぎ先にならない', () => {
    const trip = makeTrip('t1', 'S1', [8, 0], 'A');
    expect(suggestBlockId(trip, [trip], network)).toBe('');
  });

  it('運用番号が空欄の便は継ぎ先にならない（運用ではない）', () => {
    const existing = [makeTrip('t1', 'S1', [8, 0])];
    expect(suggestBlockId(makeTrip('t2', 'T1', [8, 40]), existing, network)).toBe('');
  });

  it('時刻の入っていない便には提案しない', () => {
    const existing = [makeTrip('t1', 'S1', [8, 0], 'A')];
    expect(suggestBlockId(makeTrip('t2', 'T1', null), existing, network)).toBe('');
  });

  it('参照が壊れた便には提案しない', () => {
    const existing = [makeTrip('t1', 'S1', [8, 0], 'A')];
    const broken: Trip = { ...makeTrip('t2', 'T1', [8, 40]), patternId: '無い' };
    expect(suggestBlockId(broken, existing, network)).toBe('');
  });

  it('継ぎ先が無いダイヤでは空欄のまま', () => {
    expect(suggestBlockId(makeTrip('t1', 'S1', [8, 0]), [], network)).toBe('');
  });
});

describe('受入条件: 提案が V-01・V-02 に違反しない', () => {
  /** 便を 1 つずつ足しながら、そのつど提案を当てはめていく。 */
  function buildWithSuggestions(seeds: readonly Trip[]): Trip[] {
    const trips: Trip[] = [];
    for (const seed of seeds) {
      // 提案するのは空欄のときだけ。人が付けた番号は上書きしない。
      const blockId = seed.blockId === '' ? suggestBlockId(seed, trips, network) : seed.blockId;
      trips.push({ ...seed, blockId });
    }
    return trips;
  }

  it('**往復を繰り返すダイヤで、提案だけで運用が組み上がる**', () => {
    const trips = buildWithSuggestions([
      makeTrip('t1', 'S1', [8, 0], 'A'), // 種。ここだけ人が付ける
      makeTrip('t2', 'T1', [8, 40], ''), // 工学部前 8:40 発
      makeTrip('t3', 'S1', [9, 20], ''), // 豊中 9:20 発
    ]);

    expect(trips.map((trip) => trip.blockId)).toEqual(['A', 'A', 'A']);
    expect(connectionIssues(trips)).toEqual([]);
  });

  it('**2 台が並行して走るダイヤでは、遅く着いた車から先に出す**', () => {
    const trips = buildWithSuggestions([
      makeTrip('t1', 'S1', [8, 0], 'A'), // 工学部前 8:30 着
      makeTrip('t2', 'S1', [8, 10], 'B'), // 工学部前 8:40 着
      makeTrip('t3', 'T1', [8, 40], ''), // 工学部前 8:40 発
      makeTrip('t4', 'T1', [8, 50], ''), // 工学部前 8:50 発
    ]);

    // 8:40 発には、8:40 に着いたばかりの B が付く。「終着時刻が最も遅いもの」
    // という規則（§6.1.5）は、**折返しが最も短くなる継ぎ方**を選ぶことを意味
    // する。停まっている時間の短い車から先に出す、という現場の考え方に合う。
    expect(trips.map((trip) => trip.blockId)).toEqual(['A', 'B', 'B', 'A']);
    expect(connectionIssues(trips)).toEqual([]);
  });

  it('**継げない便は空欄のままで、指摘を増やさない**', () => {
    const trips = buildWithSuggestions([
      makeTrip('t1', 'S1', [8, 0], 'A'),
      makeTrip('t2', 'S1', [8, 10], ''), // 豊中発。A は工学部前で終わっている
    ]);

    expect(trips[1]?.blockId).toBe('');
    expect(connectionIssues(trips)).toEqual([]);
  });

  it('回送を挟んだ運用でも繋がりを壊さない', () => {
    const trips = buildWithSuggestions([
      makeTrip('t1', 'DS-out', [7, 0], 'A'), // 千里営業所 → 工学部前
      makeTrip('t2', 'T1', [7, 30], ''), // 工学部前 → 豊中
      makeTrip('t3', 'DT-in', [8, 30], ''), // 豊中 → 千里営業所
    ]);

    expect(trips.map((trip) => trip.blockId)).toEqual(['A', 'A', 'A']);
    expect(connectionIssues(trips)).toEqual([]);
  });
});
