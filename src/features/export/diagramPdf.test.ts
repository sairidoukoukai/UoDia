/**
 * ダイヤグラム PDF の検証（T-78、仕様書 v2 §5.4.2）。
 *
 * 受入条件は 2 つ。
 *
 * - **PNG と PDF で絵が食い違わない**（同じ場面・同じ視野から出る）
 * - 字が字として入っている（画像になっていない）
 *
 * PDF の中身そのものは `pdf/PdfDrawContext.test.ts` が外の道具に読ませて
 * 確かめる。ここで見るのは**同じところから出ていること**である。
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import { createProject } from '@/domain/io';
import { loadNetworkDef, type NetworkIndex } from '@/domain/network';
import { createTrip } from '@/domain/service';
import { fromHM } from '@/domain/time';
import { drawDiagram } from '@/features/diagram';
import { Recorder } from '@/features/diagram/recorder.test-utils';
import { createMemoryPlatform, type MemoryPlatform } from '@/platform';
import { createAppStore, selectActiveService, selectNetwork, type AppStoreHook } from '@/store';
import type { ExportSource } from './artifacts';
import { A4_LANDSCAPE_300DPI, diagramExportScene, exportViewport } from './diagramExport';
import { DIAGRAM_PDF_NAME, diagramPdfProducer, renderDiagramPdf } from './diagramPdf';
import { DIAGRAM_PNG_NAME } from './diagramPng';
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

beforeEach(() => {
  store = createAppStore();
  store.getState().setNetworkDef(network.def);
  store.getState().setProject(createProject(network, { now: new Date('2026-08-09T00:00:00Z') }));
  store.getState().editProject('便を足す', (project) => {
    const [service] = project.services;
    if (service === undefined) return;
    const inserted = createTrip([], 'S3', '1_0', fromHM(9, 0), network);
    if (inserted === null) throw new Error('便を作れません');
    service.trips = [...inserted.trips];
  });

  platform = createMemoryPlatform({ exportFont: new Uint8Array(readFileSync(fontPath)) });
});

describe('PNG と食い違わない（受入条件）', () => {
  it('**同じ場面から出る**', () => {
    expect(diagramExportScene(store.getState())).toBe(diagramExportScene(store.getState()));
  });

  it('**同じ視野から出る**', () => {
    const scene = diagramExportScene(store.getState());
    // PNG も PDF も `exportViewport(scene, page)` しか呼ばない。片方だけ別の
    // 視野を組み立てていれば、ここが食い違う。
    expect(exportViewport(scene, A4_LANDSCAPE_300DPI)).toEqual(
      exportViewport(scene, A4_LANDSCAPE_300DPI),
    );
  });

  it('**描く命令の並びが同じ**（器だけが違う）', () => {
    // 器を記録役に差し替えると、PNG と PDF が同じ引数で `drawDiagram` を呼んで
    // いることが、引かれた線の並びとして見える。
    const scene = diagramExportScene(store.getState());
    const viewport = exportViewport(scene, A4_LANDSCAPE_300DPI);

    const a = new Recorder();
    const b = new Recorder();
    drawDiagram(a, scene, viewport);
    drawDiagram(b, scene, viewport);

    expect(a.segments).toEqual(b.segments);
    expect(a.labels).toEqual(b.labels);
  });
});

describe('出来た PDF', () => {
  it('**A4 横 1 ページ**', async () => {
    // **読み返すのに別の目を使わない**——`pdf-lib` が書いたものを `pdf-lib` に
    // 読ませているが、ここで見たいのは紙の大きさと枚数だけである。中身が
    // 正しいかは外の道具に読ませて確かめている（`pdf/PdfDrawContext.test.ts`）。
    const { PDFDocument } = await import('pdf-lib');
    const doc = await PDFDocument.load(await renderDiagramPdf(source(), platform));

    expect(doc.getPageCount()).toBe(1);
    const { width, height } = doc.getPage(0).getSize();
    expect([Math.round(width), Math.round(height)]).toEqual([842, 595]);
  });

  it('**字が字として入っている**（画像になっていない。受入条件）', async () => {
    const bytes = await renderDiagramPdf(source(), platform);

    // 300dpi の A4 を画像で貼れば数 MB になる。**線と字だけなら数十 KB である。**
    // 字が字として読めることそのものは `pdf/PdfDrawContext.test.ts` が
    // `pdftotext` と `mutool` に読ませて確かめている。
    expect(bytes.length).toBeLessThan(200_000);
  });

  it('文書名を PDF の題名に入れる', async () => {
    store.getState().editProject('文書名', (project) => {
      project.document.name = '2026年度授業期間ダイヤ';
    });

    const bytes = await renderDiagramPdf(source(), platform);
    expect(bytes.length).toBeGreaterThan(1000);
  });

  it('**フォントを読めなければ投げる**（白紙の PDF を包まない）', async () => {
    const broken = createMemoryPlatform({ exportFont: new Uint8Array([1, 2, 3]) });

    await expect(renderDiagramPdf(source(), broken)).rejects.toThrow();
  });
});

describe('一斉出力に入る形', () => {
  it('名前は「ダイヤグラム.pdf」（仕様書 v2 §5.3）', () => {
    expect(diagramPdfProducer(platform).fileName).toBe(DIAGRAM_PDF_NAME);
    expect(DIAGRAM_PDF_NAME).toBe('ダイヤグラム.pdf');
  });

  it('**PNG と名前が衝突しない**（同じ名前は zip に入れられない）', () => {
    expect(DIAGRAM_PDF_NAME).not.toBe(DIAGRAM_PNG_NAME);
  });

  it('表に並ぶ', () => {
    expect(exportProducers(platform).map((producer) => producer.fileName)).toEqual([
      'ダイヤグラム.png',
      'ダイヤグラム.pdf',
      '時刻表_豊中方面.csv',
      '時刻表_吹田方面.csv',
    ]);
  });

  it('**名前が重なっていない**（zip に包める）', () => {
    const names = exportProducers(platform).map((producer) => producer.fileName);
    expect(new Set(names).size).toBe(names.length);
  });
});
