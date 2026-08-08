/**
 * 箱ダイヤの検証（T-79、仕様書 v2 §5.5）。
 *
 * **形そのものを確かめる。** 箱ダイヤは形が意味を持っている図であり
 * （§5.5.2）、「線が引かれた」では足りない——**1 往復が四角形として閉じるか**、
 * **区間便の棒が短いか**を、引かれた線分の座標から読む。
 *
 * 器は `Recorder`（`features/diagram`）である。canvas を使わずに済むこと自体が、
 * `drawBlockChart` が `(ctx, scene, viewport)` の 3 つで完結している証拠になる。
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import { createProject } from '@/domain/io';
import { loadNetworkDef, type NetworkIndex } from '@/domain/network';
import { createTrip } from '@/domain/service';
import { fromHM } from '@/domain/time';
import { LIGHT_THEME } from '@/features/diagram';
import { Recorder, isHorizontal, isVertical } from '@/features/diagram/recorder.test-utils';
import { createAppStore, type AppState, type AppStoreHook } from '@/store';
import { drawBlockChart } from './drawBlockChart';
import { selectBlockChartScene, totalRows, type BlockChartScene } from './scene';
import {
  MAX_ROW_HEIGHT,
  MIN_ROW_HEIGHT,
  axisToX,
  chartHeight,
  fitBlockChart,
  rowToY,
  type BlockChartViewport,
} from './viewport';

const routeJsonPath = fileURLToPath(new URL('../../../data/route.json', import.meta.url));
const loaded = loadNetworkDef(readFileSync(routeJsonPath, 'utf8'));
if (!loaded.ok) throw new Error('route.json を読み込めません');
const network: NetworkIndex = loaded.network;

const PAGE = { width: 1754, height: 1240 };

let store: AppStoreHook;

/**
 * 便を 1 つ足し、運用番号を付ける。
 *
 * @param stopId 打ち込む停留所（そこが始発になる）
 */
function addTrip(
  patternId: string,
  stopId: string,
  hour: number,
  minute: number,
  blockId: string,
): void {
  store.getState().editProject('便を足す', (project) => {
    const [service] = project.services;
    if (service === undefined) return;
    const inserted = createTrip(service.trips, patternId, stopId, fromHM(hour, minute), network);
    if (inserted === null) throw new Error(`便を作れません: ${patternId}`);
    service.trips = [...inserted.trips];
    const added = service.trips.at(-1);
    if (added !== undefined) added.blockId = blockId;
  });
}

function state(): AppState {
  return store.getState();
}

function scene(): BlockChartScene {
  return selectBlockChartScene(state(), LIGHT_THEME);
}

function viewportFor(target: BlockChartScene): BlockChartViewport {
  return fitBlockChart(target, PAGE);
}

/** 描いて記録を返す。 */
function draw(): { recorder: Recorder; scene: BlockChartScene; viewport: BlockChartViewport } {
  const target = scene();
  const viewport = viewportFor(target);
  const recorder = new Recorder();
  drawBlockChart(recorder, target, viewport);
  return { recorder, scene: target, viewport };
}

/** その停留所の x。 */
function xOf(target: BlockChartScene, viewport: BlockChartViewport, stopId: string): number {
  const stop = target.stops.find((entry) => entry.stopId === stopId);
  if (stop === undefined) throw new Error(`${stopId} が横軸にありません`);
  return axisToX(stop.axisPosition, viewport);
}

beforeEach(() => {
  store = createAppStore();
  store.getState().setNetworkDef(network.def);
  store.getState().setProject(createProject(network, { now: new Date('2026-08-09T00:00:00Z') }));
});

describe('横軸は停留所（§5.5.2）', () => {
  it('**左が豊中、真ん中が箕面、右が工学部**', () => {
    const target = scene();
    expect(target.stops.map((stop) => stop.stopId)).toEqual(['1_0', '2_0', '3_0', '5_0', '4_0']);
  });

  it('**車庫が横軸に現れない**（受入条件。出入庫は印で表す）', () => {
    expect(scene().stops.some((stop) => stop.stopId === '9_0')).toBe(false);
  });

  it('**ダイヤグラムの縦軸と同じ値を使う**（2 つの図で間隔が食い違わない）', () => {
    const positions = Object.fromEntries(
      scene().stops.map((stop) => [stop.stopId, stop.axisPosition]),
    );
    const fromRoute = Object.fromEntries(
      network.def.stops.map((stop) => [stop.stopId, stop.axisPosition]),
    );

    expect(positions['1_0']).toBe(fromRoute['1_0']);
    expect(positions['4_0']).toBe(fromRoute['4_0']);
  });

  it('停留所名を出す', () => {
    addTrip('S3', '1_0', 9, 0, 'A');
    const { recorder } = draw();

    expect(recorder.labels.map((label) => label.text)).toEqual(expect.arrayContaining(['豊中']));
  });
});

describe('形（§5.5.2）', () => {
  it('**1 往復が四角形として閉じる**（受入条件）', () => {
    // 豊中 → 工学部（S3）、工学部 → 豊中（T3）。同じ運用。
    addTrip('S3', '1_0', 9, 0, 'A');
    addTrip('T3', '4_0', 10, 0, 'A');

    const { recorder, scene: target, viewport } = draw();
    const left = xOf(target, viewport, '1_0');
    const right = xOf(target, viewport, '4_0');

    const bars = recorder.segments.filter(isHorizontal);
    expect(bars).toHaveLength(2);

    // 2 本の棒が同じ両端を持つ。
    for (const bar of bars) {
      expect([Math.min(bar.x1, bar.x2), Math.max(bar.x1, bar.x2)]).toEqual([left, right]);
    }
    // 段が 1 つ下りている。
    expect(bars[0]?.y1).toBeLessThan(bars[1]?.y1 ?? 0);

    // **縦線が右端で 2 本を繋いでいる。** これで四角が閉じる。
    const links = recorder.segments.filter(isVertical);
    expect(links.some((link) => link.x1 === right)).toBe(true);
  });

  it('**区間便の棒が、端から端までの便より短い**（受入条件）', () => {
    addTrip('S3', '1_0', 9, 0, 'A'); // 豊中 → 工学部
    addTrip('M4', '4_0', 10, 0, 'A'); // 工学部 → 箕面（区間便）

    const { recorder } = draw();
    const bars = recorder.segments.filter(isHorizontal);
    const lengths = bars.map((bar) => Math.abs(bar.x2 - bar.x1)).sort((a, b) => a - b);

    expect(lengths).toHaveLength(2);
    expect(lengths[0]).toBeLessThan(lengths[1] ?? 0);
  });

  it('**「コ」の字になる**（途中で折り返す）', () => {
    addTrip('S3', '1_0', 9, 0, 'A'); // 豊中 → 工学部
    addTrip('M4', '4_0', 10, 0, 'A'); // 工学部 → 箕面
    addTrip('S2', '2_0', 11, 0, 'A'); // 箕面 → 工学部

    const { recorder, scene: target, viewport } = draw();
    const bars = recorder.segments.filter(isHorizontal);
    expect(bars).toHaveLength(3);

    // 2 便目と 3 便目は箕面で折り返している。
    const minoo = xOf(target, viewport, '2_0');
    expect(recorder.segments.filter(isVertical).some((link) => link.x1 === minoo)).toBe(true);
  });
});

describe('段の間隔は一定（§5.5.2）', () => {
  it('**便の数が同じ 2 つの運用が、同じ高さで描かれる**（受入条件）', () => {
    // 運用 A は折返し 60 分、運用 B は折返し 240 分。段の間隔は変わらない。
    addTrip('S3', '1_0', 9, 0, 'A');
    addTrip('T3', '4_0', 10, 30, 'A');
    addTrip('S3', '1_0', 9, 5, 'B');
    addTrip('T3', '4_0', 14, 0, 'B');

    const { recorder } = draw();
    const bars = recorder.segments.filter(isHorizontal).map((bar) => bar.y1);

    // A の 2 段の間隔と、B の 2 段の間隔が等しい。
    expect(bars).toHaveLength(4);
    const [a1 = 0, a2 = 0, b1 = 0, b2 = 0] = bars;
    expect(a2 - a1).toBeCloseTo(b2 - b1, 6);
  });

  it('**図の高さは便の数だけで決まる**（描く前に分かる。§5.5.6）', () => {
    addTrip('S3', '1_0', 9, 0, 'A');
    const one = chartHeight(scene(), viewportFor(scene()));

    addTrip('T3', '4_0', 10, 0, 'A');
    const two = chartHeight(scene(), viewportFor(scene()));

    expect(totalRows(scene())).toBe(2);
    expect(two).toBeGreaterThan(one);
  });
});

describe('出入庫はマーク（§5.5.3）', () => {
  beforeEach(() => {
    addTrip('S3', '1_0', 9, 0, 'A');
    addTrip('T3', '4_0', 10, 0, 'A');
  });

  it('**回送に段を割かない**（棒にしない。受入条件）', () => {
    store.getState().editProject('出入庫を付ける', (project) => {
      const trips = project.services[0]?.trips ?? [];
      const first = trips[0];
      const last = trips.at(-1);
      if (first !== undefined) first.pullOut = true;
      if (last !== undefined) last.pullIn = true;
    });

    // 段は営業便の 2 つのまま。回送を棒にすれば 4 本になる。
    expect(totalRows(scene())).toBe(2);
    expect(draw().recorder.segments.filter(isHorizontal)).toHaveLength(2);
  });

  it('**出庫は始発停留所の上、入庫は終着停留所の下**（§5.5.3）', () => {
    store.getState().editProject('出入庫を付ける', (project) => {
      const trips = project.services[0]?.trips ?? [];
      const first = trips[0];
      const last = trips.at(-1);
      if (first !== undefined) first.pullOut = true;
      if (last !== undefined) last.pullIn = true;
    });

    const { recorder, scene: target, viewport } = draw();
    const bars = recorder.segments.filter(isHorizontal);
    const firstY = bars[0]?.y1 ?? 0;
    const lastY = bars.at(-1)?.y1 ?? 0;

    // 印は三角。**丸ではないため多角形として記録される。**
    expect(recorder.polygons).toHaveLength(2);
    const [pullOut, pullIn] = recorder.polygons;

    // どちらも豊中（1 便目の始発、2 便目の終着）に立つ。
    const toyonaka = xOf(target, viewport, '1_0');
    expect(pullOut?.points[0]?.x).toBeCloseTo(toyonaka, 6);
    expect(pullIn?.points[0]?.x).toBeCloseTo(toyonaka, 6);

    // **出庫は上、入庫は下。**
    expect(Math.min(...(pullOut?.points ?? []).map((p) => p.y))).toBeLessThan(firstY);
    expect(Math.max(...(pullIn?.points ?? []).map((p) => p.y))).toBeGreaterThan(lastY);
  });

  it('出入庫が無ければ印を出さない', () => {
    expect(draw().recorder.polygons).toEqual([]);
  });
});

describe('落ちない（受入条件）', () => {
  it('**便が 1 本もない**', () => {
    expect(() => draw()).not.toThrow();
    expect(scene().blocks).toEqual([]);
  });

  it('**運用番号が空欄の便しかない**', () => {
    addTrip('S3', '1_0', 9, 0, '');

    expect(() => draw()).not.toThrow();
    expect(scene().blocks).toEqual([]);
  });

  it('**回送だけの運用があっても落ちない**（描くものが無いので出さない）', () => {
    addTrip('S3', '1_0', 9, 0, 'A');
    // 営業便を持つ運用は出る。持たない運用番号は存在しようがないが、段が
    // 0 になる道を通しても落ちないことを見る。
    expect(scene().blocks.map((block) => block.blockId)).toEqual(['A']);
    expect(() => draw()).not.toThrow();
  });

  it('**時刻が未入力の便があっても落ちない**', () => {
    addTrip('S3', '1_0', 9, 0, 'A');
    store.getState().editProject('時刻を消す', (project) => {
      const trip = project.services[0]?.trips[0];
      if (trip !== undefined) trip.anchor = null;
    });

    expect(() => draw()).not.toThrow();
  });
});

describe('色（§5.8）', () => {
  it('**画面と同じ色を使う**（別に決めると紙と画面で運用の色が変わる）', () => {
    addTrip('S3', '1_0', 9, 0, 'A');
    addTrip('S3', '1_0', 9, 30, 'B');

    const colors = scene().blocks.map((block) => block.color);
    expect(new Set(colors).size).toBe(2);
    for (const color of colors) expect(color).toMatch(/^#[0-9a-f]{6}$/i);
  });
});

describe('段の高さ（§5.5.6）', () => {
  it('**運用が増えても縮めて収める**', () => {
    for (let index = 0; index < 12; index += 1) {
      addTrip('S3', '1_0', 8 + index, 0, `B${String(index)}`);
      addTrip('T3', '4_0', 8 + index, 30, `B${String(index)}`);
    }

    const target = scene();
    const viewport = viewportFor(target);
    expect(chartHeight(target, viewport)).toBeLessThanOrEqual(PAGE.height);
  });

  it('**読める大きさより下には縮めない**（受入条件）', () => {
    // 段を極端に増やしても下限で止まる。**収まらないなら、収まらないまま描く**
    // ——読めない絵を出すより、はみ出していることが見えるほうがよい。
    const many: BlockChartScene = {
      stops: scene().stops,
      blocks: Array.from({ length: 400 }, (_, index) => ({
        blockId: `B${String(index)}`,
        color: '#000000',
        bars: [
          {
            tripId: `t${String(index)}`,
            row: 0,
            originStopId: '1_0',
            terminalStopId: '4_0',
            originTime: fromHM(9, 0),
            terminalTime: fromHM(9, 30),
            layoverMinutes: null,
          },
        ],
        pullOut: null,
        pullIn: null,
      })),
      theme: LIGHT_THEME,
    };

    expect(fitBlockChart(many, PAGE).rowHeight).toBeGreaterThanOrEqual(MIN_ROW_HEIGHT);
  });

  it('**運用が少なくても間延びさせない**', () => {
    addTrip('S3', '1_0', 9, 0, 'A');
    expect(viewportFor(scene()).rowHeight).toBeLessThanOrEqual(MAX_ROW_HEIGHT);
  });
});

describe('段の位置', () => {
  it('段の中心を返す', () => {
    const viewport = viewportFor(scene());
    expect(rowToY(1, viewport) - rowToY(0, viewport)).toBeCloseTo(viewport.rowHeight, 6);
  });
});
