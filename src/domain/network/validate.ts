/**
 * ネットワーク定義の意味的な検証（仕様書 §5.5.2）。
 *
 * スキーマ検証（T-04）が「JSON の形」を見るのに対し、本モジュールは
 * 「データの内容が矛盾していないか」を見る。両者を分けることで、エラーの
 * 原因がどちらなのかを利用者に切り分けて示せる。
 *
 * 検証結果は規則 ID と対象要素を持つ構造化エラーとして返す。UI から該当箇所へ
 * ジャンプできるようにするため、文字列メッセージだけにはしない。
 */

import type { DirectionId, NetworkDef, StopPattern } from '@/domain/model';
import { adjacentPairs } from '@/domain/util';

/** 検証規則の識別子。仕様書 §5.5.2 の表に対応する。 */
export type NetworkRule =
  'R-01' | 'R-02' | 'R-03' | 'R-04' | 'R-05' | 'R-06' | 'R-07' | 'R-08' | 'R-09' | 'R-10' | 'R-11';

/** 問題のある要素への参照。 */
export type NetworkIssueTarget =
  | { readonly kind: 'stop'; readonly stopId: string }
  | { readonly kind: 'segment'; readonly fromStopId: string; readonly toStopId: string }
  | { readonly kind: 'pattern'; readonly patternId: string }
  | { readonly kind: 'patternStop'; readonly patternId: string; readonly index: number }
  | { readonly kind: 'direction'; readonly directionId: DirectionId };

export interface NetworkIssue {
  readonly rule: NetworkRule;
  readonly message: string;
  readonly target: NetworkIssueTarget;
}

/** 区間表を引くためのキー。有向であることを明示するため矢印を用いる。 */
export function segmentKey(fromStopId: string, toStopId: string): string {
  return `${fromStopId}→${toStopId}`;
}

/**
 * ネットワーク定義を検証する。
 *
 * 問題が無ければ空配列を返す。1 つ目の違反で打ち切らず、すべての問題を集めて
 * 返す。`route.json` を手で直す際、1 件ずつ直しては再実行する手間を避けるため。
 */
export function validateNetwork(network: NetworkDef): NetworkIssue[] {
  return [
    ...checkRunMinutes(network),
    ...checkStopReferences(network),
    ...checkDuplicateStopIds(network),
    ...checkSegmentsCoverPatterns(network),
    ...checkDuplicateSegments(network),
    ...checkDefaultPatterns(network),
    ...checkPatternLength(network),
    ...checkDepotPatterns(network),
    ...checkDuplicatePatternIds(network),
    ...checkDuplicateStopsInPattern(network),
    ...checkConnectingDeadheads(network),
  ];
}

/**
 * R-01: すべての `runMinutes` が 5 の倍数であること。
 *
 * スキーマ（`runMinutesSchema`）でも検証しているため、`loadNetworkDef` 経由では
 * 発火しない。隠し設定（T-36）が編集中のデータを保存前に検証する経路では
 * スキーマを通らないため、ここでも確認する。
 */
function checkRunMinutes(network: NetworkDef): NetworkIssue[] {
  return network.segments
    .filter((s) => s.runMinutes % 5 !== 0)
    .map((s) => ({
      rule: 'R-01' as const,
      message: `区間 ${segmentKey(s.fromStopId, s.toStopId)} の所要時間 ${String(s.runMinutes)} 分が 5 の倍数ではありません`,
      target: { kind: 'segment' as const, fromStopId: s.fromStopId, toStopId: s.toStopId },
    }));
}

/** R-02: 停留所への参照がすべて実在すること。 */
function checkStopReferences(network: NetworkDef): NetworkIssue[] {
  const stopIds = new Set(network.stops.map((s) => s.stopId));
  const issues: NetworkIssue[] = [];

  for (const pattern of network.patterns) {
    pattern.stopSequence.forEach((patternStop, index) => {
      if (!stopIds.has(patternStop.stopId)) {
        issues.push({
          rule: 'R-02',
          message: `パターン ${pattern.patternId} の ${String(index + 1)} 番目が参照する停留所 ${patternStop.stopId} は存在しません`,
          target: { kind: 'patternStop', patternId: pattern.patternId, index },
        });
      }
    });
  }

  for (const segment of network.segments) {
    for (const [role, stopId] of [
      ['始点', segment.fromStopId],
      ['終点', segment.toStopId],
    ] as const) {
      if (!stopIds.has(stopId)) {
        issues.push({
          rule: 'R-02',
          message: `区間 ${segmentKey(segment.fromStopId, segment.toStopId)} の${role}が参照する停留所 ${stopId} は存在しません`,
          target: {
            kind: 'segment',
            fromStopId: segment.fromStopId,
            toStopId: segment.toStopId,
          },
        });
      }
    }
  }

  return issues;
}

/**
 * R-08: `stopId` が重複しないこと。
 *
 * 仕様書 §5.5.2 には無かった規則。重複すると停留所の検索が先勝ちになり、
 * 参照の意味が静かに壊れるため追加した。
 */
function checkDuplicateStopIds(network: NetworkDef): NetworkIssue[] {
  return findDuplicates(network.stops.map((s) => s.stopId)).map((stopId) => ({
    rule: 'R-08' as const,
    message: `停留所 ${stopId} が重複して定義されています`,
    target: { kind: 'stop' as const, stopId },
  }));
}

/**
 * R-03: すべてのパターンの隣接停留所対が `segments` に存在すること。
 *
 * **最も重要な規則。** 欠けていると、そのパターンを使う便の時刻が計算できない。
 * どの区間が足りないかをメッセージに明示する（T-36 の受入条件）。
 */
function checkSegmentsCoverPatterns(network: NetworkDef): NetworkIssue[] {
  const known = new Set(network.segments.map((s) => segmentKey(s.fromStopId, s.toStopId)));
  const issues: NetworkIssue[] = [];

  for (const pattern of network.patterns) {
    for (const [from, to, index] of adjacentPairs(pattern.stopSequence)) {
      const key = segmentKey(from.stopId, to.stopId);
      if (!known.has(key)) {
        issues.push({
          rule: 'R-03',
          message: `パターン ${pattern.patternId} が使う区間 ${key} が区間表にありません`,
          target: { kind: 'patternStop', patternId: pattern.patternId, index },
        });
      }
    }
  }

  return issues;
}

/** R-04: `segments` に同じ `(fromStopId, toStopId)` の重複がないこと。 */
function checkDuplicateSegments(network: NetworkDef): NetworkIssue[] {
  const keys = network.segments.map((s) => segmentKey(s.fromStopId, s.toStopId));
  return findDuplicates(keys).map((key) => {
    const [fromStopId = '', toStopId = ''] = key.split('→');
    return {
      rule: 'R-04' as const,
      message: `区間 ${key} が重複して定義されています`,
      target: { kind: 'segment' as const, fromStopId, toStopId },
    };
  });
}

/** R-05: 各方向に `isDefault` かつ営業のパターンがちょうど 1 つあること。 */
function checkDefaultPatterns(network: NetworkDef): NetworkIssue[] {
  const issues: NetworkIssue[] = [];

  for (const directionId of [0, 1] as const) {
    const defaults = network.patterns.filter(
      (p) => p.directionId === directionId && p.isDefault && !p.isDeadhead,
    );
    if (defaults.length !== 1) {
      issues.push({
        rule: 'R-05',
        message: `方向 ${String(directionId)} の既定パターンが ${String(defaults.length)} 件あります（1 件でなければなりません）`,
        target: { kind: 'direction', directionId },
      });
    }
  }

  return issues;
}

/** R-06: すべてのパターンの `stopSequence` が 2 要素以上であること。 */
function checkPatternLength(network: NetworkDef): NetworkIssue[] {
  return network.patterns
    .filter((p) => p.stopSequence.length < 2)
    .map((p) => ({
      rule: 'R-06' as const,
      message: `パターン ${p.patternId} の停留所が ${String(p.stopSequence.length)} 件しかありません（2 件以上必要です）`,
      target: { kind: 'pattern' as const, patternId: p.patternId },
    }));
}

/**
 * R-07: 営業所を含むパターンは回送であり、回送は営業所を含むこと。
 *
 * 営業所に営業便が発着したり、営業所を通らない回送が定義されたりすると、
 * 運用の入出庫判定（T-09）が成り立たなくなる。
 */
function checkDepotPatterns(network: NetworkDef): NetworkIssue[] {
  const depotIds = new Set(network.stops.filter((s) => s.isDepot).map((s) => s.stopId));

  const includesDepot = (pattern: StopPattern): boolean =>
    pattern.stopSequence.some((ps) => depotIds.has(ps.stopId));

  return network.patterns
    .filter((p) => includesDepot(p) !== p.isDeadhead)
    .map((p) => ({
      rule: 'R-07' as const,
      message: p.isDeadhead
        ? `回送パターン ${p.patternId} が営業所を含んでいません`
        : `営業パターン ${p.patternId} が営業所を含んでいます`,
      target: { kind: 'pattern' as const, patternId: p.patternId },
    }));
}

/**
 * R-09: `patternId` が重複しないこと。
 *
 * R-08 と同じ理由で追加した規則。便は `patternId` でパターンを参照するため、
 * 重複すると便の経路が定まらない。
 */
function checkDuplicatePatternIds(network: NetworkDef): NetworkIssue[] {
  return findDuplicates(network.patterns.map((p) => p.patternId)).map((patternId) => ({
    rule: 'R-09' as const,
    message: `パターン ${patternId} が重複して定義されています`,
    target: { kind: 'pattern' as const, patternId },
  }));
}

/**
 * R-10: 1 つのパターン内に同じ停留所が 2 回以上現れないこと。
 *
 * **アンカー方式（仕様書 §5.6）の前提そのもの。** `Trip.anchor` は停留所を
 * `stopId` だけで指すため、同じ停留所が 2 回現れるとアンカーがどちらの通過を
 * 指すのか決まらず、時刻の導出が定義できない。始発と終着が同じ停留所になる
 * 循環経路もこの規則で禁じられる。
 *
 * この規則が成り立つおかげで、T-07 の累積所要時間を `Map<stopId, minutes>` で
 * 保持できる。
 */
function checkDuplicateStopsInPattern(network: NetworkDef): NetworkIssue[] {
  const issues: NetworkIssue[] = [];

  for (const pattern of network.patterns) {
    const seen = new Map<string, number>();
    pattern.stopSequence.forEach((patternStop, index) => {
      const first = seen.get(patternStop.stopId);
      if (first === undefined) {
        seen.set(patternStop.stopId, index);
      } else {
        issues.push({
          rule: 'R-10',
          message: `パターン ${pattern.patternId} の ${String(index + 1)} 番目の停留所 ${patternStop.stopId} は ${String(first + 1)} 番目にも現れています`,
          target: { kind: 'patternStop', patternId: pattern.patternId, index },
        });
      }
    });
  }

  return issues;
}

/**
 * R-11: すべての営業パターンに、繋がる出庫回送と入庫回送があること。
 *
 * 回送便は保存されず、営業便の始発・終着停留所から引かれる（仕様書 §6.1.7）。
 * 引けないパターンがあると、**利用者が出区を押した瞬間に「作れません」と言う
 * ほかなくなる**。それは編集中に起こる不具合ではなく `route.json` の不備であり、
 * 起動時に判る場所へ移す。
 */
function checkConnectingDeadheads(network: NetworkDef): NetworkIssue[] {
  const depotIds = new Set(network.stops.filter((s) => s.isDepot).map((s) => s.stopId));
  const deadheads = network.patterns.filter((p) => p.isDeadhead);

  const ends = (pattern: StopPattern): { origin: string; terminal: string } | null => {
    const origin = pattern.stopSequence.at(0)?.stopId;
    const terminal = pattern.stopSequence.at(-1)?.stopId;
    // 停留所が 2 件に満たないパターンは R-06 が報告する。ここでは黙って見送る。
    return origin === undefined || terminal === undefined ? null : { origin, terminal };
  };

  const issues: NetworkIssue[] = [];

  for (const pattern of network.patterns) {
    if (pattern.isDeadhead) continue;
    const service = ends(pattern);
    if (service === null) continue;

    const hasPullOut = deadheads.some((d) => {
      const e = ends(d);
      return e !== null && depotIds.has(e.origin) && e.terminal === service.origin;
    });
    const hasPullIn = deadheads.some((d) => {
      const e = ends(d);
      return e !== null && e.origin === service.terminal && depotIds.has(e.terminal);
    });

    for (const [ok, what, stopId] of [
      [hasPullOut, '出庫', service.origin],
      [hasPullIn, '入庫', service.terminal],
    ] as const) {
      if (ok) continue;
      issues.push({
        rule: 'R-11',
        message: `営業パターン ${pattern.patternId} に繋がる${what}回送がありません（${stopId} と営業所を結ぶ回送パターンが要ります）`,
        target: { kind: 'pattern', patternId: pattern.patternId },
      });
    }
  }

  return issues;
}

/** 重複している値を、最初に重複が判明した順で返す。 */
function findDuplicates(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const duplicated = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      duplicated.add(value);
    }
    seen.add(value);
  }
  return [...duplicated];
}

/** 問題の一覧を人が読める複数行の文にする。 */
export function formatNetworkIssues(issues: readonly NetworkIssue[]): string {
  return issues.map((i) => `[${i.rule}] ${i.message}`).join('\n');
}
