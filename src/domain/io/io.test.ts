/**
 * プロジェクトの読み書きの検証（T-11、仕様書 §7）。
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CURRENT_FORMAT_VERSION, type Project, type Trip } from '@/domain/model';
import { loadNetworkDef, type NetworkIndex } from '@/domain/network';
import { fromHM } from '@/domain/time';
import { createProject, touchProject } from './create';
import { loadProject } from './load';
import { migrateProjectData, MIGRATIONS } from './migrate';
import { serializeProject } from './serialize';

const routeJsonPath = fileURLToPath(new URL('../../../data/route.json', import.meta.url));
const loaded = loadNetworkDef(readFileSync(routeJsonPath, 'utf8'));
if (!loaded.ok) throw new Error('route.json を読み込めません');
const network: NetworkIndex = loaded.network;

const FIXED_NOW = new Date('2026-07-26T09:00:00.000Z');

function makeTrip(overrides: Partial<Trip> = {}): Trip {
  return {
    tripId: 'trip-1',
    patternId: 'S1',
    anchor: { stopId: '1_0', time: fromHM(8, 0) },
    blockId: '1',
    pullOut: false,
    pullIn: false,
    ...overrides,
  };
}

/** 便を 1 つ持つプロジェクト。 */
function makeProject(trips: readonly Trip[] = [makeTrip()]): Project {
  const project = createProject(network, { name: 'テスト', now: FIXED_NOW });
  const [service] = project.services;
  if (service === undefined) throw new Error('既定のダイヤがありません');
  return { ...project, services: [{ ...service, trips: [...trips] }] };
}

/** 読み込んで成功を前提に中身を取り出す。 */
function loadOrThrow(json: string): { project: Project; warnings: readonly { id: string }[] } {
  const result = loadProject(json, network);
  if (!result.ok) throw new Error(`読み込めません（段階: ${result.stage}）`);
  return { project: result.project, warnings: result.warnings };
}

describe('createProject', () => {
  it('ダイヤを 1 件持つ', () => {
    const project = createProject(network, { now: FIXED_NOW });
    expect(project.services).toHaveLength(1);
    expect(project.services[0]?.trips).toEqual([]);
  });

  it('現在の形式版数と route.json の版数を記録する', () => {
    const project = createProject(network, { now: FIXED_NOW });
    expect(project.meta.formatVersion).toBe(CURRENT_FORMAT_VERSION);
    expect(project.meta.routeVersion).toBe(network.def.version);
  });

  it('作成時刻と更新時刻が一致する', () => {
    const project = createProject(network, { now: FIXED_NOW });
    expect(project.meta.createdAt).toBe(project.meta.updatedAt);
  });

  it('表示設定の既定値がスキーマから入る', () => {
    const project = createProject(network, { now: FIXED_NOW });
    expect(project.view.diagram.scrollTime).toBe(fromHM(7, 0));
    expect(project.view.splitRatio).toBe(0.6);
  });

  it('文書情報を指定できる', () => {
    const project = createProject(network, { name: '2026年度', author: '山口', now: FIXED_NOW });
    expect(project.document).toEqual({ name: '2026年度', author: '山口', comment: '' });
  });

  it('生成時刻を渡さなければ現在時刻を使う', () => {
    expect(Date.parse(createProject(network).meta.createdAt)).toBeGreaterThan(0);
  });
});

describe('touchProject', () => {
  it('更新時刻だけを打ち直す', () => {
    const project = makeProject();
    const touched = touchProject(project, new Date('2026-08-01T00:00:00.000Z'));
    expect(touched.meta.updatedAt).toBe('2026-08-01T00:00:00.000Z');
    expect(touched.meta.createdAt).toBe(project.meta.createdAt);
    expect(touched.services).toBe(project.services);
  });

  it('時刻を渡さなければ現在時刻を使う', () => {
    expect(Date.parse(touchProject(makeProject()).meta.updatedAt)).toBeGreaterThan(0);
  });
});

describe('serializeProject — 出力の形（仕様書 §7.1）', () => {
  const json = serializeProject(makeProject());

  it('インデント 2 スペースで整形する', () => {
    expect(json).toContain('\n  "document": {');
  });

  it('改行は LF で、末尾に改行を 1 つ置く', () => {
    expect(json).not.toContain('\r');
    expect(json.endsWith('}\n')).toBe(true);
  });

  it('**同じ内容からは常に同じバイト列が出る**', () => {
    expect(serializeProject(makeProject())).toBe(serializeProject(makeProject()));
  });

  it('キーの並び順が違っても同じバイト列になる', () => {
    const project = makeProject();
    const [service] = project.services;
    if (service === undefined) throw new Error('ダイヤがありません');
    const reordered: Project = {
      view: project.view,
      services: [{ trips: service.trips, serviceName: service.serviceName, serviceId: 'weekday' }],
      document: project.document,
      patternCapacities: project.patternCapacities,
      meta: project.meta,
    };
    expect(serializeProject(reordered)).toBe(serializeProject(project));
  });

  it('便の並び順は保つ（利用者が並べ替えた結果であるため）', () => {
    const a = makeTrip({ tripId: 'a' });
    const b = makeTrip({ tripId: 'b' });
    const forward = serializeProject(makeProject([a, b]));
    expect(forward).not.toBe(serializeProject(makeProject([b, a])));
    expect(forward.indexOf('"a"')).toBeLessThan(forward.indexOf('"b"'));
  });

  it('アンカー未設定の便を null として書き出す', () => {
    expect(serializeProject(makeProject([makeTrip({ anchor: null })]))).toContain('"anchor": null');
  });
});

describe('ラウンドトリップ', () => {
  it('**保存 → 読込で完全に同一のオブジェクトが復元される**', () => {
    const project = makeProject();
    expect(loadOrThrow(serializeProject(project)).project).toEqual(project);
  });

  it('アンカー未設定の便も復元される', () => {
    const project = makeProject([makeTrip({ anchor: null })]);
    expect(loadOrThrow(serializeProject(project)).project).toEqual(project);
  });

  it('24 時超えの時刻も復元される', () => {
    const project = makeProject([makeTrip({ anchor: { stopId: '1_0', time: fromHM(25, 30) } })]);
    expect(loadOrThrow(serializeProject(project)).project).toEqual(project);
  });

  it('任意項目の note も復元される', () => {
    const project = makeProject([makeTrip({ note: '臨時便' })]);
    expect(loadOrThrow(serializeProject(project)).project).toEqual(project);
  });

  it('2 度書き出しても同じ結果になる', () => {
    const once = serializeProject(makeProject());
    expect(serializeProject(loadOrThrow(once).project)).toBe(once);
  });

  it('警告なしで読み込める', () => {
    expect(loadOrThrow(serializeProject(makeProject())).warnings).toEqual([]);
  });
});

/** 版数だけを差し替える。現在の版数が上がっても書き換えずに済むようにする。 */
function withFormatVersion(json: string, version: number): string {
  return json.replace(/"formatVersion": \d+/, `"formatVersion": ${String(version)}`);
}

describe('loadProject — 失敗する段階を区別する', () => {
  it('JSON として壊れていれば stage: json', () => {
    const result = loadProject('{ これは JSON ではない', network);
    expect(!result.ok && result.stage).toBe('json');
  });

  it('meta.formatVersion が無ければ stage: version', () => {
    const result = loadProject('{"document":{}}', network);
    expect(!result.ok && result.stage).toBe('version');
    expect(!result.ok && result.stage === 'version' && result.message).toContain('formatVersion');
  });

  it('JSON がオブジェクトでなければ stage: version', () => {
    expect(!loadProject('[]', network).ok).toBe(true);
    expect(!loadProject('42', network).ok).toBe(true);
  });

  it('meta がオブジェクトでなければ stage: version', () => {
    const result = loadProject('{"meta":"こわれている"}', network);
    expect(!result.ok && result.stage).toBe('version');
  });

  it('formatVersion が整数でなければ stage: version', () => {
    const result = loadProject('{"meta":{"formatVersion":1.5}}', network);
    expect(!result.ok && result.stage).toBe('version');
  });

  it('**新しすぎる形式は読込を拒否してアプリの更新を促す**（仕様書 §7.3）', () => {
    const json = withFormatVersion(serializeProject(makeProject()), 99);
    const result = loadProject(json, network);
    expect(!result.ok && result.stage).toBe('version');
    expect(!result.ok && result.stage === 'version' && result.message).toContain('更新');
  });

  it('変換手順の無い古い形式は理由を添えて拒否する', () => {
    const json = withFormatVersion(serializeProject(makeProject()), 0);
    const result = loadProject(json, network);
    expect(!result.ok && result.stage).toBe('version');
    expect(!result.ok && result.stage === 'version' && result.message).toContain('変換手順');
  });

  it('スキーマに適合しなければ stage: schema と不正なパスを示す', () => {
    const json = serializeProject(makeProject()).replace('"time": 28800', '"time": 28802');
    const result = loadProject(json, network);
    expect(!result.ok && result.stage).toBe('schema');
    expect(!result.ok && result.stage === 'schema' && result.issues[0]?.path).toBe(
      'services[0].trips[0].anchor.time',
    );
  });
});

describe('系統ごとの乗車可能人員（#162）', () => {
  it('**書き出して読み直すと残る**（どの版でも変えられる）', () => {
    const project: Project = { ...makeProject(), patternCapacities: { S1: 40, T1: 60 } };
    const { project: loaded } = loadOrThrow(serializeProject(project));

    expect(loaded.patternCapacities).toEqual({ S1: 40, T1: 60 });
  });

  it('**版数を上げずに読める**（既定値があるためマイグレーションが要らない）', () => {
    // 定員を持たない v1.0 のファイル。
    const json = serializeProject(makeProject()).replace(/"patternCapacities": \{\},?\n/, '');
    const { project: loaded } = loadOrThrow(json);

    expect(loaded.meta.formatVersion).toBe(3);
    expect(loaded.patternCapacities).toEqual({});
  });
});

describe('loadProject — 警告（仕様書 §7.3）', () => {
  it('W-01: route.json の版数が違えば警告する', () => {
    // 版数そのものは何でもよい。**食い違っていること**だけが要る。
    const json = serializeProject(makeProject()).replace(
      /"routeVersion": \d+/,
      '"routeVersion": 9',
    );
    const { warnings } = loadOrThrow(json);
    expect(warnings.map((w) => w.id)).toContain('W-01');
  });

  it('W-04: **知らないキーを警告付きで読み飛ばす**', () => {
    const json = serializeProject(makeProject()).replace(
      '"document": {',
      '"謎の項目": 123,\n  "document": {',
    );
    const { project, warnings } = loadOrThrow(json);
    expect(warnings.map((w) => w.id)).toContain('W-04');
    expect(project.services).toHaveLength(1);
  });

  it('W-04: 入れ子の中の知らないキーも見つける', () => {
    const json = serializeProject(makeProject()).replace(
      '"blockId": "1"',
      '"blockId": "1",\n          "謎": true',
    );
    const found = loadOrThrow(json).warnings.find((w) => w.id === 'W-04');
    expect(found).toBeDefined();
  });

  it('既定値の補完は知らないキーとして扱わない', () => {
    const json = serializeProject(makeProject()).replace(
      /"view": \{[\s\S]*?\n {2}\}/,
      '"view": {}',
    );
    expect(loadOrThrow(json).warnings.filter((w) => w.id === 'W-04')).toEqual([]);
  });

  it('W-02: 存在しない停車パターンを既定パターンへ倒す', () => {
    const json = serializeProject(makeProject()).replace('"patternId": "S1"', '"patternId": "??"');
    const { project, warnings } = loadOrThrow(json);
    expect(warnings.map((w) => w.id)).toContain('W-02');
    expect(project.services[0]?.trips[0]?.patternId).toBe('S3');
  });

  it('W-03: 経路に無いアンカー停留所は時刻を未入力へ倒す', () => {
    // S1（直行）は箕面学舎を通らない
    const json = serializeProject(makeProject()).replace('"stopId": "1_0"', '"stopId": "2_0"');
    const { project, warnings } = loadOrThrow(json);
    expect(warnings.map((w) => w.id)).toContain('W-03');
    expect(project.services[0]?.trips[0]?.anchor).toBeNull();
  });

  it('パターンを倒した結果アンカーが合わなくなれば両方警告する', () => {
    // S2（箕面発）のアンカーは箕面学舎。パターンが失われて S3（豊中発）へ倒れると
    // 箕面学舎は経路に含まれる…ため、ここでは人間科学部前を使う
    const json = serializeProject(makeProject([makeTrip({ patternId: 'T1' })]))
      .replace('"patternId": "T1"', '"patternId": "??"')
      .replace('"stopId": "1_0"', '"stopId": "5_0"');
    const ids = loadOrThrow(json).warnings.map((w) => w.id);
    expect(ids).toContain('W-02');
    expect(ids).toContain('W-03');
  });

  it('アンカー未設定の便は参照の修復で警告しない', () => {
    const json = serializeProject(makeProject([makeTrip({ anchor: null })]));
    expect(loadOrThrow(json).warnings).toEqual([]);
  });

  it('W-05: 変換を適用したことを警告として伝える', () => {
    // 版 0 のファイルを版 1 へ引き上げる変換を、その場で与える。
    // 変換が 1 つも無い今の段階でも、読込全体を通して枠組みを確かめる。
    const json = serializeProject(makeProject()).replace(
      `"formatVersion": ${String(CURRENT_FORMAT_VERSION)}`,
      '"formatVersion": 0',
    );
    const result = loadProject(json, network, {
      migrations: [
        {
          from: 0,
          to: CURRENT_FORMAT_VERSION,
          migrate: (data: unknown) => ({
            ...(data as object),
            meta: {
              ...(data as { meta: object }).meta,
              formatVersion: CURRENT_FORMAT_VERSION,
            },
          }),
        },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings.map((w) => w.id)).toContain('W-05');
    expect(result.project.meta.formatVersion).toBe(CURRENT_FORMAT_VERSION);
  });

  it('**版数 1 のファイルは、便番号を落として読み込める**（T-46）', () => {
    const v1 = withFormatVersion(serializeProject(makeProject()), 1).replace(
      '"blockId": "1"',
      '"blockId": "1",\n          "tripShortName": "E1"',
    );
    const result = loadProject(v1, network);
    if (!result.ok) throw new Error(`読み込めません（段階: ${result.stage}）`);

    expect(result.project.services[0]?.trips[0]).toEqual(makeTrip());
    expect(result.project.meta.formatVersion).toBe(CURRENT_FORMAT_VERSION);
    // 変換したことは伝える（W-05）。黙って形を変えない。
    expect(result.warnings.map((w) => w.id)).toContain('W-05');
    // 保存し直したファイルに便番号は残らない。
    expect(serializeProject(result.project)).not.toContain('tripShortName');
  });

  it('壊れた参照があってもファイルは開ける', () => {
    const json = serializeProject(makeProject()).replace('"patternId": "S1"', '"patternId": "??"');
    expect(loadProject(json, network).ok).toBe(true);
  });
});

describe('回送便を畳む（版数 3 への移行。仕様書 §7.3、T-51）', () => {
  /** 版数 2 のファイル。回送便が便として入っている。 */
  function version2(trips: readonly Trip[]): string {
    const project = makeProject(trips);
    return JSON.stringify({
      ...project,
      meta: { ...project.meta, formatVersion: 2 },
      services: [{ ...project.services[0], trips }],
    });
  }

  /** 出区 7:40→8:00 / 営業 8:00→8:30 / 入区 8:30→8:50 の 3 便。 */
  const pullOut: Trip = { ...makeTrip(), tripId: 'd1', patternId: 'DT-out' };
  const revenue: Trip = { ...makeTrip(), tripId: 't1', patternId: 'S1' };
  const pullIn: Trip = {
    ...makeTrip(),
    tripId: 'd2',
    patternId: 'DS-in',
    anchor: { stopId: '4_0', time: fromHM(8, 30) },
  };

  it('**接している回送便を営業便のフラグへ移す**', () => {
    const { project, warnings } = loadOrThrow(version2([pullOut, revenue, pullIn]));
    const trips = project.services[0]?.trips ?? [];

    expect(trips).toHaveLength(1);
    expect(trips[0]?.tripId).toBe('t1');
    expect(trips[0]?.pullOut).toBe(true);
    expect(trips[0]?.pullIn).toBe(true);
    expect(warnings.map((w) => w.id)).not.toContain('W-06');
  });

  it('**保存し直したファイルに回送便は現れない**', () => {
    const { project } = loadOrThrow(version2([pullOut, revenue, pullIn]));
    const json = serializeProject(project);

    expect(json).not.toContain('DT-out');
    expect(json).toContain('"pullOut": true');
  });

  it('**畳めない回送便は取り除き、必ず伝える**（W-06）', () => {
    // 運用番号が違うため、どの営業便にも繋がらない。
    const orphan: Trip = { ...pullOut, blockId: 'ちがう運用' };
    const { project, warnings } = loadOrThrow(version2([orphan, revenue]));

    expect(project.services[0]?.trips).toHaveLength(1);
    expect(project.services[0]?.trips[0]?.pullOut).toBe(false);
    expect(warnings.map((w) => w.id)).toContain('W-06');
  });

  it('接点の時刻がずれている回送便も畳めない', () => {
    const early: Trip = { ...pullOut, anchor: { stopId: '1_0', time: fromHM(7, 0) } };
    const { warnings } = loadOrThrow(version2([early, revenue]));
    expect(warnings.map((w) => w.id)).toContain('W-06');
  });

  it('**同じ場所の 2 本目は畳めない**（#87 で増えた回送）', () => {
    const duplicate: Trip = { ...pullOut, tripId: 'd1b' };
    const { project, warnings } = loadOrThrow(version2([pullOut, duplicate, revenue]));

    expect(project.services[0]?.trips[0]?.pullOut).toBe(true);
    expect(warnings.filter((w) => w.id === 'W-06')).toHaveLength(1);
  });

  it('運用番号が空欄の回送便は畳めない', () => {
    const unassigned: Trip = { ...pullOut, blockId: '' };
    const { project, warnings } = loadOrThrow(version2([unassigned, revenue]));

    expect(project.services[0]?.trips[0]?.pullOut).toBe(false);
    expect(warnings.map((w) => w.id)).toContain('W-06');
  });

  it('回送便が無ければ何も起きない', () => {
    const { project, warnings } = loadOrThrow(version2([revenue]));
    expect(project.services[0]?.trips).toHaveLength(1);
    expect(warnings.map((w) => w.id)).not.toContain('W-06');
  });
});

describe('migrateProjectData — マイグレーションの枠組み（仕様書 §7.3）', () => {
  it('**版数 1 → 2 で便番号を捨てる**（仕様書 §6.1.6、T-46）', () => {
    const v1 = {
      meta: { formatVersion: 1 },
      services: [{ trips: [{ tripId: 't1', patternId: 'S1', tripShortName: 'E1' }] }],
    };
    const result = migrateProjectData(v1, 1);
    if (!result.ok) throw new Error('変換できるはず');

    const trips = (result.data as { services: { trips: object[] }[] }).services[0]?.trips;
    expect(trips?.[0]).toEqual({ tripId: 't1', patternId: 'S1' });
    // 版数 3 まで引き上げられる。
    expect(result.applied).toEqual([2, 3]);
    // 版数の連なりに穴が無いこと。1 つでも欠けると古いファイルが開けなくなる。
    expect(MIGRATIONS.map((m) => [m.from, m.to])).toEqual([
      [1, 2],
      [2, 3],
    ]);
  });

  it('**版数 2 → 3 は版数だけを繰り上げる**（回送便を畳むのは読込時。T-51）', () => {
    const v2 = { meta: { formatVersion: 2 }, services: [{ trips: [{ tripId: 't1' }] }] };
    const result = migrateProjectData(v2, 2);
    if (!result.ok) throw new Error('変換できるはず');

    expect(result.data).toEqual({
      meta: { formatVersion: 3 },
      services: [{ trips: [{ tripId: 't1' }] }],
    });
  });

  it('版数 2 → 3 も、形の違う中身には手を触れない', () => {
    const result = migrateProjectData(null, 2);
    expect(result.ok && result.data).toBeNull();
  });

  it('ダイヤの並びが読めなければ手を触れない', () => {
    for (const broken of [null, { services: 'ちがう' }, { a: 1 }]) {
      // 版数 2 からの変換は meta を触るため、1 → 2 の段だけで見る。
      const result = migrateProjectData(broken, 1, MIGRATIONS, 2);
      expect(result.ok && result.data).toEqual(broken);
    }
  });

  it('**形の違う中身はそのまま残す**（直そうとせず、スキーマ検証に任せる）', () => {
    const broken = {
      meta: { formatVersion: 1 },
      services: ['ダイヤではない', { trips: 3 }, { trips: ['便ではない'] }],
    };
    const result = migrateProjectData(broken, 1);
    if (!result.ok) throw new Error('変換できるはず');

    expect((result.data as { services: unknown[] }).services).toEqual(broken.services);
  });

  it('現在の版数はそのまま通す', () => {
    const result = migrateProjectData({ a: 1 }, CURRENT_FORMAT_VERSION);
    expect(result).toEqual({ ok: true, data: { a: 1 }, applied: [] });
  });

  it('新しすぎる版数を拒否する', () => {
    const result = migrateProjectData({}, CURRENT_FORMAT_VERSION + 1);
    expect(!result.ok && result.reason).toBe('tooNew');
  });

  it('変換手順が無い古い版数を拒否する', () => {
    const result = migrateProjectData({}, 0);
    expect(!result.ok && result.reason).toBe('noPath');
  });

  it('**変換を順に適用し、適用した版数を返す**', () => {
    // 変換が 1 つも無い今の段階でも、枠組みそのものは動かして確かめる。
    // 動かしたことのない仕組みは、最初に使う日に必ず壊れている。
    const migrations = [
      { from: 1, to: 2, migrate: (d: unknown) => ({ ...(d as object), step1: true }) },
      { from: 2, to: 3, migrate: (d: unknown) => ({ ...(d as object), step2: true }) },
    ];
    const result = migrateProjectData({ original: true }, 1, migrations, 3);
    expect(result).toEqual({
      ok: true,
      data: { original: true, step1: true, step2: true },
      applied: [2, 3],
    });
  });

  it('途中の版から始めれば残りの変換だけを適用する', () => {
    const migrations = [
      { from: 1, to: 2, migrate: () => ({ step1: true }) },
      { from: 2, to: 3, migrate: (d: unknown) => ({ ...(d as object), step2: true }) },
    ];
    const result = migrateProjectData({ from2: true }, 2, migrations, 3);
    expect(result).toEqual({ ok: true, data: { from2: true, step2: true }, applied: [3] });
  });

  it('版数の連なりに穴があれば拒否する（推測で読み進めない）', () => {
    const migrations = [{ from: 1, to: 2, migrate: (d: unknown) => d }];
    const result = migrateProjectData({}, 1, migrations, 3);
    expect(!result.ok && result.reason).toBe('noPath');
    expect(!result.ok && result.formatVersion).toBe(2);
  });
});
