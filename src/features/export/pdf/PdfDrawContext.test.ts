/**
 * PDF の器の検証（T-77、仕様書 v2 §5.4.2）。
 *
 * ## 出来た PDF を外の道具に読ませる
 *
 * 受入条件は「**出来た PDF で停留所名を検索できる**」「**拡大しても線と字が
 * 滲まない**」である。自前で PDF を解析し直しても、同じ誤解を 2 度するだけで
 * ある——`zip.test.ts` と同じ考え方で、**別の実装**（poppler と MuPDF）に
 * 開かせる。
 *
 * **警告を見逃さない。** 埋め込みフォントが壊れていても、その環境に日本語
 * フォントがあれば字は出る。「出た」だけでは確かめたことにならない。
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createProject } from '@/domain/io';
import { loadNetworkDef, type NetworkIndex } from '@/domain/network';
import { createTrip } from '@/domain/service';
import { fromHM } from '@/domain/time';
import { drawDiagram } from '@/features/diagram';
import { createMemoryPlatform } from '@/platform';
import { createAppStore } from '@/store';
import { A4_LANDSCAPE_300DPI, diagramExportScene, exportViewport } from '../diagramExport';
import { createPdfBuilder } from './pdfDocument';
import { fontSizeOf, toRgb } from './PdfDrawContext';

const routeJsonPath = fileURLToPath(new URL('../../../../data/route.json', import.meta.url));
const loaded = loadNetworkDef(readFileSync(routeJsonPath, 'utf8'));
if (!loaded.ok) throw new Error('route.json を読み込めません');
const network: NetworkIndex = loaded.network;

const fontPath = fileURLToPath(
  new URL('../../../../assets/fonts/NotoSansJP-Regular.otf', import.meta.url),
);

const scratch = mkdtempSync(join(tmpdir(), 'uodia-pdf-'));

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

function has(command: string): boolean {
  try {
    execFileSync('which', [command], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const HAS_PDFTOTEXT = has('pdftotext');
const HAS_MUTOOL = has('mutool');

/** 便を 1 つ持つ状態から、ダイヤグラムを描いた PDF を作る。 */
async function makeDiagramPdf(): Promise<Uint8Array> {
  const store = createAppStore();
  store.getState().setNetworkDef(network.def);
  store.getState().setProject(createProject(network, { now: new Date('2026-08-09T00:00:00Z') }));
  store.getState().editProject('便を足す', (project) => {
    const [service] = project.services;
    if (service === undefined) return;
    const inserted = createTrip([], 'S3', '1_0', fromHM(9, 0), network);
    if (inserted === null) throw new Error('便を作れません');
    service.trips = [...inserted.trips];
  });

  const platform = createMemoryPlatform({ exportFont: new Uint8Array(readFileSync(fontPath)) });
  const builder = await createPdfBuilder({ platform, title: 'テスト' });
  const { ctx } = builder.addPage(A4_LANDSCAPE_300DPI.width, A4_LANDSCAPE_300DPI.height);

  const scene = diagramExportScene(store.getState());
  drawDiagram(ctx, scene, exportViewport(scene, A4_LANDSCAPE_300DPI));
  ctx.finish();

  return builder.save();
}

describe('toRgb', () => {
  it('`#rrggbb` を 0〜1 にする', () => {
    expect(toRgb('#ffffff')).toEqual([1, 1, 1]);
    expect(toRgb('#000000')).toEqual([0, 0, 0]);
  });

  it('`#rgb` も読む', () => {
    expect(toRgb('#fff')).toEqual([1, 1, 1]);
  });

  it('**読めない綴りは黒**（`features/diagram/color.ts` と同じ約束）', () => {
    expect(toRgb('rebeccapurple')).toEqual([0, 0, 0]);
    expect(toRgb('')).toEqual([0, 0, 0]);
  });

  it('前後の空白を落とす', () => {
    expect(toRgb('  #ff0000 ')).toEqual([1, 0, 0]);
  });
});

describe('fontSizeOf', () => {
  it('CSS の指定から大きさを取る', () => {
    expect(fontSizeOf('12px system-ui, sans-serif')).toBe(12);
    expect(fontSizeOf('11px system-ui, sans-serif')).toBe(11);
  });

  it('**太さは見ない**（埋めている書体は 1 ウェイトしか無い）', () => {
    expect(fontSizeOf('bold 12px system-ui, sans-serif')).toBe(12);
  });

  it('読めなければ既定に倒す', () => {
    expect(fontSizeOf('sans-serif')).toBe(10);
  });
});

describe('出来た PDF', () => {
  let bytes: Uint8Array;
  let path: string;

  beforeAll(async () => {
    bytes = await makeDiagramPdf();
    path = join(scratch, 'diagram.pdf');
    writeFileSync(path, bytes);
  });

  it('作れる', () => {
    expect(bytes.length).toBeGreaterThan(1000);
  });

  it('**フォントは使った字だけを埋める**（数十 KB に収まる。§5.4.2）', () => {
    // 同梱しているフォントは 4.5MB。全部埋めていればここで落ちる。
    expect(bytes.length).toBeLessThan(500_000);
  });

  it.runIf(HAS_PDFTOTEXT)('**停留所名を検索できる**（受入条件）', () => {
    const text = execFileSync('pdftotext', [path, '-'], { encoding: 'utf8' });

    expect(text).toContain('豊中');
    expect(text).toContain('工学部');
  });

  it.runIf(HAS_PDFTOTEXT)('**埋め込みフォントが壊れていない**', () => {
    // poppler は壊れたフォントを「Syntax Error: Embedded font file may be
    // invalid」と言い、**環境のフォントで代替して描く。** 代替されて字が出るのは
    // その環境に日本語フォントがあるからにすぎず、埋めた意味が消える。
    const messages = captureStderr('pdftotext', [path, '-']);

    expect(messages).not.toMatch(/Embedded font file|Couldn't create a font|Mismatch/);
  });

  it.runIf(HAS_MUTOOL)('**MuPDF も文字を取り出せる**（読む道具を選ばない）', () => {
    const text = execFileSync('mutool', ['draw', '-F', 'txt', path], { encoding: 'utf8' });

    expect(text).toContain('豊中');
  });

  it.runIf(HAS_MUTOOL)('**字の輪郭が読める**（線と字がベクタで入っている）', () => {
    const messages = captureStderr('mutool', [
      'draw',
      '-F',
      'png',
      '-o',
      join(scratch, 'p.png'),
      path,
    ]);

    // 「invalid outline」「ignored error when loading embedded font」が出たら、
    // 字は入っているつもりで入っていない。
    expect(messages).not.toMatch(/invalid outline|invalid composite|embedded font/);
  });
});

describe('確かめる道具が揃っていること', () => {
  it('poppler か MuPDF のどちらかは使える', () => {
    // どちらも無ければ黙って飛ばされ、緑のまま何も確かめていない状態になる。
    expect(HAS_PDFTOTEXT || HAS_MUTOOL).toBe(true);
  });
});

/**
 * 標準エラーを取る。
 *
 * **警告は終了状態に出ない。** poppler も MuPDF も、フォントが壊れていても
 * 0 で終わる。読むべきはここである。
 */
function captureStderr(command: string, args: readonly string[]): string {
  return spawnSync(command, [...args], { encoding: 'utf8' }).stderr;
}
