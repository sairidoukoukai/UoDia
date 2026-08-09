/**
 * 書き出すダイヤグラムの検証（T-75・T-86、仕様書 v2 §5.4.1）。
 *
 * ## canvas を使わずに受入条件を確かめる
 *
 * 受入条件は**何が描かれるか**の話であり、絵の画素を見なくても答えが出る。
 * `Recorder`（`features/diagram`）に描かせて、引かれた線と置かれた文字を読む
 * ——`drawGrid` と `drawTrips` の検証が既にそうしている。
 *
 * - **3 段になり、時間帯が 7-13 / 12-18 / 17-23 である**（T-86）
 * - **重なりの時間帯にある便が、両方の段に出る**
 * - **22:00 以降が白紙である**
 * - 画面を暗い配色にしていても、出る絵は明るい
 * - **画面をスクロールした位置に結果が左右されない**
 * - フィルタで隠した便は出ない
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import { createProject } from '@/domain/io';
import { loadNetworkDef, type NetworkIndex } from '@/domain/network';
import { createTrip } from '@/domain/service';
import { fromHM } from '@/domain/time';
import { LIGHT_THEME, drawDiagram, timeToX, type Viewport } from '@/features/diagram';
import { Recorder } from '@/features/diagram/recorder.test-utils';
import { createAppStore, type AppState, type AppStoreHook } from '@/store';
import {
  A4_LANDSCAPE_300DPI,
  EXPORT_BAND_RANGES,
  diagramExportScene,
  exportBands,
  pixelSize,
} from './diagramExport';

const routeJsonPath = fileURLToPath(new URL('../../../data/route.json', import.meta.url));
const loaded = loadNetworkDef(readFileSync(routeJsonPath, 'utf8'));
if (!loaded.ok) throw new Error('route.json を読み込めません');
const network: NetworkIndex = loaded.network;

const NOW = new Date('2026-08-09T00:00:00Z');

let store: AppStoreHook;

/** 指定した時刻に豊中発の便を作る。 */
function addTrip(hour: number, minute: number, patternId = 'S3'): void {
  store.getState().editProject('便を足す', (project) => {
    const [service] = project.services;
    if (service === undefined) return;
    const inserted = createTrip(service.trips, patternId, '1_0', fromHM(hour, minute), network);
    if (inserted === null) throw new Error(`便を作れません: ${patternId}`);
    service.trips = [...inserted.trips];
  });
}

function state(): AppState {
  return store.getState();
}

/** 書き出す場面と段で描き、記録を返す。**PNG・PDF と同じ順に呼ぶ。** */
function draw(): { recorder: Recorder; viewports: readonly Viewport[] } {
  const scene = diagramExportScene(state());
  const bands = exportBands(scene, A4_LANDSCAPE_300DPI);
  const recorder = new Recorder();
  for (const band of bands) drawDiagram(recorder, scene, band.viewport);
  return { recorder, viewports: bands.map((band) => band.viewport) };
}

/** 1 段だけ描く。段ごとの中身を見るときに使う。 */
function drawBand(index: number): { recorder: Recorder; viewport: Viewport } {
  const scene = diagramExportScene(state());
  const band = exportBands(scene, A4_LANDSCAPE_300DPI)[index];
  if (band === undefined) throw new Error(`${String(index)} 段目がありません`);

  const recorder = new Recorder();
  drawDiagram(recorder, scene, band.viewport);
  return { recorder, viewport: band.viewport };
}

/** 段を組み立てる（場面は今の状態から取る）。 */
function bands(): readonly ReturnType<typeof exportBands>[number][] {
  return [...exportBands(diagramExportScene(state()), A4_LANDSCAPE_300DPI)];
}

beforeEach(() => {
  store = createAppStore();
  store.getState().setNetworkDef(network.def);
  store.getState().setProject(createProject(network, { now: NOW }));
});

describe('紙の大きさ（§5.4.1）', () => {
  it('**A4 横 300dpi 相当**（3508 × 2480px）', () => {
    expect(pixelSize(A4_LANDSCAPE_300DPI)).toEqual({ width: 3508, height: 2480 });
  });

  it('**座標は CSS px のまま渡す**（字と線が画面と同じ比になる）', () => {
    // 倍率を掛けるのは `ctx` であって視野ではない。視野の幅が 3508 になって
    // いたら、12px の字が 3508px の紙に置かれて芥子粒になっている。
    expect(bands()[0]?.viewport.width).toBe(1754);
  });

  it('**A4 横 1 枚のままである**（受入条件。段に割っても紙は増やさない）', () => {
    const last = bands().at(-1);
    expect(last?.viewport.height).toBe(A4_LANDSCAPE_300DPI.height);
  });
});

describe('段（#219、T-86 受入条件）', () => {
  it('**3 段になる**', () => {
    expect(bands()).toHaveLength(3);
  });

  it('**時間帯は 7-13 / 12-18 / 17-23 である**', () => {
    expect(bands().map((band) => [band.from, band.to])).toEqual([
      [fromHM(7, 0), fromHM(13, 0)],
      [fromHM(12, 0), fromHM(18, 0)],
      [fromHM(17, 0), fromHM(23, 0)],
    ]);
  });

  it('**1 時間ずつ重なる**（境目をまたぐ便が端で切れて終わらない）', () => {
    const ranges = [...EXPORT_BAND_RANGES];
    for (const [index, range] of ranges.slice(1).entries()) {
      const previous = ranges[index];
      expect(previous?.to).toBe(range.from + fromHM(1, 0));
    }
  });

  it('**便が無くても 3 段出す**（時間帯が固定であるため）', () => {
    // 便を 1 つも足していない。
    expect(bands()).toHaveLength(3);
  });

  it('**便を足しても段は動かない**（前に配った紙と見比べられる）', () => {
    const before = bands().map((band) => band.from);
    addTrip(7, 30);
    addTrip(20, 45);

    expect(bands().map((band) => band.from)).toEqual(before);
  });

  it('段は紙を 3 等分する（高さの配分は均等）', () => {
    const tops = bands().map((band) => band.viewport.top);
    const third = A4_LANDSCAPE_300DPI.height / 3;

    expect(tops).toEqual([0, third, third * 2]);
  });

  it('**段は隙間なく続く**（前の段の地が次の段の天）', () => {
    const all = bands();
    for (const [index, band] of all.slice(1).entries()) {
      expect(all[index]?.viewport.height).toBe(band.viewport.top);
    }
  });

  it('**縦の縮尺が全段で同じ**（同じ傾きが同じ速さを表す）', () => {
    const scales = new Set(bands().map((band) => band.viewport.pxPerAxisUnit));
    expect(scales.size).toBe(1);
  });

  it('**縦軸の起点も全段で同じ**（同じ停留所が同じ高さに来る）', () => {
    const starts = new Set(bands().map((band) => band.viewport.startAxis));
    expect(starts.size).toBe(1);
  });
});

describe('段に割った効き目（#219）', () => {
  it('**1 分あたりの px が 1 段のときより広い**', () => {
    // 1 段（7:00〜22:00 の 900 分）に詰めると 1698 / 900 ≒ 1.887。
    const single = (A4_LANDSCAPE_300DPI.width - 56) / 900;
    expect(bands()[0]?.viewport.pxPerMinute).toBeGreaterThan(single * 2);
  });

  it('**5 分が 20px を下回らない**（紙に刷って読める折返しにする）', () => {
    const pxPerMinute = bands()[0]?.viewport.pxPerMinute ?? 0;
    expect(pxPerMinute * 5).toBeGreaterThanOrEqual(20);
  });

  it('段の中に描く高さが残っている（目盛の帯と余白を引いても正）', () => {
    for (const band of bands()) {
      expect(band.viewport.height - band.viewport.originY).toBeGreaterThan(64);
    }
  });
});

describe('重なりの時間帯（T-86 受入条件）', () => {
  it('**12:30 の便が 1 段目にも 2 段目にも出る**', () => {
    addTrip(12, 30);

    // 便のスジは停車パターンの色で引かれる。格子（灰色）と混ざらないよう、
    // 段ごとに「斜めの線」があるかで見る。
    expect(hasDiagonal(drawBand(0).recorder)).toBe(true);
    expect(hasDiagonal(drawBand(1).recorder)).toBe(true);
  });

  it('**17:30 の便が 2 段目にも 3 段目にも出る**', () => {
    addTrip(17, 30);

    expect(hasDiagonal(drawBand(1).recorder)).toBe(true);
    expect(hasDiagonal(drawBand(2).recorder)).toBe(true);
  });

  it('重ならない時間帯の便は 1 つの段にしか出ない', () => {
    addTrip(9, 0);

    expect(hasDiagonal(drawBand(0).recorder)).toBe(true);
    expect(hasDiagonal(drawBand(1).recorder)).toBe(false);
    expect(hasDiagonal(drawBand(2).recorder)).toBe(false);
  });
});

describe('22:00 以降は白紙（T-86 受入条件）', () => {
  it('**3 段目の右端まで線が伸びない**', () => {
    addTrip(20, 0);
    const { recorder, viewport } = drawBand(2);

    // 22:00 の位置より右には、格子もスジも出ない。
    const limit = timeToX(fromHM(22, 0), viewport);
    const beyond = recorder.segments.filter(
      (segment) => segment.x1 > limit + 1 && segment.x2 > limit + 1,
    );
    expect(beyond).toEqual([]);
  });

  it('**22:00 より後の目盛を出さない**', () => {
    const texts = drawBand(2).recorder.labels.map((label) => label.text);

    expect(texts).toContain('22:00');
    expect(texts).not.toContain('23:00');
  });

  it('白紙なのは右端だけである（3 段目にも絵は出る）', () => {
    addTrip(18, 0);
    expect(hasDiagonal(drawBand(2).recorder)).toBe(true);
  });
});

describe('視野', () => {
  it('**画面をスクロールした位置に左右されない**（受入条件）', () => {
    addTrip(9, 0);
    const before = bands();

    store.getState().setDiagramView({
      ...state().project!.view.diagram,
      scrollTime: fromHM(18, 0),
      scrollAxis: 20,
      pxPerMinute: 12,
    });

    expect(bands()).toEqual(before);
  });

  it('停留所が段の中に収まる', () => {
    const scene = diagramExportScene(state());
    const positions = scene.stops.map((stop) => stop.axisPosition);

    for (const band of exportBands(scene, A4_LANDSCAPE_300DPI)) {
      expect(band.viewport.startAxis).toBe(Math.min(...positions));
      // 一番下の停留所線がその段の中に収まっている。
      const bottom =
        band.viewport.originY +
        32 +
        (Math.max(...positions) - band.viewport.startAxis) * band.viewport.pxPerAxisUnit;
      expect(bottom).toBeLessThanOrEqual(band.viewport.height);
    }
  });
});

describe('配色（§5.4.1）', () => {
  it('**画面が暗くても出る絵は明るい**（受入条件。紙に黒地は刷らない）', () => {
    store.getState().setSettings({ theme: 'dark' });
    const { recorder } = draw();

    // 背景を塗った矩形が白い。
    expect(recorder.rects[0]?.fillStyle).toBe(LIGHT_THEME.background);
  });

  it('明るい配色でも同じ絵になる', () => {
    store.getState().setSettings({ theme: 'light' });
    expect(draw().recorder.rects[0]?.fillStyle).toBe(LIGHT_THEME.background);
  });

  it('**段は自分の帯だけを塗る**（先に描いた段を消さない）', () => {
    const { recorder } = draw();
    const third = A4_LANDSCAPE_300DPI.height / 3;

    // 背景の塗りは段ごとに 1 つずつ。2 段目は 1 段目の下から始まる。
    const backgrounds = recorder.rects.filter((rect) => rect.fillStyle === LIGHT_THEME.background);
    expect(backgrounds.map((rect) => rect.y)).toEqual([0, third, third * 2]);
    for (const rect of backgrounds) expect(rect.height).toBeCloseTo(third, 6);
  });
});

/** 斜めの線が引かれたか。**スジがその段に出ているか**を見るのに使う。 */
function hasDiagonal(recorder: Recorder): boolean {
  return recorder.segments.some(
    (segment) => segment.x1 !== segment.x2 && segment.y1 !== segment.y2,
  );
}

describe('表示設定は画面のものを使う（§5.4.1）', () => {
  it('**フィルタで隠した便は出ない**（受入条件）', () => {
    addTrip(9, 0, 'S3');
    addTrip(10, 0, 'T3');
    expect(diagramExportScene(state()).trips.length).toBeGreaterThanOrEqual(2);

    store.getState().editProject('隠す', (project) => {
      project.view.hiddenPatternIds = ['T3'];
    });

    const shown = diagramExportScene(state()).trips;
    expect(shown.every((trip) => trip.patternId !== 'T3')).toBe(true);
    expect(shown.length).toBeGreaterThan(0);
  });
});

describe('選択は落とす', () => {
  it('**選んだまま書き出しても絵は変わらない**', () => {
    addTrip(9, 0);
    const tripId = state().project?.services[0]?.trips[0]?.tripId ?? '';
    const before = draw().recorder.segments;

    store.getState().selectTrips([tripId]);

    expect(draw().recorder.segments).toEqual(before);
  });

  it('選択の枠を描かない', () => {
    addTrip(9, 0);
    store.getState().setSelectionRect({
      fromTime: fromHM(8, 0),
      toTime: fromHM(10, 0),
      fromAxis: 0,
      toAxis: 40,
    });

    expect(diagramExportScene(state()).selectionRect).toBeNull();
  });

  it('**何も選んでいなければ状態をそのまま渡す**（場面の記憶化を外さない）', () => {
    addTrip(9, 0);
    expect(diagramExportScene(state())).toBe(diagramExportScene(state()));
  });
});
