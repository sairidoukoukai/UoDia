/**
 * GTFS の書き出しの検証（T-82）。
 *
 * 組み立てそのものは `domain/export/gtfs/build.test.ts` が実例と突き合わせる。
 * ここで見るのは**包んで保存するまで**である——**12 ファイルが 1 つの zip に
 * 入り、外の展開ツールで開けること。**
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createProject } from '@/domain/io';
import { loadNetworkDef, type NetworkIndex } from '@/domain/network';
import { createTrip } from '@/domain/service';
import { fromHM } from '@/domain/time';
import { createMemoryPlatform, type MemoryPlatform } from '@/platform';
import { createAppStore, type AppStoreHook } from '@/store';
import { GTFS_ZIP_NAME, exportGtfs } from './gtfsExport';

const routeJsonPath = fileURLToPath(new URL('../../../data/route.json', import.meta.url));
const loaded = loadNetworkDef(readFileSync(routeJsonPath, 'utf8'));
if (!loaded.ok) throw new Error('route.json を読み込めません');
const network: NetworkIndex = loaded.network;

const shapes = readFileSync(
  fileURLToPath(new URL('../../../assets/gtfs/shapes.txt', import.meta.url)),
  'utf8',
);

const scratch = mkdtempSync(join(tmpdir(), 'uodia-gtfs-'));

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

function hasPython(): boolean {
  try {
    execFileSync('which', ['python3'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const HAS_PYTHON = hasPython();

let store: AppStoreHook;
let platform: MemoryPlatform;
let errors: string[];

const dialogs = {
  showError: (message: string): Promise<void> => {
    errors.push(message);
    return Promise.resolve();
  },
};

function run(): Promise<boolean> {
  return exportGtfs({
    platform,
    store,
    dialogs,
    now: () => new Date(2026, 7, 9, 12, 0, 0),
    loadShapes: () => Promise.resolve(shapes),
  });
}

/** 出来た zip の中身を Python に読ませる。 */
function unzip(bytes: Uint8Array): Record<string, string> {
  const path = join(scratch, 'gtfs.zip');
  writeFileSync(path, bytes);

  const script = [
    'import json,sys,zipfile',
    'z=zipfile.ZipFile(sys.argv[1])',
    'assert z.testzip() is None',
    'print(json.dumps({n:z.read(n).decode("utf-8-sig") for n in z.namelist()}))',
  ].join('\n');

  return JSON.parse(execFileSync('python3', ['-c', script, path], { encoding: 'utf8' })) as Record<
    string,
    string
  >;
}

beforeEach(() => {
  errors = [];
  platform = createMemoryPlatform();
  store = createAppStore();
  store.getState().setSeedNetworkDef(network.def);
  store.getState().setProject(createProject(network, { now: new Date('2026-08-09T00:00:00Z') }));
  store.getState().editProject('用意する', (project) => {
    const [service] = project.services;
    if (service === undefined) return;
    const inserted = createTrip([], 'S3', '1_0', fromHM(9, 0), network);
    if (inserted === null) throw new Error('便を作れません');
    service.trips = [...inserted.trips];
    service.calendar = {
      startDate: '2026-04-01',
      endDate: '2027-03-31',
      weekdays: ['mon', 'tue', 'wed', 'thu', 'fri'],
      closedRanges: [],
    };
  });
});

describe('書き出せたとき', () => {
  it('**1 つの zip にまとめる**', async () => {
    expect(await run()).toBe(true);
    expect([...platform.exports.keys()]).toEqual([GTFS_ZIP_NAME]);
  });

  it.runIf(HAS_PYTHON)('**外の展開ツールで開ける**（12 ファイル）', async () => {
    await run();
    const files = unzip(platform.exports.get(GTFS_ZIP_NAME) ?? new Uint8Array(0));

    expect(Object.keys(files).sort()).toEqual([
      'agency.txt',
      'calendar.txt',
      'calendar_dates.txt',
      'feed_info.txt',
      'office_jp.txt',
      'routes.txt',
      'shapes.txt',
      'stop_times.txt',
      'stops.txt',
      'transfers.txt',
      'translations.txt',
      'trips.txt',
    ]);
  });

  it.runIf(HAS_PYTHON)('**中身が読める**（BOM を落として日本語が出る）', async () => {
    await run();
    const files = unzip(platform.exports.get(GTFS_ZIP_NAME) ?? new Uint8Array(0));

    expect(files['stops.txt']).toContain('豊中学舎');
    expect(files['agency.txt']).toContain('国立大学法人大阪大学');
  });

  it.runIf(HAS_PYTHON)('**shapes.txt が同梱のものと一致する**（素通し）', async () => {
    await run();
    const files = unzip(platform.exports.get(GTFS_ZIP_NAME) ?? new Uint8Array(0));

    expect(files['shapes.txt']).toBe(shapes.replace(/^\ufeff/, ''));
  });
});

describe('失敗したとき', () => {
  it('**運行日が無ければ書かない**', async () => {
    store.getState().editProject('運行日を消す', (project) => {
      const [service] = project.services;
      if (service !== undefined) service.calendar = undefined;
    });

    expect(await run()).toBe(false);
    expect(platform.exports.size).toBe(0);
    expect(errors[0]).toContain('運行日');
  });

  it('**保存先を選ばずに閉じたら何も起きない**', async () => {
    platform.exportAccepted = false;

    expect(await run()).toBe(false);
    expect(platform.exports.size).toBe(0);
    // 取り消しは失敗ではない。
    expect(errors).toEqual([]);
  });

  it('ダイヤが無ければ書かない', async () => {
    store.getState().setProject(null);

    expect(await run()).toBe(false);
    expect(errors[0]).toContain('ありません');
  });
});

describe('確かめる道具が揃っていること', () => {
  it('python3 が使える', () => {
    expect(HAS_PYTHON).toBe(true);
  });
});
