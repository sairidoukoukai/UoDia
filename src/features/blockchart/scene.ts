/**
 * 箱ダイヤに描くもの（仕様書 v2 §5.5、#194、T-79）。
 *
 * ## 新しい導出を書かない
 *
 * `deriveBlocks`（`domain/block/derive.ts`）が既に、箱ダイヤが必要とするものを
 * すべて出している（§5.5.4）。ここがするのは**描く順に並べ直すこと**だけである。
 *
 * | 導出済みのもの | 箱ダイヤでの役割 |
 * | --- | --- |
 * | `Block.trips`（始発時刻順） | **段の並び。** 上から順に 1 段ずつ下りる |
 * | `originStopId` / `terminalStopId` | **棒の左端と右端**（横軸が停留所であるため） |
 * | `originTime` / `terminalTime` | 棒に添える時刻 |
 * | `isDeadhead` | **回送を棒にしない**ための判定（§5.5.3） |
 * | `layoverMinutes` | 折返しの待ち。**段の間隔には使わない**。添える字に使う |
 * | `pullOutTime` / `pullInTime` | 出庫・入庫のマーク |
 * | `standbys` | **途中入庫のマーク**（T-88） |
 *
 * ## 回送は段を持たない
 *
 * **出庫と入庫は棒にしない**（§5.5.3）。棒で描くと、車庫（横軸のどこにも無い）
 * まで棒を伸ばすことになり、**横軸が停留所であるという決めが崩れる。** 印として、
 * 入る段の終着の下と、出る段の始発の上に置く。
 *
 * `deriveBlocks` は回送を行路に含めて返すため、**ここで落とす。** 落とした結果
 * 段が 1 つも残らない運用（回送だけの運用）は、描くものが無いので出さない。
 *
 * ## 車庫へ行ったことを落とさない（T-88、#230）
 *
 * 回送を落とすと、**運用の途中で車庫へ戻ったことまで一緒に落ちる。** 1 日に 2 回
 * 出庫する運用（朝に走って入庫し、夕方また出る）で、朝の最後の段と夕方の最初の
 * 段が**隣り合ってしまう。**
 *
 * ```
 * 落とす前: … | T1 4_0→1_0 | DT-in(回送) | DT-out(回送) | S1 1_0→4_0 | …
 * 落とした後: … | T1 4_0→1_0 | S1 1_0→4_0 | …          ← 車庫が消える
 * ```
 *
 * **消えるだけなら、まだ足りないだけである。** 実際にはそこへ嘘が入った——
 * `layoverMinutes` は直前の**回送**からの差であるため、**5 時間の待機が
 * 「折返し 0 分」として描かれていた。**
 *
 * `Block.standbys` を {@link ChartStandby} として持ち直す。**段と段の間に車庫が
 * あることを、描く側が知っている状態にする。**
 */

import { assignBlockColors, type Block, type BlockTrip } from '@/domain/block';
import type { Stop } from '@/domain/model';
import type { NetworkIndex } from '@/domain/network';
import type { Seconds } from '@/domain/time';
import { memoizeByIdentity, selectBlocks, selectNetwork, type AppState } from '@/store';
import type { SceneTheme } from '@/features/diagram';

/** 横軸に並ぶ停留所。**ダイヤグラムの縦軸と同じ値を横に寝かせる。** */
export interface ChartStop {
  readonly stopId: string;
  readonly shortName: string;
  /** ダイヤグラムの縦軸と同じ（仕様書 §5.3）。**2 つの図で間隔が食い違わない。** */
  readonly axisPosition: number;
}

/** 1 本の棒（営業便 1 便）。 */
export interface ChartBar {
  readonly tripId: string;
  /** 何段目か（その運用の中で 0 から数える）。 */
  readonly row: number;
  readonly originStopId: string;
  readonly terminalStopId: string;
  readonly originTime: Seconds;
  readonly terminalTime: Seconds;
  /**
   * 直前の便の終着からこの便の始発までの分。先頭の段は `null`。
   *
   * **段の間隔には使わない**（§5.5.2）。形に出ないぶんを字で補う。
   *
   * **車庫から出てきた段も `null`** である（T-88）。そこにあるのは折返しでは
   * なく待機であり、長さは {@link ChartStandby} が持つ。
   */
  readonly layoverMinutes: number | null;
}

/**
 * 運用の途中で車庫に居た時間（T-88、#230）。
 *
 * **段と段の間に挟まる。** 入る段（`inRow`）の終着で車庫へ帰り、出る段
 * （`outRow`）の始発から走り直す。`outRow` は必ず `inRow + 1` である——間の
 * 回送は段を持たないためだが、**それに頼らず両方を持つ**。印を置くのは終着と
 * 始発であり、停留所が違えば置く場所も違う。
 */
export interface ChartStandby {
  /** 車庫へ入る段。**この段の終着停留所の下**に印を置く。 */
  readonly inRow: number;
  readonly inStopId: string;
  /** 車庫に着いた時刻。 */
  readonly inTime: Seconds;
  /** 車庫から出る段。**この段の始発停留所の上**に印を置く。 */
  readonly outRow: number;
  readonly outStopId: string;
  /** 車庫を出た時刻。 */
  readonly outTime: Seconds;
  /** 車庫に居た分。**「折返し 0 分」の代わりにこれを出す。** */
  readonly minutes: number;
}

/** 1 つの運用。 */
export interface ChartBlock {
  readonly blockId: string;
  readonly color: string;
  readonly bars: readonly ChartBar[];
  /** 出庫。**最初の便の始発停留所の上**に印を置く（§5.5.3）。 */
  readonly pullOut: { readonly stopId: string; readonly time: Seconds } | null;
  /** 入庫。**最後の便の終着停留所の下**に印を置く。 */
  readonly pullIn: { readonly stopId: string; readonly time: Seconds } | null;
  /** 途中入庫（T-88）。**運用の端ではない出入り。** */
  readonly standbys: readonly ChartStandby[];
}

/** 箱ダイヤに描くものの全体。 */
export interface BlockChartScene {
  /** 横軸。**左が豊中、右が吹田**（`axisPosition` の昇順）。 */
  readonly stops: readonly ChartStop[];
  readonly blocks: readonly ChartBlock[];
  readonly theme: SceneTheme;
}

const NO_STOPS: readonly ChartStop[] = [];
const NO_BLOCKS: readonly ChartBlock[] = [];

/**
 * 横軸に並べる停留所。
 *
 * **車庫は並べない**（受入条件）。車庫は横軸のどこにも無く、出入庫は印で表す
 * （§5.5.3）。編集で隠している停留所（`hiddenInEditor`）も出さない——ダイヤ
 * グラムの縦軸と揃える。
 */
const chartStopsOf = memoizeByIdentity((network: NetworkIndex): readonly ChartStop[] =>
  network.def.stops
    .filter((stop: Stop) => !stop.isDepot && !stop.hiddenInEditor)
    .map((stop) => ({
      stopId: stop.stopId,
      shortName: stop.shortName,
      axisPosition: stop.axisPosition,
    }))
    .sort((a, b) => a.axisPosition - b.axisPosition),
);

/** 営業便だけを段にする。 */
function barsOf(trips: readonly BlockTrip[]): ChartBar[] {
  const bars: ChartBar[] = [];

  for (const trip of trips) {
    if (trip.isDeadhead) continue;
    bars.push({
      tripId: trip.trip.tripId,
      // **段は営業便だけで数える。** 回送を数に入れると、出入庫のある運用だけ
      // 段が 1 つ余分に空く。
      row: bars.length,
      originStopId: trip.originStopId,
      terminalStopId: trip.terminalStopId,
      originTime: trip.originTime,
      terminalTime: trip.terminalTime,
      // 先頭の段の折返しは持たない。**その前は出庫であって折返しではない。**
      layoverMinutes: bars.length === 0 ? null : trip.layoverMinutes,
    });
  }

  return bars;
}

/**
 * 出庫の印を置く場所。
 *
 * **最初の営業便の始発停留所**である。回送そのものの始発（車庫）ではない——
 * 車庫は横軸に無い。
 */
function pullOutOf(block: Block, bars: readonly ChartBar[]): ChartBlock['pullOut'] {
  const first = bars[0];
  if (block.pullOutTime === null || first === undefined) return null;
  return { stopId: first.originStopId, time: block.pullOutTime };
}

function pullInOf(block: Block, bars: readonly ChartBar[]): ChartBlock['pullIn'] {
  const last = bars.at(-1);
  if (block.pullInTime === null || last === undefined) return null;
  return { stopId: last.terminalStopId, time: block.pullInTime };
}

/**
 * 途中入庫を段に対応づける（T-88、#230）。
 *
 * `Block.standbys` は**回送の便 ID**で待機を指しており、回送は段を持たない。
 * 行路を頭から数えて、**その回送までに営業便が何本あったか**を出せば段が分かる。
 *
 * **便 ID の綴りを読まない。** 展開した回送は `t1#in` のような ID を持つが
 * （`domain/trip/deadhead.ts`）、`route.json` に回送パターンを直接書いた便も
 * 同じ待機を作る。**綴りから元の便を割り出す形にすると、後者で外れる。**
 */
function standbysOf(block: Block, bars: readonly ChartBar[]): ChartStandby[] {
  const barsBefore = new Map<string, number>();
  let counted = 0;
  for (const trip of block.trips) {
    barsBefore.set(trip.trip.tripId, counted);
    if (!trip.isDeadhead) counted += 1;
  }

  const standbys: ChartStandby[] = [];
  for (const standby of block.standbys) {
    const beforeIn = barsBefore.get(standby.inboundTripId);
    const beforeOut = barsBefore.get(standby.outboundTripId);
    if (beforeIn === undefined || beforeOut === undefined) continue;

    // 入るのは**その回送の直前の段**、出るのは**直後の段**である。
    const inBar = bars[beforeIn - 1];
    const outBar = bars[beforeOut];
    // 営業便を挟まない出入り（車庫から出てすぐ帰った）は印を置く先が無い。
    if (inBar === undefined || outBar === undefined) continue;

    standbys.push({
      inRow: inBar.row,
      inStopId: inBar.terminalStopId,
      inTime: standby.startTime,
      outRow: outBar.row,
      outStopId: outBar.originStopId,
      outTime: standby.endTime,
      minutes: standby.minutes,
    });
  }

  return standbys;
}

/**
 * 車庫から出てきた段の折返しを落とす（T-88）。
 *
 * **そこにあるのは折返しではない。** `layoverMinutes` は直前の**回送**からの差で
 * あり、入庫の直後に出庫が続く運用では **0 分**になる——5 時間の待機が「折返し
 * 0 分」として描かれていた（#230）。長さは {@link ChartStandby} が持つ。
 */
function withoutStandbyLayovers(
  bars: readonly ChartBar[],
  standbys: readonly ChartStandby[],
): ChartBar[] {
  const fromDepot = new Set(standbys.map((standby) => standby.outRow));
  return bars.map((bar) => (fromDepot.has(bar.row) ? { ...bar, layoverMinutes: null } : bar));
}

const chartBlocksOf = memoizeByIdentity((blocks: readonly Block[]): readonly ChartBlock[] => {
  // **色は画面と同じ関数から取る**（仕様書 §5.8）。別に決めると、画面で青い
  // 運用が紙では緑になる。
  const colors = assignBlockColors(blocks.map((block) => block.blockId));

  const chart: ChartBlock[] = [];
  for (const block of blocks) {
    const bars = barsOf(block.trips);
    // **営業便が 1 本も無い運用は出さない**（受入条件）。回送だけの運用は
    // 描くものが無く、運用番号だけが並ぶ空の帯になる。
    if (bars.length === 0) continue;

    const standbys = standbysOf(block, bars);

    chart.push({
      blockId: block.blockId,
      color: colors.get(block.blockId) ?? '#888888',
      bars: withoutStandbyLayovers(bars, standbys),
      pullOut: pullOutOf(block, bars),
      pullIn: pullInOf(block, bars),
      standbys,
    });
  }

  return chart;
});

const sceneOf = memoizeByIdentity(
  (
    stops: readonly ChartStop[],
    blocks: readonly ChartBlock[],
    theme: SceneTheme,
  ): BlockChartScene => ({ stops, blocks, theme }),
);

/**
 * 状態から箱ダイヤに描くものを組み立てる。
 *
 * @param theme 色。**同じ参照を渡し続けること**（`memoizeByIdentity`）
 */
export function selectBlockChartScene(state: AppState, theme: SceneTheme): BlockChartScene {
  const network = selectNetwork(state);
  const derivation = selectBlocks(state);

  return sceneOf(
    network === null ? NO_STOPS : chartStopsOf(network),
    derivation === null ? NO_BLOCKS : chartBlocksOf(derivation.blocks),
    theme,
  );
}

/**
 * 描くのに要る段の数。**描く前に分かる**（仕様書 v2 §5.5.6）。
 *
 * 段の間隔が一定であるため、図の高さは便の数だけで決まる。**1 ページに収まるか
 * どうかを、絵を作る前に計算できる。**
 */
export function totalRows(scene: BlockChartScene): number {
  return scene.blocks.reduce((total, block) => total + block.bars.length, 0);
}
