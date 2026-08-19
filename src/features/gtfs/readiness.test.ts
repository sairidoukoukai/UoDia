/**
 * GTFS を出せる状態かの検証（T-81・T-85、仕様書 v2 §3.2）。
 *
 * 受入条件は 2 つ。
 *
 * - **カレンダーを持たないダイヤでは「運行日がありません」と出て、押せない**
 * - **何が足りないかが、直す先とあわせて分かる**
 *
 * 直す先は 3 通りある（T-85）——**移れるタブ**・**手で直す `route.json`**・
 * **1 つに決まらないもの**。三者が混ざらないことをここで固定する。
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createProject } from '@/domain/io';
import type { NetworkDef, Service, ServiceCalendar } from '@/domain/model';
import { loadNetworkDef, type NetworkIndex } from '@/domain/network';
import { createTrip } from '@/domain/service';
import { fromHM } from '@/domain/time';
import { canExportGtfs, describeMissing, missingForGtfs, type MissingItem } from './readiness';

const routeJsonPath = fileURLToPath(new URL('../../../data/route.json', import.meta.url));
const loaded = loadNetworkDef(readFileSync(routeJsonPath, 'utf8'));
if (!loaded.ok) throw new Error('route.json を読み込めません');
const network: NetworkIndex = loaded.network;

const CALENDAR: ServiceCalendar = {
  startDate: '2026-04-01',
  endDate: '2027-03-31',
  weekdays: ['mon', 'tue', 'wed', 'thu', 'fri'],
  closedRanges: [],
};

/** 便を 1 つ持ち、運行日も入ったダイヤ。**これが出せる状態である。** */
function readyService(): Service {
  const project = createProject(network, { now: new Date('2026-08-09T00:00:00Z') });
  const [service] = project.services;
  if (service === undefined) throw new Error('ダイヤがありません');

  const inserted = createTrip([], 'S3', '1_0', fromHM(9, 0), network);
  if (inserted === null) throw new Error('便を作れません');

  return { ...service, trips: [...inserted.trips], calendar: { ...CALENDAR } };
}

/** 足りないものの文言だけを取る。 */
function messagesOf(items: readonly MissingItem[]): string[] {
  return items.map((item) => item.message);
}

describe('揃っているとき', () => {
  it('**足りないものが 1 つも無い**', () => {
    expect(missingForGtfs({ network: network.def, service: readyService() })).toEqual([]);
  });

  it('出せる', () => {
    expect(canExportGtfs({ network: network.def, service: readyService() })).toBe(true);
  });
});

describe('運行日（受入条件）', () => {
  it('**カレンダーを持たないダイヤでは「運行日がありません」と出る**', () => {
    const service = { ...readyService(), calendar: undefined };
    const missing = missingForGtfs({ network: network.def, service });

    expect(messagesOf(missing)).toContain('運行日がありません');
  });

  it('**そのときは出せない**', () => {
    const service = { ...readyService(), calendar: undefined };
    expect(canExportGtfs({ network: network.def, service })).toBe(false);
  });

  it('**直す先はカレンダータブ**', () => {
    const service = { ...readyService(), calendar: undefined };
    const item = missingForGtfs({ network: network.def, service }).find(
      (entry) => entry.message === '運行日がありません',
    );

    expect(item?.fix).toEqual({ kind: 'tab', tab: 'calendar' });
    expect(describeMissing(item ?? { message: '', fix: null })).toBe(
      '運行日がありません（カレンダータブ）',
    );
  });
});

describe('直せる場所を添える（受入条件）', () => {
  it('**緯度経度は route.json**（画面に欄が無い。T-85）', () => {
    const def: NetworkDef = {
      ...network.def,
      stops: network.def.stops.map((stop, index) =>
        index === 0 ? { ...stop, lat: undefined, lon: undefined } : stop,
      ),
    };

    const item = missingForGtfs({ network: def, service: readyService() })[0];
    expect(item?.fix).toEqual({ kind: 'file', file: 'route.json' });
    expect(item?.message).toContain('緯度経度');
    // **どの停留所かを名指しする。** 「どこかが空です」では探すことになる。
    expect(item?.message).toContain(network.def.stops[0]?.shortName ?? '');
  });

  it('**事業者も route.json**（欄の名前で言う。T-85）', () => {
    const def: NetworkDef = { ...network.def, agency: undefined };
    const missing = missingForGtfs({ network: def, service: readyService() });

    expect(missing.every((item) => item.fix?.kind === 'file')).toBe(true);
    expect(messagesOf(missing)).toContain('事業者の「事業者名」が空です');
  });

  it('**route.json のものは「どこを直すか」まで言う**（移れなくても黙らない）', () => {
    const def: NetworkDef = { ...network.def, agency: undefined };
    const item = missingForGtfs({ network: def, service: readyService() })[0];

    expect(describeMissing(item ?? { message: '', fix: null })).toBe(
      '事業者の「事業者名」が空です（route.json を直してください）',
    );
  });

  it('**直す先が決まらないものには添えない**（便・ダイヤ）', () => {
    const service = { ...readyService(), trips: [] };
    const item = missingForGtfs({ network: network.def, service }).find(
      (entry) => entry.message === '便が 1 つもありません',
    );

    expect(item?.fix).toBeNull();
    expect(describeMissing(item ?? { message: '', fix: null })).toBe('便が 1 つもありません');
  });
});

describe('揃っていないとき', () => {
  it('**便が 1 つも無ければ出せない**（走らない路線を配らない）', () => {
    expect(canExportGtfs({ network: network.def, service: { ...readyService(), trips: [] } })).toBe(
      false,
    );
  });

  it('ダイヤが無ければ出せない', () => {
    expect(canExportGtfs({ network: network.def, service: null })).toBe(false);
  });

  it('路線図を読み込んでいなければ、それだけを言う', () => {
    // ほかの検査は路線図を前提にしている。**先に読み込みを促す。**
    expect(missingForGtfs({ network: null, service: null })).toEqual([
      { message: '路線図を読み込んでいません', fix: null },
    ]);
  });

  it('**足りないものが複数あれば全部出す**（1 つ直すたびに次が現れるのを避ける）', () => {
    const def: NetworkDef = { ...network.def, agency: undefined };
    const service = { ...readyService(), calendar: undefined };

    const missing = missingForGtfs({ network: def, service });
    expect(missing.length).toBeGreaterThan(1);
    expect(messagesOf(missing)).toContain('運行日がありません');
  });
});
