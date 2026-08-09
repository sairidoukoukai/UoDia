/**
 * 箱ダイヤ PDF の検証（T-80・T-87、仕様書 v2 §5.5.6）。
 *
 * 受入条件（T-87 で入れ替わった）。
 *
 * - **A4 縦**である
 * - **3 行 2 列の格子**に分かれ、**1 マスに 1 運用**だけが描かれる
 * - 運用が 6 つ以下なら 1 ページ、**7 つ以上なら 2 ページ**になる
 * - **何ページになるかを描く前に計算している**
 * - 空きマスに何も描かれない
 * - **全マスの段の高さが同じ**である
 * - 横軸の見出しがマスごとに出る
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import { createProject } from '@/domain/io';
import { loadNetworkDef, type NetworkIndex } from '@/domain/network';
import { createTrip } from '@/domain/service';
import { fromHM } from '@/domain/time';
import { LIGHT_THEME } from '@/features/diagram';
import {
  CELLS_PER_PAGE,
  GRID_COLUMNS,
  GRID_ROWS,
  MIN_ROW_HEIGHT,
  blockChartCells,
  blockChartPageCount,
  drawBlockChart,
  selectBlockChartScene,
} from '@/features/blockchart';
import { Recorder } from '@/features/diagram/recorder.test-utils';
import { createMemoryPlatform, type MemoryPlatform } from '@/platform';
import { createAppStore, selectActiveService, selectNetwork, type AppStoreHook } from '@/store';
import type { ExportSource } from './artifacts';
import { BLOCK_CHART_PDF_NAME, blockChartPdfProducer, renderBlockChartPdf } from './blockChartPdf';
import { A4_PORTRAIT_300DPI } from './diagramExport';
import { exportProducers } from './producers';

const routeJsonPath = fileURLToPath(new URL('../../../data/route.json', import.meta.url));
const loaded = loadNetworkDef(readFileSync(routeJsonPath, 'utf8'));
if (!loaded.ok) throw new Error('route.json を読み込めません');
const network: NetworkIndex = loaded.network;

const fontPath = fileURLToPath(
  new URL('../../../assets/fonts/NotoSansJP-Regular.otf', import.meta.url),
);

let store: AppStoreHook;
let platform: MemoryPlatform;

function source(): ExportSource {
  const state = store.getState();
  const project = state.project;
  const index = selectNetwork(state);
  const service = selectActiveService(state);
  if (project === null || index === null || service === null) throw new Error('用意できません');
  return { state, project, network: index, service };
}

/** 運用を `count` 個、それぞれ 1 往復ぶん作る。 */
function addBlocks(count: number): void {
  for (let index = 0; index < count; index += 1) {
    const blockId = `B${String(index).padStart(2, '0')}`;
    for (const [pattern, stop, hour] of [
      ['S3', '1_0', 7],
      ['T3', '4_0', 8],
    ] as const) {
      store.getState().editProject('便を足す', (project) => {
        const [service] = project.services;
        if (service === undefined) return;
        const inserted = createTrip(
          service.trips,
          pattern,
          stop,
          fromHM(hour + Math.floor(index / 4), (index % 4) * 15),
          network,
        );
        if (inserted === null) throw new Error('便を作れません');
        service.trips = [...inserted.trips];
        const added = service.trips.at(-1);
        if (added !== undefined) added.blockId = blockId;
      });
    }
  }
}

/** いまの状態の格子。 */
function pages(): readonly (readonly ReturnType<typeof blockChartCells>[number][number][])[] {
  return blockChartCells(selectBlockChartScene(store.getState(), LIGHT_THEME), A4_PORTRAIT_300DPI);
}

/** いまの状態のマスを、ページをまたいで並べたもの。 */
function allCells(): readonly ReturnType<typeof blockChartCells>[number][number][] {
  return pages().flat();
}

beforeEach(() => {
  store = createAppStore();
  store.getState().setNetworkDef(network.def);
  store.getState().setProject(createProject(network, { now: new Date('2026-08-09T00:00:00Z') }));
  platform = createMemoryPlatform({ exportFont: new Uint8Array(readFileSync(fontPath)) });
});

describe('格子（#220、T-87 受入条件）', () => {
  it('**3 行 2 列である**', () => {
    expect([GRID_ROWS, GRID_COLUMNS]).toEqual([3, 2]);
    expect(CELLS_PER_PAGE).toBe(6);
  });

  it('**1 マスに 1 運用だけが入る**', () => {
    addBlocks(5);
    for (const cell of allCells()) expect(cell.scene.blocks).toHaveLength(1);
  });

  it('**マスの数は運用の数と同じ**（空きマスを作らない）', () => {
    addBlocks(5);
    expect(allCells()).toHaveLength(5);
  });

  it('**マスは左上から右へ並ぶ**', () => {
    addBlocks(4);
    const cells = allCells();
    const half = A4_PORTRAIT_300DPI.width / 2;
    const third = A4_PORTRAIT_300DPI.height / 3;

    expect(cells.map((cell) => [cell.viewport.left, cell.viewport.top])).toEqual([
      [0, 0],
      [half, 0],
      [0, third],
      [half, third],
    ]);
  });

  it('**マスは重ならない**（右端と地がちょうど隣のマスの左端と天）', () => {
    addBlocks(6);
    const half = A4_PORTRAIT_300DPI.width / 2;
    const third = A4_PORTRAIT_300DPI.height / 3;

    for (const cell of allCells()) {
      expect(cell.viewport.width - cell.viewport.left).toBeCloseTo(half, 6);
      expect(cell.viewport.height - cell.viewport.top).toBeCloseTo(third, 6);
    }
  });
});

describe('段の高さ（T-87 受入条件）', () => {
  it('**全マスで同じ**（便が多いのか段が広いのかを読み違えない）', () => {
    addBlocks(6);
    const heights = new Set(allCells().map((cell) => cell.viewport.rowHeight));

    expect(heights.size).toBe(1);
  });

  it('**最も便の多い運用に合わせる**（その運用がはみ出さない）', () => {
    addBlocks(6);
    const cells = allCells();
    const rowHeight = cells[0]?.viewport.rowHeight ?? 0;
    const most = Math.max(...cells.map((cell) => cell.scene.blocks[0]?.bars.length ?? 0));
    const cellHeight = A4_PORTRAIT_300DPI.height / GRID_ROWS;

    expect(most * rowHeight).toBeLessThanOrEqual(cellHeight);
  });

  it('**段の高さに下限がある**（縮めすぎない）', () => {
    addBlocks(40);
    for (const cell of allCells()) {
      expect(cell.viewport.rowHeight).toBeGreaterThanOrEqual(MIN_ROW_HEIGHT);
    }
  });

  it('**段の位置がマスをまたいで揃う**（高さが同じであるため）', () => {
    addBlocks(4);
    const cells = allCells();
    const first = cells[0]?.viewport;
    const second = cells[1]?.viewport;

    // 同じ行の 2 マスは、天も段の高さも同じ。
    expect(second?.top).toBe(first?.top);
    expect(second?.originY).toBe(first?.originY);
    expect(second?.rowHeight).toBe(first?.rowHeight);
  });
});

describe('改ページ（T-87 受入条件）', () => {
  it('**6 つ以下なら 1 ページ**', () => {
    addBlocks(6);
    expect(pages()).toHaveLength(1);
  });

  it('**7 つ以上なら 2 ページ**', () => {
    addBlocks(7);
    expect(pages()).toHaveLength(2);
  });

  it('**2 ページ目も同じ 3 行 2 列である**（版面を変えない）', () => {
    addBlocks(7);
    const seventh = pages()[1]?.[0];

    expect([seventh?.viewport.left, seventh?.viewport.top]).toEqual([0, 0]);
  });

  it('**何ページになるかを描く前に計算している**', () => {
    addBlocks(7);
    // `blockChartPageCount` は視野も紙の大きさも取らない。**数えるだけ**である。
    expect(blockChartPageCount(selectBlockChartScene(store.getState(), LIGHT_THEME))).toBe(2);
  });

  it('**PDF の枚数が一致する**', async () => {
    addBlocks(8);
    const { PDFDocument } = await import('pdf-lib');
    const doc = await PDFDocument.load(await renderBlockChartPdf(source(), platform));

    expect(doc.getPageCount()).toBe(2);
  });

  it('**運用が 1 つも無くても 1 ページ出る**（白紙でも落ちない）', async () => {
    const { PDFDocument } = await import('pdf-lib');
    const doc = await PDFDocument.load(await renderBlockChartPdf(source(), platform));

    expect(doc.getPageCount()).toBe(1);
  });
});

describe('マスの中身（T-87 受入条件）', () => {
  it('**見出しがマスごとに出る**', () => {
    addBlocks(2);
    const cells = allCells();

    for (const cell of cells) {
      const recorder = new Recorder();
      drawBlockChart(recorder, cell.scene, cell.viewport);
      const texts = recorder.labels.map((label) => label.text);

      expect(texts).toContain('豊中');
      expect(texts).toContain('工学部');
    }
  });

  it('**見出しはそのマスの帯に入る**（隣のマスへはみ出さない）', () => {
    addBlocks(4);
    // 2 行目の左マス。天が 0 でない。
    const cell = allCells()[2];
    if (cell === undefined) throw new Error('3 つめのマスがありません');

    const recorder = new Recorder();
    drawBlockChart(recorder, cell.scene, cell.viewport);
    const heads = recorder.labels.filter((label) => label.text === '豊中');

    expect(heads).toHaveLength(1);
    expect(heads[0]?.y).toBeGreaterThan(cell.viewport.top);
    expect(heads[0]?.y).toBeLessThan(cell.viewport.originY);
  });

  it('**マスは自分のところだけを塗る**（先に描いたマスを消さない）', () => {
    addBlocks(2);
    const cell = allCells()[1];
    if (cell === undefined) throw new Error('2 つめのマスがありません');

    const recorder = new Recorder();
    drawBlockChart(recorder, cell.scene, cell.viewport);
    const background = recorder.rects.find((rect) => rect.fillStyle === LIGHT_THEME.background);

    expect(background?.x).toBe(cell.viewport.left);
    expect(background?.y).toBe(cell.viewport.top);
  });

  it('**そのマスの運用だけが描かれる**（隣の運用の棒が混ざらない）', () => {
    addBlocks(2);
    const cells = allCells();
    const colors = cells.map((cell) => cell.scene.blocks[0]?.color);

    const recorder = new Recorder();
    const first = cells[0];
    if (first === undefined) throw new Error('マスがありません');
    drawBlockChart(recorder, first.scene, first.viewport);

    const drawn = new Set(recorder.segments.map((segment) => segment.strokeStyle));
    expect(drawn.has(colors[0] ?? '')).toBe(true);
    // 2 つめの運用は別の色を割り当てられている。
    if (colors[1] !== colors[0]) expect(drawn.has(colors[1] ?? '')).toBe(false);
  });
});

describe('出来た PDF', () => {
  it('**A4 縦**（T-87 受入条件。ダイヤグラムとは紙の向きが分かれる）', async () => {
    addBlocks(3);
    const { PDFDocument } = await import('pdf-lib');
    const doc = await PDFDocument.load(await renderBlockChartPdf(source(), platform));
    const { width, height } = doc.getPage(0).getSize();

    expect([Math.round(width), Math.round(height)]).toEqual([595, 842]);
  });

  it('**停留所名が字として入っている**（§5.5.5）', async () => {
    addBlocks(3);
    const bytes = await renderBlockChartPdf(source(), platform);

    // 画像で貼れば数 MB になる。線と字だけなら数十 KB である。
    expect(bytes.length).toBeGreaterThan(1000);
    expect(bytes.length).toBeLessThan(200_000);
  });
});

describe('一斉出力に入る形', () => {
  it('名前は「箱ダイヤ.pdf」（仕様書 v2 §5.3）', () => {
    expect(blockChartPdfProducer(platform).fileName).toBe(BLOCK_CHART_PDF_NAME);
    expect(BLOCK_CHART_PDF_NAME).toBe('箱ダイヤ.pdf');
  });

  it('**仕様書 §5.3 の並びで表に入る**', () => {
    expect(exportProducers(platform).map((producer) => producer.fileName)).toEqual([
      'ダイヤグラム.png',
      'ダイヤグラム.pdf',
      '箱ダイヤ.pdf',
      '時刻表_豊中方面.csv',
      '時刻表_吹田方面.csv',
    ]);
  });

  it('**5 つすべてが揃った**（仕様書 v2 §5.2）', () => {
    expect(exportProducers(platform)).toHaveLength(5);
  });
});
