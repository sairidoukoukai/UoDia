/**
 * ダイヤグラム PNG の器の検証（T-75）。
 *
 * **絵の中身はここでは見ない**（`diagramExport.test.ts` が見る）。ここで確かめる
 * のは器の 3 点である。
 *
 * - **`ctx` に倍率を掛けている**（掛け忘れると、3508px の紙に 12px の字が置かれる）
 * - canvas の画素の大きさが A4 横 300dpi 相当である
 * - `toBlob` が返さなかったときに黙って空を包まない
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import { createProject } from '@/domain/io';
import { loadNetworkDef, type NetworkIndex } from '@/domain/network';
import { createTrip } from '@/domain/service';
import { fromHM } from '@/domain/time';
import { Recorder } from '@/features/diagram/recorder.test-utils';
import { createAppStore, selectActiveService, selectNetwork, type AppStoreHook } from '@/store';
import type { ExportSource } from './artifacts';
import { A4_LANDSCAPE_300DPI } from './diagramExport';
import { DIAGRAM_PNG_NAME, diagramPngProducer, renderDiagramPng } from './diagramPng';

const routeJsonPath = fileURLToPath(new URL('../../../data/route.json', import.meta.url));
const loaded = loadNetworkDef(readFileSync(routeJsonPath, 'utf8'));
if (!loaded.ok) throw new Error('route.json を読み込めません');
const network: NetworkIndex = loaded.network;

/** `setTransform` まで受ける記録役。 */
class PngRecorder extends Recorder {
  transform: readonly number[] | null = null;

  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void {
    this.transform = [a, b, c, d, e, f];
  }
}

/** 実物の canvas の代わり。**画素は作らない。** */
function fakeCanvas(bytes: Uint8Array | null) {
  const recorder = new PngRecorder();
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => recorder,
    toBlob: (callback: (blob: Blob | null) => void): void => {
      callback(bytes === null ? null : new Blob([toBuffer(bytes)]));
    },
  };
  return { recorder, canvas };
}

/** `Blob` に渡せる形にする（`SharedArrayBuffer` に載っていないことを示す）。 */
function toBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.length);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

let store: AppStoreHook;

function makeSource(): ExportSource {
  const state = store.getState();
  const project = state.project;
  const network_ = selectNetwork(state);
  const service = selectActiveService(state);
  if (project === null || network_ === null || service === null) throw new Error('用意できません');
  return { state, project, network: network_, service };
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
});

describe('renderDiagramPng', () => {
  it('**canvas は A4 横 300dpi 相当で作る**（3508 × 2480px）', async () => {
    let asked: { width: number; height: number } | null = null;
    const { canvas } = fakeCanvas(new Uint8Array([1]));

    await renderDiagramPng(makeSource(), {
      createCanvas: (width, height) => {
        asked = { width, height };
        return canvas as unknown as HTMLCanvasElement;
      },
    });

    expect(asked).toEqual({ width: 3508, height: 2480 });
  });

  it('**`ctx` に倍率を掛ける**（掛けないと字だけが芥子粒になる）', async () => {
    const { recorder, canvas } = fakeCanvas(new Uint8Array([1]));

    await renderDiagramPng(makeSource(), {
      createCanvas: () => canvas as unknown as HTMLCanvasElement,
    });

    const scale = A4_LANDSCAPE_300DPI.scale;
    expect(recorder.transform).toEqual([scale, 0, 0, scale, 0, 0]);
  });

  it('絵を描く', async () => {
    const { recorder, canvas } = fakeCanvas(new Uint8Array([1]));

    await renderDiagramPng(makeSource(), {
      createCanvas: () => canvas as unknown as HTMLCanvasElement,
    });

    expect(recorder.segments.length).toBeGreaterThan(0);
    expect(recorder.labels.map((label) => label.text)).toContain('豊中');
  });

  it('固めたバイト列を返す', async () => {
    const { canvas } = fakeCanvas(new Uint8Array([0x89, 0x50, 0x4e, 0x47]));

    const bytes = await renderDiagramPng(makeSource(), {
      createCanvas: () => canvas as unknown as HTMLCanvasElement,
    });

    expect([...bytes]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  it('**固められなければ投げる**（空のファイルを包まない）', async () => {
    const { canvas } = fakeCanvas(null);

    await expect(
      renderDiagramPng(makeSource(), {
        createCanvas: () => canvas as unknown as HTMLCanvasElement,
      }),
    ).rejects.toThrow('PNG');
  });

  it('**2D コンテキストが無ければ投げる**（黙って白い絵を出さない）', async () => {
    const canvas = { getContext: () => null };

    await expect(
      renderDiagramPng(makeSource(), {
        createCanvas: () => canvas as unknown as HTMLCanvasElement,
      }),
    ).rejects.toThrow('絵を描けません');
  });
});

describe('一斉出力に入る形', () => {
  it('名前は「ダイヤグラム.png」（仕様書 v2 §5.3）', () => {
    expect(diagramPngProducer.fileName).toBe(DIAGRAM_PNG_NAME);
    expect(DIAGRAM_PNG_NAME).toBe('ダイヤグラム.png');
  });

  it('進み具合に出す名前を持つ（§5.9）', () => {
    expect(diagramPngProducer.label).toBe('ダイヤグラム');
  });
});
