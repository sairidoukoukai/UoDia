/**
 * ダイヤ検証（仕様書 §6.6）。
 *
 * 編集のたびに全便を走査して問題を集める。100 便規模では十分に速く、差分更新も
 * Web Worker も要らない（仕様書 §9.1）。
 *
 * 検証は**導出結果に対して行う**。運用の行路や折返し時分は T-09 が求めたものを
 * そのまま受け取り、ここでは判定だけを行う。導出と判定を同じ場所に置くと、
 * 検証を通らないデータを編集中に画面へ出せなくなる。
 */

import type { Trip } from '@/domain/model';
import type { NetworkIndex, PatternIndex } from '@/domain/network';
import { deriveBlocks, type Block } from '@/domain/block';
import { diffMinutes, formatTime, type Seconds } from '@/domain/time';
import { allTimes, createPullIn, createPullOut, sourceTripId } from '@/domain/trip';
import { adjacentPairs } from '@/domain/util';
import {
  DEFAULT_THRESHOLDS,
  SEVERITY_OF,
  type ValidationId,
  type ValidationIssue,
  type ValidationTarget,
  type ValidationThresholds,
} from './types';

/**
 * ダイヤを検証する。
 *
 * 結果は検証項目 ID の昇順に並ぶ。ID の順は重大度の順（エラー → 警告 → 情報）
 * でもあるため、そのまま検証パネルの表示順に使える。
 */
export function validateService(
  trips: readonly Trip[],
  network: NetworkIndex,
  thresholds: ValidationThresholds = DEFAULT_THRESHOLDS,
): ValidationIssue[] {
  const { blocks, unassigned, unanchored, unresolved } = deriveBlocks(trips, network);
  const service = resolveServiceTrips(trips, network);

  return [
    ...blocks.flatMap((block) => checkBlockConnection(block, network)),
    ...blocks.flatMap((block) => checkBlockOverlap(block)),
    ...unresolved.map((trip) =>
      issue(
        'V-04',
        'この便の時刻を導出できません。停車パターンまたはアンカーの参照が壊れています',
        {
          tripId: trip.tripId,
        },
      ),
    ),
    ...checkDeadheads(trips, network),
    ...blocks.flatMap((block) => checkBlockEnds(block)),
    ...checkHeadway(service, thresholds, network),
    ...unassigned.map((trip) => issue('V-07', '運用番号が空欄です', { tripId: trip.tripId })),
    ...unanchored.map((trip) => issue('V-08', '時刻が入力されていません', { tripId: trip.tripId })),
    ...blocks.flatMap((block) => checkStandby(block, thresholds)),
  ];
}

/**
 * 停留所の名前。
 *
 * **指摘は名前で言う。** 読んで直すためのものであり、`4_0` と書かれてもどこの
 * 話か分からない。名前が引けない ID（壊れた参照）はそのまま出す——伏せると、
 * 何が壊れているのかを確かめる手立てが消える。
 *
 * 出すのは**画面に出ているのと同じ略称**である（#116）。指摘を読んだ人が探すのは
 * ダイヤグラムの縦軸と時刻表の行であり、そこに「コンベ前」と書いてあるのに
 * 「コンベンションセンター前」と言われても、同じ停留所だと確かめる手間が要る。
 */
function stopLabelOf(stopId: string, network: NetworkIndex): string {
  return network.findStop(stopId)?.shortName ?? stopId;
}

/**
 * 指摘を 1 件作る。
 *
 * **指し先は保存されている便に戻す**（`sourceTripId`）。運用の中で問題を起こして
 * いるのが展開した回送便であることは珍しくないが、回送便には列が無い
 * （仕様書 §6.1.7）。`t3#out` を指されても、利用者はどこも見られない。
 */
function issue(id: ValidationId, message: string, target: ValidationTarget): ValidationIssue {
  return {
    id,
    severity: SEVERITY_OF[id],
    message,
    target:
      target.tripId === undefined ? target : { ...target, tripId: sourceTripId(target.tripId) },
  };
}

/**
 * 2 便の関係が問題である指摘を、**両側から 1 件ずつ**出す（T-61、#165）。
 *
 * 時刻表では、指摘のある便の列に印を付ける（仕様書 v1.1 §5.2）。片方だけを
 * 指すと、**どちらが悪いのかを探すことになる。**
 *
 * **1 件に 2 便を持たせる形は採らない。** そうすると文面を片方の視点でしか
 * 書けず、前の便の列に「前の便の終着より前に発車します」と出る——**その便は
 * 早発していないのに、その便の説明として読める。** 件数は倍になるが、
 * どちらの列から見ても意味の通る文が出るほうを採る。
 *
 * **同じ便を 2 度指すことは起こらない。** 展開した回送便は保存されている便へ
 * 戻されるため（`sourceTripId`）、便とその出入区が対になれば同じ列を 2 度指す
 * ことになるが、**その対が指摘されることはない**——出入区は `createPullOut` /
 * `createPullIn` が作るものであり、接続する停留所は必ず一致し（V-01 が出ない）、
 * 折返しは 0 分である（V-02 が出ない）。V-03 が見る「1 つ以上離れた便」で
 * 出区と入区が重なるには、便の終着が始発より前になる必要がある。
 * **起こり得ない場合のために分岐を書かない。**
 */
function pairIssue(
  id: ValidationId,
  earlier: { readonly tripId: string; readonly message: string },
  later: { readonly tripId: string; readonly message: string },
  blockId?: string,
): ValidationIssue[] {
  const base = blockId === undefined ? {} : { blockId };
  return [
    issue(id, earlier.message, { ...base, tripId: earlier.tripId }),
    issue(id, later.message, { ...base, tripId: later.tripId }),
  ];
}

/**
 * V-04: 出区・入区の車庫側の時刻が表せる範囲を外れていないこと（仕様書 §6.1.7）。
 *
 * 0:10 発の便に出区を付けると車庫発は前日 23:50 となり、表せない。回送便は
 * 展開されないまま消えるため、**黙っていると「押したのに何も起きない」に
 * なる**。時刻が未入力の便は対象外——回送の時刻も決まらないのは当然である。
 */
function checkDeadheads(trips: readonly Trip[], network: NetworkIndex): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  for (const trip of trips) {
    if (trip.anchor === null) continue;
    if (trip.pullOut && createPullOut(trip, network) === null) {
      issues.push(
        issue('V-04', 'この便の出区を作れません（車庫発の時刻を表せません）', {
          tripId: trip.tripId,
        }),
      );
    }
    if (trip.pullIn && createPullIn(trip, network) === null) {
      issues.push(
        issue('V-04', 'この便の入区を作れません（車庫着の時刻を表せません）', {
          tripId: trip.tripId,
        }),
      );
    }
  }

  return issues;
}

/**
 * V-01: 同一運用内で、前便の終着停留所と次便の始発停留所が一致すること。
 *
 * V-02: 同一運用内で、折返し時分が負でないこと（仕様書 §2.2）。0 分は正常値。
 */
function checkBlockConnection(block: Block, network: NetworkIndex): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  for (const [previous, current] of adjacentPairs(block.trips)) {
    if (previous.terminalStopId !== current.originStopId) {
      const from = stopLabelOf(previous.terminalStopId, network);
      const to = stopLabelOf(current.originStopId, network);
      issues.push(
        ...pairIssue(
          'V-01',
          {
            tripId: previous.trip.tripId,
            message: `この便は ${from} 着ですが、次の便は ${to} 発です`,
          },
          {
            tripId: current.trip.tripId,
            message: `前の便は ${from} 着ですが、この便は ${to} 発です`,
          },
          block.blockId,
        ),
      );
    }
    if (current.layoverMinutes !== null && current.layoverMinutes < 0) {
      const terminal = formatTime(previous.terminalTime);
      const origin = formatTime(current.originTime);
      issues.push(
        ...pairIssue(
          'V-02',
          {
            tripId: previous.trip.tripId,
            message: `次の便がこの便の終着 ${terminal} より前に発車します（${origin}）`,
          },
          {
            tripId: current.trip.tripId,
            message: `前の便の終着 ${terminal} より前に発車します（${origin}）`,
          },
          block.blockId,
        ),
      );
    }
  }

  return issues;
}

/**
 * V-03: 同一運用内で、2 便の運行時間帯が重複しないこと。
 *
 * **隣り合う便どうしの重複は V-02 が報告する**ため、ここでは 1 つ以上離れた便との
 * 重複だけを見る。隣り合う便の重複は「折返し時分が負」と同じ事象であり、両方の
 * 項目で報告すると同じ問題が 2 度並ぶ。離れた便との重複は V-02 では捉えられない
 * （例: 長い便 1 本の途中に短い便が 2 本収まっている場合）。
 */
function checkBlockOverlap(block: Block): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  for (const [index, earlier] of block.trips.entries()) {
    // 添字ではなく要素を直接受け取る。添字アクセスは noUncheckedIndexedAccess の
    // もとで undefined を含み、到達し得ない分岐を書く羽目になるため。
    for (const later of block.trips.slice(index + 2)) {
      if (later.originTime < earlier.terminalTime) {
        const span = (t: typeof earlier): string =>
          `${formatTime(t.originTime)}〜${formatTime(t.terminalTime)}`;
        issues.push(
          ...pairIssue(
            'V-03',
            {
              tripId: earlier.trip.tripId,
              message: `${span(later)} の便と運行時間帯が重複しています`,
            },
            {
              tripId: later.trip.tripId,
              message: `${span(earlier)} の便と運行時間帯が重複しています`,
            },
            block.blockId,
          ),
        );
      }
    }
  }

  return issues;
}

/** V-05: 運用の先頭便が出庫回送であり、末尾便が入庫回送であること。 */
function checkBlockEnds(block: Block): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (block.pullOutTime === null) {
    issues.push(issue('V-05', '運用の先頭が出庫回送ではありません', { blockId: block.blockId }));
  }
  if (block.pullInTime === null) {
    issues.push(issue('V-05', '運用の末尾が入庫回送ではありません', { blockId: block.blockId }));
  }
  return issues;
}

/** V-09: 営業所待機が短すぎないこと。停留所で待機できる可能性がある。 */
function checkStandby(block: Block, thresholds: ValidationThresholds): ValidationIssue[] {
  return block.standbys
    .filter((standby) => standby.minutes < thresholds.minStandbyMinutes)
    .map((standby) =>
      issue(
        'V-09',
        `営業所待機が ${String(standby.minutes)} 分です。入庫せず停留所で待機できる可能性があります`,
        { blockId: block.blockId, tripId: standby.inboundTripId },
      ),
    );
}

/** 時刻を導出できた営業便。回送は営業上の関係を持たないため含めない。 */
interface ServiceTrip {
  readonly trip: Trip;
  readonly pattern: PatternIndex;
  readonly times: ReadonlyMap<string, Seconds>;
}

function resolveServiceTrips(trips: readonly Trip[], network: NetworkIndex): ServiceTrip[] {
  const resolved: ServiceTrip[] = [];
  for (const trip of trips) {
    const pattern = network.patternIndex(trip.patternId);
    if (pattern === undefined || pattern.pattern.isDeadhead) continue;
    const times = allTimes(trip, network);
    if (times.size === 0) continue;
    resolved.push({ trip, pattern, times });
  }
  return resolved;
}

/**
 * V-06: 同方向の便の間隔が極端でないこと。
 *
 * 間隔は**停留所ごとに**測る。便によって始発停留所が違うため（豊中学舎発・
 * 箕面学舎発・工学部前発）、始発時刻の差を間隔と呼ぶと、利用者から見た待ち時間と
 * かけ離れた値になる。ある停留所を通る同方向の便を時刻順に並べ、隣り合う便の差を
 * 見るのが、待ち時間そのものである。
 */
function checkHeadway(
  service: readonly ServiceTrip[],
  thresholds: ValidationThresholds,
  network: NetworkIndex,
): ValidationIssue[] {
  interface Passing {
    readonly tripId: string;
    readonly time: Seconds;
  }
  const byStop = new Map<string, { readonly stopId: string; readonly passings: Passing[] }>();

  for (const { trip, pattern, times } of service) {
    for (const [stopId, time] of times) {
      const key = `${String(pattern.pattern.directionId)}@${stopId}`;
      const group = byStop.get(key);
      if (group === undefined) {
        byStop.set(key, { stopId, passings: [{ tripId: trip.tripId, time }] });
      } else {
        group.passings.push({ tripId: trip.tripId, time });
      }
    }
  }

  const issues: ValidationIssue[] = [];
  for (const { stopId, passings } of byStop.values()) {
    const sorted = [...passings].sort(
      (x, y) => x.time - y.time || x.tripId.localeCompare(y.tripId),
    );

    for (const [previous, current] of adjacentPairs(sorted)) {
      const gap = diffMinutes(current.time, previous.time);
      const where = stopLabelOf(stopId, network);
      const how = gap < thresholds.minHeadwayMinutes ? 'しかありません' : '空いています';
      if (gap < thresholds.minHeadwayMinutes || gap > thresholds.maxHeadwayMinutes) {
        issues.push(
          ...pairIssue(
            'V-06',
            {
              tripId: previous.tripId,
              message: `${where} で次の便との間隔が ${String(gap)} 分${how}`,
            },
            {
              tripId: current.tripId,
              message: `${where} で前の便との間隔が ${String(gap)} 分${how}`,
            },
          ),
        );
      }
    }
  }

  return issues;
}
