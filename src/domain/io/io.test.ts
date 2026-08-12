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
import { migrateProjectData, migrationsFor, MIGRATIONS_BEFORE_NETWORK } from './migrate';
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
      network: project.network,
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

/**
 * 1 便目の項目だけを書き換えた JSON を作る。
 *
 * **文字列置換では狙えない**（T-89）。版数 5 で路線が文書に入り、`patternId`
 * も `stopId` も**路線の側にも同じ綴りで並んでいる。** キーは辞書順に並ぶため
 * （`serializeProject`）、`network` は `services` より前に来る——素朴に置換すると
 * **路線のほうが書き換わり、区間表の無いパターンができあがる。**
 */
function withTripEdit(project: Project, edit: (trip: Record<string, unknown>) => void): string {
  const raw = JSON.parse(serializeProject(project)) as {
    services: { trips: Record<string, unknown>[] }[];
  };
  const trip = raw.services[0]?.trips[0];
  if (trip === undefined) throw new Error('便がありません');
  edit(trip);
  return JSON.stringify(raw);
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
    const json = withTripEdit(makeProject(), (trip) => {
      trip.patternId = '??';
    });
    const { project, warnings } = loadOrThrow(json);
    expect(warnings.map((w) => w.id)).toContain('W-02');
    expect(project.services[0]?.trips[0]?.patternId).toBe('S3');
  });

  it('W-03: 経路に無いアンカー停留所は時刻を未入力へ倒す', () => {
    // S1（直行）は箕面学舎を通らない
    const json = withTripEdit(makeProject(), (trip) => {
      trip.anchor = { stopId: '2_0', time: fromHM(8, 0) };
    });
    const { project, warnings } = loadOrThrow(json);
    expect(warnings.map((w) => w.id)).toContain('W-03');
    expect(project.services[0]?.trips[0]?.anchor).toBeNull();
  });

  it('パターンを倒した結果アンカーが合わなくなれば両方警告する', () => {
    // S2（箕面発）のアンカーは箕面学舎。パターンが失われて S3（豊中発）へ倒れると
    // 箕面学舎は経路に含まれる…ため、ここでは人間科学部前を使う
    const json = withTripEdit(makeProject([makeTrip({ patternId: 'T1' })]), (trip) => {
      trip.patternId = '??';
      trip.anchor = { stopId: '5_0', time: fromHM(8, 0) };
    });
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
    const json = withTripEdit(makeProject(), (trip) => {
      trip.patternId = '??';
    });
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

    // **便だけを見る**（T-89）。路線には回送パターンの定義そのものが並んで
    // おり、ファイル全体で探すと必ず当たる。
    expect(JSON.stringify(project.services)).not.toContain('DT-out');
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

/**
 * 変換の一覧。**版数 5 への変換は路線を要る**ため、既定を持たない（T-89）。
 * 埋める路線は `route.json` そのものである。
 */
const MIGRATIONS = migrationsFor(network.def);

describe('migrateProjectData — マイグレーションの枠組み（仕様書 §7.3）', () => {
  it('**版数 1 → 2 で便番号を捨てる**（仕様書 §6.1.6、T-46）', () => {
    const v1 = {
      meta: { formatVersion: 1 },
      services: [{ trips: [{ tripId: 't1', patternId: 'S1', tripShortName: 'E1' }] }],
    };
    const result = migrateProjectData(v1, 1, MIGRATIONS);
    if (!result.ok) throw new Error('変換できるはず');

    const trips = (result.data as { services: { trips: object[] }[] }).services[0]?.trips;
    expect(trips?.[0]).toEqual({ tripId: 't1', patternId: 'S1' });
    // 現在の版数まで引き上げられる。
    expect(result.applied).toEqual([2, 3, 4, 5]);
    // 版数の連なりに穴が無いこと。1 つでも欠けると古いファイルが開けなくなる。
    expect(MIGRATIONS.map((m) => [m.from, m.to])).toEqual([
      [1, 2],
      [2, 3],
      [3, 4],
      [4, 5],
    ]);
    // 路線を要らない部分は、路線を渡さずに組み立てられる。
    expect(MIGRATIONS_BEFORE_NETWORK.map((m) => [m.from, m.to])).toEqual([
      [1, 2],
      [2, 3],
      [3, 4],
    ]);
  });

  it('**版数 2 → 3 は版数だけを繰り上げる**（回送便を畳むのは読込時。T-51）', () => {
    const v2 = { meta: { formatVersion: 2 }, services: [{ trips: [{ tripId: 't1' }] }] };
    const result = migrateProjectData(v2, 2, MIGRATIONS, 3);
    if (!result.ok) throw new Error('変換できるはず');

    expect(result.data).toEqual({
      meta: { formatVersion: 3 },
      services: [{ trips: [{ tripId: 't1' }] }],
    });
  });

  it('**版数 3 → 4 も版数だけを繰り上げる**（カレンダーを既定値で埋めない。T-71）', () => {
    // Service.calendar は任意項目であり、持たないことが正しい状態である。埋めれば
    // 「利用者が決めた運行日」と「アプリが入れた運行日」が区別できなくなる。
    const v3 = { meta: { formatVersion: 3 }, services: [{ trips: [{ tripId: 't1' }] }] };
    // **4 で止める。** 5 まで通すと路線が足され、「何も足さない」ことを見られない。
    const result = migrateProjectData(v3, 3, MIGRATIONS, 4);
    if (!result.ok) throw new Error('変換できるはず');

    expect(result.data).toEqual({
      meta: { formatVersion: 4 },
      services: [{ trips: [{ tripId: 't1' }] }],
    });
  });

  it('**版数 4 → 5 で路線を埋める**（#235、T-89）', () => {
    const v4 = { meta: { formatVersion: 4 }, services: [{ trips: [{ tripId: 't1' }] }] };
    const result = migrateProjectData(v4, 4, MIGRATIONS);
    if (!result.ok) throw new Error('変換できるはず');

    const data = result.data as { network: unknown; meta: { formatVersion: number } };
    // **渡された路線がそのまま入る。** 同梱のものではない（実装計画書 v2.2 §3.2）。
    expect(data.network).toEqual(network.def);
    expect(data.meta.formatVersion).toBe(5);
  });

  it('**既に路線を持つファイルは触らない**（手で入れたものを消さない）', () => {
    const mine = {
      version: 1,
      name: '手で入れた',
      timeGrain: 300,
      stops: [],
      segments: [],
      patterns: [],
    };
    const v4 = { meta: { formatVersion: 4 }, network: mine, services: [] };
    const result = migrateProjectData(v4, 4, MIGRATIONS);
    if (!result.ok) throw new Error('変換できるはず');

    expect((result.data as { network: unknown }).network).toEqual(mine);
  });

  it('版数 2 → 3 も、形の違う中身には手を触れない', () => {
    const result = migrateProjectData(null, 2, MIGRATIONS);
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
    const result = migrateProjectData(broken, 1, MIGRATIONS);
    if (!result.ok) throw new Error('変換できるはず');

    expect((result.data as { services: unknown[] }).services).toEqual(broken.services);
  });

  it('現在の版数はそのまま通す', () => {
    const result = migrateProjectData({ a: 1 }, CURRENT_FORMAT_VERSION, MIGRATIONS);
    expect(result).toEqual({ ok: true, data: { a: 1 }, applied: [] });
  });

  it('新しすぎる版数を拒否する', () => {
    const result = migrateProjectData({}, CURRENT_FORMAT_VERSION + 1, MIGRATIONS);
    expect(!result.ok && result.reason).toBe('tooNew');
  });

  it('変換手順が無い古い版数を拒否する', () => {
    const result = migrateProjectData({}, 0, MIGRATIONS);
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

describe('運行日カレンダー（T-71、#197）', () => {
  /** 版数 3 のプロジェクト（カレンダーを持たない）。 */
  function versionThreeJson(): string {
    const project = makeProject();
    return JSON.stringify({
      ...project,
      meta: { ...project.meta, formatVersion: 3 },
    });
  }

  it('**版数 3 のファイルがそのまま開く**', () => {
    const { project } = loadOrThrow(versionThreeJson());
    expect(project.services[0]?.trips).toHaveLength(1);
  });

  it('**カレンダーが無いことについての警告は出ない**（持たないことが正しい状態である）', () => {
    // 出るのは形式変換の知らせ（W-05）だけであり、これは版数を上げれば必ず出る
    // ——版数 3 → 4 と 4 → 5 で 2 回。
    const { warnings } = loadOrThrow(versionThreeJson());
    expect(new Set(warnings.map((w) => w.id))).toEqual(new Set(['W-05']));
  });

  it('カレンダーを持たないダイヤとして開く', () => {
    const { project } = loadOrThrow(versionThreeJson());
    expect(project.services[0]?.calendar).toBeUndefined();
  });

  it('**保存し直すと今の版数になる**', () => {
    const { project } = loadOrThrow(versionThreeJson());
    expect(project.meta.formatVersion).toBe(CURRENT_FORMAT_VERSION);
  });

  it('カレンダーを持つファイルが、往復しても変わらない', () => {
    const project = makeProject();
    const [service] = project.services;
    if (service === undefined) throw new Error('ダイヤがありません');

    const withCalendar: Project = {
      ...project,
      services: [
        {
          ...service,
          calendar: {
            startDate: '2026-04-01',
            endDate: '2027-03-31',
            weekdays: ['mon', 'tue', 'wed', 'thu', 'fri'],
            closedRanges: [{ from: '2026-08-06', to: '2026-09-30', note: '夏季休業' }],
          },
        },
      ],
    };

    const { project: loaded } = loadOrThrow(serializeProject(withCalendar));
    expect(loaded.services[0]?.calendar).toEqual(withCalendar.services[0]?.calendar);
  });
});

describe('路線を文書が持つ（#235、T-89）', () => {
  it('**保存し直したファイルに路線が入っている**', () => {
    const json = serializeProject(makeProject());
    expect(JSON.parse(json)).toHaveProperty('network.stops');
  });

  it('**版数 4 のファイルを開くと、渡した路線が入る**', () => {
    const v4 = withFormatVersion(serializeProject(makeProject()), 4);
    const { project } = loadOrThrow(v4);

    expect(project.network).toEqual(network.def);
    expect(project.meta.formatVersion).toBe(CURRENT_FORMAT_VERSION);
  });

  it('**版数 4 から引き上げても時刻が変わらない**（受入条件）', () => {
    const before = loadOrThrow(serializeProject(makeProject())).project;
    const after = loadOrThrow(withFormatVersion(serializeProject(makeProject()), 4)).project;

    expect(after.services[0]?.trips[0]?.anchor).toEqual(before.services[0]?.trips[0]?.anchor);
  });

  it('**参照を直す相手は、そのファイル自身の路線である**', () => {
    // 区間を 1 つ削った路線を持つ文書を作る。**渡す路線は削っていない。**
    const project = makeProject();
    const trimmed: Project = {
      ...project,
      network: {
        ...project.network,
        patterns: project.network.patterns.filter((p) => p.patternId !== 'S1'),
      },
    };

    // S1 を持たない路線であるため、S1 を使う便は既定パターンへ倒される。
    // 渡した路線（S1 を持つ）を見ていれば、倒れない。
    const { warnings } = loadOrThrow(serializeProject(trimmed));
    expect(warnings.map((w) => w.id)).toContain('W-02');
  });

  it('**路線を書き換えても、保存済みのファイルは動かない**（受入条件）', () => {
    const saved = serializeProject(makeProject());

    const project = loadOrThrow(saved).project;
    const edited: Project = {
      ...project,
      network: {
        ...project.network,
        segments: project.network.segments.map((seg) =>
          seg.fromStopId === '1_0' && seg.toStopId === '3_0' ? { ...seg, runMinutes: 60 } : seg,
        ),
      },
    };
    // 書き換えたほうを保存し直しても、元のファイルは元の値のままである。
    expect(serializeProject(edited)).not.toBe(saved);
    expect(loadOrThrow(saved).project.network).toEqual(network.def);
  });
});
