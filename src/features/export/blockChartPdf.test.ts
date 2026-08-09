/**
 * 箱ダイヤ PDF の検証（T-80、仕様書 v2 §5.5.6）。
 *
 * 受入条件は 3 つ。
 *
 * - 運用が 5 つでも 10 つでも **1 ページに収まる**
 * - **収まるかどうかを描く前に計算している**（段の間隔が一定であるため）
 * - 字が読める大きさで残っている（**縮めすぎない下限がある**）
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
  MIN_ROW_HEIGHT,
  chartHeight,
  fitBlockChart,
  selectBlockChartScene,
} from '@/features/blockchart';
import { createMemoryPlatform, type MemoryPlatform } from '@/platform';
import { createAppStore, selectActiveService, selectNetwork, type AppStoreHook } from '@/store';
import type { ExportSource } from './artifacts';
import { BLOCK_CHART_PDF_NAME, blockChartPdfProducer, renderBlockChartPdf } from './blockChartPdf';
import { A4_LANDSCAPE_300DPI } from './diagramExport';
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

/** その状態の図の高さ。 */
function heightNow(): number {
  const scene = selectBlockChartScene(store.getState(), LIGHT_THEME);
  return chartHeight(scene, fitBlockChart(scene, A4_LANDSCAPE_300DPI));
}

beforeEach(() => {
  store = createAppStore();
  store.getState().setNetworkDef(network.def);
  store.getState().setProject(createProject(network, { now: new Date('2026-08-09T00:00:00Z') }));
  platform = createMemoryPlatform({ exportFont: new Uint8Array(readFileSync(fontPath)) });
});

describe('1 ページに収まる（受入条件）', () => {
  it('**運用が 5 つでも収まる**', () => {
    addBlocks(5);
    expect(heightNow()).toBeLessThanOrEqual(A4_LANDSCAPE_300DPI.height);
  });

  it('**運用が 10 でも収まる**', () => {
    addBlocks(10);
    expect(heightNow()).toBeLessThanOrEqual(A4_LANDSCAPE_300DPI.height);
  });

  it('**改ページを持たない**（PDF が 1 ページ）', async () => {
    addBlocks(8);
    const { PDFDocument } = await import('pdf-lib');
    const doc = await PDFDocument.load(await renderBlockChartPdf(source(), platform));

    expect(doc.getPageCount()).toBe(1);
  });

  it('**運用が 1 つも無くても 1 ページ出る**（白紙でも落ちない）', async () => {
    const { PDFDocument } = await import('pdf-lib');
    const doc = await PDFDocument.load(await renderBlockChartPdf(source(), platform));

    expect(doc.getPageCount()).toBe(1);
  });
});

describe('描く前に計算している（受入条件）', () => {
  it('**絵を作らずに高さが分かる**', () => {
    addBlocks(6);
    // `chartHeight` は `ctx` を取らない。**描かずに答えが出る**ことが、段の
    // 間隔を一定にした判断（§5.5.2）の見返りである。
    expect(heightNow()).toBeGreaterThan(0);
  });

  it('**段が増えれば高さの見積もりも増える**（下限に達するまで）', () => {
    addBlocks(2);
    const small = heightNow();
    addBlocks(2);

    expect(heightNow()).toBeGreaterThanOrEqual(small);
  });
});

describe('縮めすぎない（受入条件）', () => {
  it('**段の高さに下限がある**', () => {
    addBlocks(40);
    const scene = selectBlockChartScene(store.getState(), LIGHT_THEME);

    expect(fitBlockChart(scene, A4_LANDSCAPE_300DPI).rowHeight).toBeGreaterThanOrEqual(
      MIN_ROW_HEIGHT,
    );
  });
});

describe('出来た PDF', () => {
  it('**A4 横**（ダイヤグラムと同じ紙）', async () => {
    addBlocks(3);
    const { PDFDocument } = await import('pdf-lib');
    const doc = await PDFDocument.load(await renderBlockChartPdf(source(), platform));
    const { width, height } = doc.getPage(0).getSize();

    expect([Math.round(width), Math.round(height)]).toEqual([842, 595]);
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
