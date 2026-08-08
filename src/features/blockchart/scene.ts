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
 *
 * ## 回送は段を持たない
 *
 * **出庫と入庫は棒にしない**（§5.5.3）。棒で描くと、車庫（横軸のどこにも無い）
 * まで棒を伸ばすことになり、**横軸が停留所であるという決めが崩れる。** 印として、
 * 最初の便の始発の上と、最後の便の終着の下に置く。
 *
 * `deriveBlocks` は回送を行路に含めて返すため、**ここで落とす。** 落とした結果
 * 段が 1 つも残らない運用（回送だけの運用）は、描くものが無いので出さない。
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
   */
  readonly layoverMinutes: number | null;
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

    chart.push({
      blockId: block.blockId,
      color: colors.get(block.blockId) ?? '#888888',
      bars,
      pullOut: pullOutOf(block, bars),
      pullIn: pullInOf(block, bars),
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
