/**
 * 書き出すダイヤグラムの検証（T-75、仕様書 v2 §5.4.1）。
 *
 * ## canvas を使わずに受入条件を確かめる
 *
 * 受入条件は 4 つとも**何が描かれるか**の話であり、絵の画素を見なくても答えが
 * 出る。`Recorder`（`features/diagram`）に描かせて、引かれた線と置かれた文字を
 * 読む——`drawGrid` と `drawTrips` の検証が既にそうしている。
 *
 * - 一番早い便と一番遅い便が両方入っている
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
  diagramExportScene,
  drawnTimeRange,
  exportViewport,
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

/** 書き出す場面と視野で描き、記録を返す。 */
function draw(): { recorder: Recorder; viewport: Viewport } {
  const scene = diagramExportScene(state());
  const viewport = exportViewport(scene, A4_LANDSCAPE_300DPI);
  const recorder = new Recorder();
  drawDiagram(recorder, scene, viewport);
  return { recorder, viewport };
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
    expect(exportViewport(diagramExportScene(state()), A4_LANDSCAPE_300DPI).width).toBe(1754);
  });
});

describe('時刻の範囲', () => {
  it('**一番早い便と一番遅い便が両方入る**（受入条件）', () => {
    addTrip(7, 30);
    addTrip(20, 45);

    const range = drawnTimeRange(diagramExportScene(state()));
    expect(range.from).toBeLessThanOrEqual(fromHM(7, 30));
    expect(range.to).toBeGreaterThanOrEqual(fromHM(20, 45));
  });

  it('時いっぱいに丸める（目盛が半端な位置から始まらない）', () => {
    addTrip(9, 20);
    addTrip(9, 40);

    const range = drawnTimeRange(diagramExportScene(state()));
    expect(range.from).toBe(fromHM(9, 0));
    // **終点は着時刻で決まる。** 9:40 発の便は 10 時台に着く。発時刻だけを
    // 見ると、最後の便の後半が紙から外れる。
    expect(range.to).toBe(fromHM(11, 0));
  });

  it('**便が 1 つも無ければ表示範囲そのもの**（空でも絵は出す）', () => {
    const range = drawnTimeRange(diagramExportScene(state()));
    expect(range.from).toBe(fromHM(7, 0));
    expect(range.to).toBe(fromHM(22, 0));
  });

  it('**描ける範囲（7:00〜22:00）を出ない**（外は `drawTrips` が切り落とす）', () => {
    addTrip(7, 5);
    const range = drawnTimeRange(diagramExportScene(state()));

    expect(range.from).toBe(fromHM(7, 0));
  });
});

describe('視野', () => {
  it('**紙の幅いっぱいを使う**（右端が時刻の終わりに合う）', () => {
    addTrip(9, 0);
    addTrip(15, 0);
    const scene = diagramExportScene(state());
    const viewport = exportViewport(scene, A4_LANDSCAPE_300DPI);

    expect(timeToX(drawnTimeRange(scene).to, viewport)).toBeCloseTo(A4_LANDSCAPE_300DPI.width, 6);
  });

  it('**画面をスクロールした位置に左右されない**（受入条件）', () => {
    addTrip(9, 0);
    const before = exportViewport(diagramExportScene(state()), A4_LANDSCAPE_300DPI);

    store.getState().setDiagramView({
      ...state().project!.view.diagram,
      scrollTime: fromHM(18, 0),
      scrollAxis: 20,
      pxPerMinute: 12,
    });

    expect(exportViewport(diagramExportScene(state()), A4_LANDSCAPE_300DPI)).toEqual(before);
  });

  it('停留所が縦に収まる', () => {
    const scene = diagramExportScene(state());
    const viewport = exportViewport(scene, A4_LANDSCAPE_300DPI);
    const positions = scene.stops.map((stop) => stop.axisPosition);

    expect(viewport.startAxis).toBe(Math.min(...positions));
    // 一番下の停留所線が紙の中に収まっている。
    const bottom =
      viewport.originY +
      32 +
      (Math.max(...positions) - viewport.startAxis) * viewport.pxPerAxisUnit;
    expect(bottom).toBeLessThanOrEqual(A4_LANDSCAPE_300DPI.height);
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
    const dark = new Recorder();
    const scene = diagramExportScene(state());
    drawDiagram(dark, scene, exportViewport(scene, A4_LANDSCAPE_300DPI));

    expect(dark.rects[0]?.fillStyle).toBe(LIGHT_THEME.background);
  });
});

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
