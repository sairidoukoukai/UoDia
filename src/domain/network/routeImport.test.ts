/**
 * 路線の取り込みで何が起きるかを数える（T-91、#235）。
 *
 * 受入条件は 2 つ。**当てる前に増減が見える**ことと、**参照が壊れる便が先に
 * 分かる**こと。どちらも「当ててから気づく」を避けるためにある。
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createProject } from '@/domain/io';
import type { NetworkDef, Project } from '@/domain/model';
import { createTrip } from '@/domain/service';
import { fromHM } from '@/domain/time';
import { loadNetworkDef, type NetworkIndex } from './index';
import { changeCount, summarizeRouteImport } from './routeImport';

const routeJsonPath = fileURLToPath(new URL('../../../data/route.json', import.meta.url));
const loaded = loadNetworkDef(readFileSync(routeJsonPath, 'utf8'));
if (!loaded.ok) throw new Error('route.json を読み込めません');
const network: NetworkIndex = loaded.network;

/** 便を `count` 本持つ文書。 */
function makeProject(patternId = 'S3'): Project {
  const project = createProject(network, { now: new Date('2026-08-13T00:00:00Z') });
  const [service] = project.services;
  if (service === undefined) throw new Error('ダイヤがありません');

  const inserted = createTrip([], patternId, '1_0', fromHM(9, 0), network);
  if (inserted === null) throw new Error('便を作れません');

  return { ...project, services: [{ ...service, trips: [...inserted.trips] }] };
}

describe('何も変わらないとき', () => {
  it('**同じ路線を取り込んでも変更にしない**', () => {
    const summary = summarizeRouteImport(makeProject(), network.def);

    expect(summary.unchanged).toBe(true);
    expect(changeCount(summary.stops)).toBe(0);
    expect(changeCount(summary.patterns)).toBe(0);
    expect(summary.brokenTrips).toEqual([]);
  });

  it('**所要時間だけの違いも「変わらない」とは言わない**', () => {
    const incoming: NetworkDef = {
      ...network.def,
      segments: network.def.segments.map((s, i) => (i === 0 ? { ...s, runMinutes: 30 } : s)),
    };
    const summary = summarizeRouteImport(makeProject(), incoming);

    // 増減は 0 だが、**中身は違う。**
    expect(changeCount(summary.segments)).toBe(0);
    expect(summary.unchanged).toBe(false);
  });
});

describe('増減が見える（受入条件）', () => {
  it('**停留所が増えれば名前で出る**', () => {
    const incoming: NetworkDef = {
      ...network.def,
      stops: [
        ...network.def.stops,
        {
          stopId: '7_0',
          stopName: '新キャンパス前',
          shortName: '新キャン',
          area: '',
          axisPosition: 60,
          gridStyle: 'normal',
          hiddenInEditor: false,
          isDepot: false,
        },
      ],
    };

    expect(summarizeRouteImport(makeProject(), incoming).stops.added).toEqual(['新キャンパス前']);
  });

  it('**パターンが減れば ID で出る**', () => {
    const incoming: NetworkDef = {
      ...network.def,
      patterns: network.def.patterns.filter((p) => p.patternId !== 'S1'),
    };

    expect(summarizeRouteImport(makeProject(), incoming).patterns.removed).toEqual(['S1']);
  });

  it('区間は向きを含めて数える（片道だけ直すことがある）', () => {
    const incoming: NetworkDef = {
      ...network.def,
      segments: network.def.segments.filter(
        (s) => !(s.fromStopId === '1_0' && s.toStopId === '2_0'),
      ),
    };

    expect(summarizeRouteImport(makeProject(), incoming).segments.removed).toEqual(['1_0 → 2_0']);
  });
});

describe('参照が壊れる便が先に分かる（受入条件）', () => {
  it('**使っているパターンが消えると、その便が挙がる**', () => {
    const incoming: NetworkDef = {
      ...network.def,
      patterns: network.def.patterns.filter((p) => p.patternId !== 'S3'),
    };

    const broken = summarizeRouteImport(makeProject('S3'), incoming).brokenTrips;
    expect(broken).toHaveLength(1);
    expect(broken[0]?.patternId).toBe('S3');
    expect(broken[0]?.serviceId).toBe('weekday');
  });

  it('使っていないパターンが消えても挙がらない', () => {
    const incoming: NetworkDef = {
      ...network.def,
      patterns: network.def.patterns.filter((p) => p.patternId !== 'M4'),
    };

    expect(summarizeRouteImport(makeProject('S3'), incoming).brokenTrips).toEqual([]);
  });

  it('**回送も数える**（出入庫は便から展開されるが、パターンは指されている）', () => {
    // 出区を立てた便は、回送パターンが無くなると出入庫を作れない。
    const incoming: NetworkDef = {
      ...network.def,
      patterns: network.def.patterns.filter((p) => !p.isDeadhead),
    };

    // 営業便そのものは壊れない（指しているのは S3）。
    expect(summarizeRouteImport(makeProject('S3'), incoming).brokenTrips).toEqual([]);
    // 回送パターンが減ったことは増減に出る。
    expect(summarizeRouteImport(makeProject('S3'), incoming).patterns.removed).toContain('DT-out');
  });
});
