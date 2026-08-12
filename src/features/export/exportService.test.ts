/**
 * 一斉出力の検証（T-74、仕様書 v2 §5）。
 *
 * 確かめるのは受入条件そのものである。
 *
 * - 便が 1 つも無いときは**ファイルを作らない**
 * - 途中で失敗したとき、**半分だけ入った zip が残らない**
 * - **保存先を選ばずに閉じたら何も起きない**
 *
 * 中身（PNG・CSV・PDF）はまだ 1 つも無い（`artifacts.ts`）。ここでは**偽の
 * 作り手**を渡す。器が正しく回ることと、中身が正しいことは別の話であり、
 * 後者は T-75 以降がそれぞれ確かめる。
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import { createProject } from '@/domain/io';
import { loadNetworkDef, type NetworkIndex } from '@/domain/network';
import { createTrip } from '@/domain/service';
import { fromHM } from '@/domain/time';
import { createMemoryPlatform, type MemoryPlatform } from '@/platform';
import { createAppStore, type AppStoreHook } from '@/store';
import type { ExportProducer } from './artifacts';
import { createExportService, formatProgress, type ExportProgress } from './exportService';

const routeJsonPath = fileURLToPath(new URL('../../../data/route.json', import.meta.url));
const loaded = loadNetworkDef(readFileSync(routeJsonPath, 'utf8'));
if (!loaded.ok) throw new Error('route.json を読み込めません');
const network: NetworkIndex = loaded.network;

const NOW = new Date(2026, 7, 9, 10, 30);

/** 出そうとした失敗を記録する口。 */
function createFakeDialogs() {
  const errors: string[] = [];
  return {
    errors,
    dialogs: {
      showError(message: string): Promise<void> {
        errors.push(message);
        return Promise.resolve();
      },
    },
  };
}

const encoder = new TextEncoder();

/** 中身を 1 つ作る偽の作り手。 */
function producer(label: string, fileName: string, body = label): ExportProducer {
  return { label, fileName, build: () => encoder.encode(body) };
}

/** 必ず失敗する作り手。 */
function failing(label: string, fileName: string): ExportProducer {
  return {
    label,
    fileName,
    build: () => {
      throw new Error('描けません');
    },
  };
}

let platform: MemoryPlatform;
let store: AppStoreHook;

/** 便を 1 つ持つプロジェクトを載せたストア。 */
function boot(withTrip = true): void {
  store = createAppStore();
  store.getState().setSeedNetworkDef(network.def);
  store.getState().setProject(createProject(network, { name: '春ダイヤ', now: NOW }));

  if (!withTrip) return;
  store.getState().editProject('便を足す', (project) => {
    const inserted = createTrip([], 'S3', '1_0', fromHM(9, 0), network);
    if (inserted === null) throw new Error('便を作れません');
    const [service] = project.services;
    if (service !== undefined) service.trips = [...inserted.trips];
  });
}

/** 器を組み立てる。**画面へ戻す間は挟まない**（テストを待たせない）。 */
function makeService(producers: readonly ExportProducer[]) {
  const { errors, dialogs } = createFakeDialogs();
  const service = createExportService({
    platform,
    store,
    dialogs,
    producers,
    now: () => NOW,
    yieldToUi: () => Promise.resolve(),
  });
  return { service, errors };
}

beforeEach(() => {
  platform = createMemoryPlatform();
  boot();
});

describe('書き出せたとき', () => {
  it('**すべてを 1 つの zip にまとめる**（仕様書 v2 §5.3）', async () => {
    const { service } = makeService([
      producer('ダイヤグラム', 'ダイヤグラム.png'),
      producer('時刻表', '時刻表_豊中方面.csv'),
    ]);

    expect(await service.run()).toBe(true);
    expect([...platform.exports.keys()]).toEqual(['春ダイヤ_20260809.zip']);
  });

  it('**中身が入っている**', async () => {
    const { service } = makeService([producer('箱ダイヤ', '箱ダイヤ.pdf', '仕業')]);
    await service.run();

    const zip = platform.exports.get('春ダイヤ_20260809.zip');
    expect(zip).toBeDefined();
    // 無圧縮であるから、包んだ中身がそのまま書庫の中に現れる。
    expect(new TextDecoder().decode(zip)).toContain('仕業');
    expect(new TextDecoder().decode(zip)).toContain('箱ダイヤ.pdf');
  });

  it('**編集中のダイヤを渡す**（§5.2。案として置いてあるダイヤは混ざらない）', async () => {
    const seen: string[] = [];
    const { service } = makeService([
      {
        label: '確かめ',
        fileName: 'a.txt',
        build: (source) => {
          seen.push(source.service.serviceName);
          return new Uint8Array(0);
        },
      },
    ]);
    await service.run();

    expect(seen).toEqual(['授業期間平日ダイヤ']);
  });
});

describe('進み具合（§5.9）', () => {
  it('**何を作っているかを順に伝える**', async () => {
    const seen: (ExportProgress | null)[] = [];
    const { service } = makeService([
      producer('ダイヤグラム', 'a.png'),
      producer('箱ダイヤ', 'b.pdf'),
    ]);

    await service.run((progress) => seen.push(progress));

    expect(seen).toEqual([
      { label: 'ダイヤグラム', index: 1, total: 2 },
      { label: '箱ダイヤ', index: 2, total: 2 },
      null,
    ]);
  });

  it('**終わったら消す**（作り終えたのに「作っています」が残らない）', async () => {
    const seen: (ExportProgress | null)[] = [];
    const { service } = makeService([producer('ダイヤグラム', 'a.png')]);
    await service.run((progress) => seen.push(progress));

    expect(seen.at(-1)).toBeNull();
  });

  it('失敗しても消す', async () => {
    const seen: (ExportProgress | null)[] = [];
    const { service } = makeService([failing('箱ダイヤ', 'b.pdf')]);
    await service.run((progress) => seen.push(progress));

    expect(seen.at(-1)).toBeNull();
  });
});

describe('formatProgress', () => {
  it('作っているものと何番目かを出す', () => {
    expect(formatProgress({ label: '箱ダイヤ', index: 3, total: 6 })).toBe(
      '箱ダイヤを作っています（3/6）',
    );
  });
});

describe('失敗したとき（§5.8）', () => {
  it('**便が 1 つも無ければファイルを作らない**（受入条件）', async () => {
    boot(false);
    const { service, errors } = makeService([producer('ダイヤグラム', 'a.png')]);

    expect(await service.run()).toBe(false);
    expect(platform.exports.size).toBe(0);
    expect(errors[0]).toContain('便がありません');
  });

  it('**便が無いときは中身を作りにも行かない**', async () => {
    boot(false);
    let built = 0;
    const { service } = makeService([
      {
        label: 'ダイヤグラム',
        fileName: 'a.png',
        build: () => {
          built += 1;
          return new Uint8Array(0);
        },
      },
    ]);
    await service.run();

    expect(built).toBe(0);
  });

  it('**途中で失敗したら半分だけ入った zip が残らない**（受入条件）', async () => {
    const { service, errors } = makeService([
      producer('ダイヤグラム', 'a.png'),
      failing('箱ダイヤ', 'b.pdf'),
      producer('時刻表', 'c.csv'),
    ]);

    expect(await service.run()).toBe(false);
    expect(platform.exports.size).toBe(0);
    expect(errors[0]).toContain('箱ダイヤ');
  });

  it('**どれを作っていて失敗したかを言う**（直す先が分かる）', async () => {
    const { service, errors } = makeService([failing('箱ダイヤ', 'b.pdf')]);
    await service.run();

    // **例外の型名は出さない。** 読むのは理由であって `Error:` ではない。
    expect(errors[0]).toBe('箱ダイヤを作れませんでした: 描けません');
  });

  it('**保存先を選ばずに閉じたら何も起きない**（受入条件）', async () => {
    platform.exportAccepted = false;
    const { service, errors } = makeService([producer('ダイヤグラム', 'a.png')]);

    expect(await service.run()).toBe(false);
    expect(platform.exports.size).toBe(0);
    // 取り消しは失敗ではない。**断りの窓を出さない。**
    expect(errors).toEqual([]);
  });

  it('書き込みに失敗したら理由を伝える', async () => {
    platform.saveExport = () => Promise.reject(new Error('書けません'));
    const { service, errors } = makeService([producer('ダイヤグラム', 'a.png')]);

    expect(await service.run()).toBe(false);
    expect(errors[0]).toContain('書けません');
  });

  it('**名前が重なっていれば書かない**（展開すると片方が消える）', async () => {
    const { service, errors } = makeService([
      producer('ダイヤグラム', '同じ.png'),
      producer('箱ダイヤ', '同じ.png'),
    ]);

    expect(await service.run()).toBe(false);
    expect(platform.exports.size).toBe(0);
    expect(errors[0]).toContain('重なって');
  });

  it('プロジェクトが無ければ書き出さない', async () => {
    store = createAppStore();
    const { service, errors } = makeService([producer('ダイヤグラム', 'a.png')]);

    expect(await service.run()).toBe(false);
    expect(errors[0]).toContain('ありません');
  });
});
