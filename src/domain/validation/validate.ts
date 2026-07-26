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
import { deriveBlocks, type Block, type BlockTrip } from '@/domain/block';
import { diffMinutes, formatTime, type Seconds } from '@/domain/time';
import { allTimes } from '@/domain/trip';
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
  const { blocks, unassigned, unresolved } = deriveBlocks(trips, network);
  const service = resolveServiceTrips(trips, network);

  return [
    ...blocks.flatMap((block) => checkBlockConnection(block)),
    ...blocks.flatMap((block) => checkBlockOverlap(block)),
    ...blocks.flatMap((block) => checkBlockEnds(block)),
    ...checkOvertaking(service),
    ...checkHeadway(service, thresholds),
    ...unassigned.map((trip) => issue('V-07', '運用番号が空欄です', { tripId: trip.tripId })),
    ...unresolved.map((trip) =>
      issue('V-08', '時刻を導出できません（アンカーが未設定か、参照が壊れています）', {
        tripId: trip.tripId,
      }),
    ),
    ...blocks.flatMap((block) => checkStandby(block, thresholds)),
  ];
}

function issue(id: ValidationId, message: string, target: ValidationTarget): ValidationIssue {
  return { id, severity: SEVERITY_OF[id], message, target };
}

/**
 * V-01: 同一運用内で、前便の終着停留所と次便の始発停留所が一致すること。
 *
 * V-02: 同一運用内で、折返し時分が負でないこと（仕様書 §2.2）。0 分は正常値。
 */
function checkBlockConnection(block: Block): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  let previous: BlockTrip | undefined;

  for (const current of block.trips) {
    if (previous !== undefined) {
      if (previous.terminalStopId !== current.originStopId) {
        issues.push(
          issue(
            'V-01',
            `前の便は ${previous.terminalStopId} 着ですが、この便は ${current.originStopId} 発です`,
            { blockId: block.blockId, tripId: current.trip.tripId },
          ),
        );
      }
      if (current.layoverMinutes !== null && current.layoverMinutes < 0) {
        issues.push(
          issue(
            'V-02',
            `前の便の終着 ${formatTime(previous.terminalTime)} より前に発車します（${formatTime(current.originTime)}）`,
            { blockId: block.blockId, tripId: current.trip.tripId },
          ),
        );
      }
    }
    previous = current;
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
        issues.push(
          issue(
            'V-03',
            `${formatTime(earlier.originTime)}〜${formatTime(earlier.terminalTime)} の便と運行時間帯が重複しています`,
            { blockId: block.blockId, tripId: later.trip.tripId },
          ),
        );
      }
    }
  }

  return issues;
}

/** V-04: 運用の先頭便が出庫回送であり、末尾便が入庫回送であること。 */
function checkBlockEnds(block: Block): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (block.pullOutTime === null) {
    issues.push(issue('V-04', '運用の先頭が出庫回送ではありません', { blockId: block.blockId }));
  }
  if (block.pullInTime === null) {
    issues.push(issue('V-04', '運用の末尾が入庫回送ではありません', { blockId: block.blockId }));
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
 * V-05: 同方向の便が追い越さないこと。
 *
 * **同一パターンの便は追い越し得ない。** 同じパターンなら区間所要時間も同じで
 * あり、先に出た便が必ず先に着く。仕様書の「同一パターンの便が追い越している」を
 * そのまま実装すると、決して成立しない条件を検査することになる。
 *
 * 実際に起こり、かつ意味があるのは**パターンをまたぐ追い越し**である。直行便が
 * 箕面学舎経由の便を追い抜く、といった状況がそれにあたる。そこで、同方向の 2 便が
 * ともに通る停留所を比べ、前後関係が入れ替わっていれば報告する。
 */
function checkOvertaking(service: readonly ServiceTrip[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  for (const [index, a] of service.entries()) {
    for (const b of service.slice(index + 1)) {
      if (a.pattern.pattern.directionId !== b.pattern.pattern.directionId) continue;
      if (!overtakes(a, b)) continue;
      issues.push(
        issue('V-05', `${b.trip.patternId} の便と追い越しが発生しています`, {
          tripId: a.trip.tripId,
        }),
      );
    }
  }

  return issues;
}

/** 2 便がともに通る停留所で、前後関係が入れ替わるか。 */
function overtakes(a: ServiceTrip, b: ServiceTrip): boolean {
  let sawAhead = false;
  let sawBehind = false;

  for (const [stopId, timeA] of a.times) {
    const timeB = b.times.get(stopId);
    if (timeB === undefined) continue;
    if (timeA < timeB) sawAhead = true;
    if (timeA > timeB) sawBehind = true;
  }

  return sawAhead && sawBehind;
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

    let previous: Passing | undefined;
    for (const current of sorted) {
      if (previous !== undefined) {
        const gap = diffMinutes(current.time, previous.time);
        if (gap < thresholds.minHeadwayMinutes) {
          issues.push(
            issue('V-06', `${stopId} で前の便との間隔が ${String(gap)} 分しかありません`, {
              tripId: current.tripId,
            }),
          );
        } else if (gap > thresholds.maxHeadwayMinutes) {
          issues.push(
            issue('V-06', `${stopId} で前の便との間隔が ${String(gap)} 分空いています`, {
              tripId: current.tripId,
            }),
          );
        }
      }
      previous = current;
    }
  }

  return issues;
}
