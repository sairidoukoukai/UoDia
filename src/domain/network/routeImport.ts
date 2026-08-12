/**
 * 別の文書から路線を取り込む（#235、T-91）。**純関数のみ。**
 *
 * ## 失われた「1 か所直せば効く」の代わりである
 *
 * 路線が `route.json` 1 つだったころは、そこを直せば全部の文書に効いた。文書の
 * 中へ移した以上（T-89）、**新経路を足すたびに全文書を手で直すことになる。**
 * それを避けるための操作である。
 *
 * ## 当てる前に何が変わるかを出す
 *
 * 路線を差し替えると、**便が指しているパターンが消えることがある。** 当ててから
 * 「時刻が出ない便が 12 件」では遅い——取り込みは 1 操作で全便に及ぶ。
 *
 * 直せるかどうかではなく、**起きることを先に見せる**。取り消せる操作であっても、
 * 起きてから気づくのと、起きる前に知るのとでは値打ちが違う。
 */

import type { NetworkDef, Project, StopPattern, Trip } from '@/domain/model';

/** 増えたものと減ったもの。**名前で並べる**（同じ入力から同じ順で出る）。 */
export interface RouteChange {
  readonly added: readonly string[];
  readonly removed: readonly string[];
}

/** 取り込むと参照が壊れる便。 */
export interface BrokenTrip {
  readonly tripId: string;
  /** 指していたパターン。取り込む路線には無い。 */
  readonly patternId: string;
  /** どのダイヤの便か。 */
  readonly serviceId: string;
}

/** 取り込むと何が起きるか。 */
export interface RouteImportSummary {
  readonly stops: RouteChange;
  readonly segments: RouteChange;
  readonly patterns: RouteChange;
  /**
   * 参照が壊れる便。**空なら何も失われない。**
   *
   * 壊れることそのものは止めない（読込と同じく既定パターンへ倒れる）。
   * **黙って起こさない**ことだけを引き受ける。
   */
  readonly brokenTrips: readonly BrokenTrip[];
  /** 何も変わらないか。**同じ路線を取り込んでも操作にしない。** */
  readonly unchanged: boolean;
}

/** 区間を 1 つの名前で表す。**向きを含める**——片道だけ直すことがある。 */
function segmentName(from: string, to: string): string {
  return `${from} → ${to}`;
}

function changeOf(current: readonly string[], incoming: readonly string[]): RouteChange {
  const before = new Set(current);
  const after = new Set(incoming);
  return {
    added: incoming.filter((name) => !before.has(name)).sort(),
    removed: current.filter((name) => !after.has(name)).sort(),
  };
}

/** 便が指しているパターンのうち、取り込む路線に無いもの。 */
function brokenTripsOf(project: Project, incoming: NetworkDef): BrokenTrip[] {
  const known = new Set(incoming.patterns.map((pattern: StopPattern) => pattern.patternId));
  const broken: BrokenTrip[] = [];

  for (const service of project.services) {
    for (const trip of service.trips as readonly Trip[]) {
      if (known.has(trip.patternId)) continue;
      broken.push({
        tripId: trip.tripId,
        patternId: trip.patternId,
        serviceId: service.serviceId,
      });
    }
  }

  return broken;
}

/**
 * 取り込むと何が起きるかを数える。**状態は変えない。**
 *
 * @param project いま開いている文書
 * @param incoming 取り込む路線
 */
export function summarizeRouteImport(project: Project, incoming: NetworkDef): RouteImportSummary {
  const current = project.network;

  const stops = changeOf(
    current.stops.map((stop) => stop.stopName),
    incoming.stops.map((stop) => stop.stopName),
  );
  const segments = changeOf(
    current.segments.map((s) => segmentName(s.fromStopId, s.toStopId)),
    incoming.segments.map((s) => segmentName(s.fromStopId, s.toStopId)),
  );
  const patterns = changeOf(
    current.patterns.map((p) => p.patternId),
    incoming.patterns.map((p) => p.patternId),
  );

  const brokenTrips = brokenTripsOf(project, incoming);

  return {
    stops,
    segments,
    patterns,
    brokenTrips,
    // **増減だけでは足りない。** 所要時間だけを直した路線は、増えも減りもしない。
    unchanged: JSON.stringify(current) === JSON.stringify(incoming),
  };
}

/** 増減の総数。**0 でも `unchanged` とは限らない**（所要時間だけの変更）。 */
export function changeCount(change: RouteChange): number {
  return change.added.length + change.removed.length;
}
