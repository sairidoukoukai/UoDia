/**
 * 折返しの接続線（T-62、#167、仕様書 v1.1 §5.3）。
 *
 * 運用で着色すれば同じ運用の便は同じ色になる。**それでも、どの便がどの便に
 * 繋がるかは読めない。** 同じ色のスジが画面に何本もあり、折返しで時間が空くほど
 * 繋がる相手が遠くなる。
 *
 * **前便の終着点から次便の始発点まで、水平に線を引く。** 結果として台形に
 * 見える——便のスジが下り、水平に留まり、また上る。issue が「台形」と呼んで
 * いるのはこの形であり、**台形を描く仕掛けを別に持つのではなく、留まっている
 * あいだを正直に描くと台形になる。**
 *
 * **曲線は採らない。** ダイヤグラムでは線の傾きが移動の速さを表す。折返しの
 * あいだバスは動いていないのだから、傾きは 0 である。
 *
 * ここは純関数だけを置く。描く側は渡された段（`level`）に px を掛けるだけで
 * よく、**拡大率も画面の大きさも知らずに済む**（実装計画書 v1.1 §4.3）。
 */

import type { Seconds } from '@/domain/time';

/** 接続線を求めるための、便 1 本の端点。 */
export interface BlockLinkEntry {
  readonly blockId: string;
  readonly originStopId: string;
  readonly originTime: Seconds;
  readonly terminalStopId: string;
  readonly terminalTime: Seconds;
  /** 始発・終着がどちらも縦軸に並ぶ停留所か。営業所は `false`。 */
  readonly onAxis: boolean;
}

/** 引く 1 本。 */
export interface SceneBlockLink {
  readonly blockId: string;
  readonly stopId: string;
  /** 前便の終着時刻。 */
  readonly from: Seconds;
  /** 次便の始発時刻。 */
  readonly to: Seconds;
  readonly color: string;
  /** 重なりを避けるための段。0 は停留所の線の上（ずらさない）。 */
  readonly level: number;
  /** 段をずらす向き。`-1` が上、`1` が下。 */
  readonly direction: -1 | 1;
}

/** 段をずらす向きを決めるための、停留所の軸位置。 */
export interface AxisPositions {
  readonly of: (stopId: string) => number | undefined;
  /** 軸の中点。これより上なら上へ、下（と同じ）なら下へ積む。 */
  readonly midpoint: number;
}

/**
 * 運用ごとの滞泊を求め、重なりを段に振り分ける。
 *
 * @param entries 便の端点。**同じ運用の中は始発時刻の昇順に並んでいなくてよい**
 * @param colorOf 運用番号 → 色。**着色モードによらず運用の色で引く**——繋がりは
 *   運用そのものの事実であり、パターンには属さない
 */
export function buildBlockLinks(
  entries: readonly BlockLinkEntry[],
  colorOf: (blockId: string) => string | undefined,
  axis: AxisPositions,
): readonly SceneBlockLink[] {
  const byBlock = new Map<string, BlockLinkEntry[]>();
  for (const entry of entries) {
    // **運用番号が空欄の便には引かない。** 繋ぐ相手が定義されていない。
    if (entry.blockId === '') continue;
    const group = byBlock.get(entry.blockId);
    if (group === undefined) byBlock.set(entry.blockId, [entry]);
    else group.push(entry);
  }

  const spans: SceneBlockLink[] = [];
  for (const [blockId, group] of byBlock) {
    const color = colorOf(blockId);
    if (color === undefined) continue;

    const sorted = [...group].sort((a, b) => a.originTime - b.originTime);
    for (const [previous, current] of adjacent(sorted)) {
      /*
       * 引く条件は 3 つ。**破綻したダイヤに線を引いて繋がっているように見せない。**
       *
       * - 停留所が一致しない → V-01（エラー）。繋がっていない
       * - 折返しが正でない   → 0 分なら長さ 0 の線であり、負なら V-02（エラー）
       * - 縦軸に無い         → 営業所には置き場所が無く（#118）、そこへ向かう線は
       *                        **意味の無い位置へ引いた線**になる
       */
      if (previous.terminalStopId !== current.originStopId) continue;
      if (current.originTime <= previous.terminalTime) continue;
      if (!previous.onAxis || !current.onAxis) continue;

      const stopId = previous.terminalStopId;
      const position = axis.of(stopId);
      if (position === undefined) continue;

      spans.push({
        blockId,
        stopId,
        from: previous.terminalTime,
        to: current.originTime,
        color,
        level: 0,
        direction: position < axis.midpoint ? -1 : 1,
      });
    }
  }

  return assignLevels(spans);
}

/**
 * 重なる接続線を段に振り分ける（仕様書 v1.1 §5.3.3）。
 *
 * 豊中学舎は `axisPosition: 0` であり、そこに留まる運用がいくつあっても線は
 * 1 本の上に集まる。**重ねて描けば、最後に描いたものしか見えない。**
 *
 * **段 0 はずらさない。** 留まっているのが 1 台だけなら、線は停留所の位置に
 * 正直に載る。割り当てを運用番号順にしないのは、**番号を打ち替えただけで絵が
 * 組み替わる**のを避けるためである。
 *
 * 重なりの判定は**時間帯が交わるかどうか**だけを見る。運用ごとに段を固定すると、
 * 留まっていない時間まで段を占める。
 */
function assignLevels(spans: readonly SceneBlockLink[]): readonly SceneBlockLink[] {
  const byStop = new Map<string, SceneBlockLink[]>();
  for (const span of spans) {
    const group = byStop.get(span.stopId);
    if (group === undefined) byStop.set(span.stopId, [span]);
    else group.push(span);
  }

  const placed: SceneBlockLink[] = [];
  for (const group of byStop.values()) {
    // 滞泊の開始時刻の昇順。読む向き（左から右）と揃える。
    const sorted = [...group].sort((a, b) => a.from - b.from || a.blockId.localeCompare(b.blockId));
    /** 段ごとの、いま埋まっている終わりの時刻。 */
    const ends: number[] = [];

    for (const span of sorted) {
      let level = ends.findIndex((end) => end <= span.from);
      if (level === -1) {
        level = ends.length;
        ends.push(span.to);
      } else {
        ends[level] = span.to;
      }
      placed.push({ ...span, level });
    }
  }

  return placed;
}

/** 隣り合う 2 つ。`domain/util` の同名関数と同じ規則。 */
function* adjacent<T>(items: readonly T[]): Generator<readonly [T, T]> {
  for (let index = 1; index < items.length; index += 1) {
    const previous = items[index - 1];
    const current = items[index];
    if (previous !== undefined && current !== undefined) yield [previous, current];
  }
}
