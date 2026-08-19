/**
 * GTFS の検証（T-82、仕様書 v2 §6）。
 *
 * ## 実例と突き合わせる
 *
 * 突き合わせ先が `docs/gtfs_example/` にある。**ただし便のデータは違う**——実例は
 * 実際に配信されているダイヤであり、テストで組む便と一致しようがない。
 *
 * | 突き合わせ方 | ファイル |
 * | --- | --- |
 * | **1 バイトも違わない** | `agency` `feed_info` `stops` `office_jp` `transfers` `shapes` |
 * | 中身を揃えて比べる | `routes` `translations` |
 * | **見出しだけ** | `trips` `stop_times` `calendar` `calendar_dates` |
 *
 * **見出しは 12 ファイルすべてで一致させる。** 列が 1 つ増減しただけで、読む側の
 * 取り込みが崩れる。
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import { createProject } from '@/domain/io';
import type { Service, ServiceCalendar } from '@/domain/model';
import { loadNetworkDef, type NetworkIndex } from '@/domain/network';
import { expandDeadheads, numberTrips } from '@/domain/trip';
import { addTripForTest } from './build.test-utils';
import { buildGtfs, GTFS_SERVICE_ID } from './build';
import type { GtfsFile } from './format';

const here = (name: string): string => fileURLToPath(new URL(name, import.meta.url));

const loaded = loadNetworkDef(readFileSync(here('../../../../data/route.json'), 'utf8'));
if (!loaded.ok) throw new Error('route.json を読み込めません');
const network: NetworkIndex = loaded.network;

const exampleDir = here('../../../../docs/gtfs_example');
const examplePath = (name: string): string => join(exampleDir, name);
const shapes = readFileSync(examplePath('shapes.txt'), 'utf8');

/**
 * 実例の 1 ファイル。**BOM と `\r` を落として読む。**
 *
 * **実例は改行が混ざっている。** `agency` `feed_info` `office_jp` `routes`
 * `shapes` `stops` `transfers` `translations` は CRLF、`calendar`
 * `calendar_dates` `stop_times` `trips` は LF である。作った道具が違うのだろう。
 * **本ソフトは LF に揃える**（仕様書 v2 §6.3.1）ため、比べるときは改行を
 * 落として並べる。
 */
function example(name: string): string {
  return readFileSync(examplePath(name), 'utf8')
    .replace(/^\ufeff/, '')
    .replaceAll('\r', '');
}

const CALENDAR: ServiceCalendar = {
  startDate: '2026-04-01',
  endDate: '2027-02-08',
  weekdays: ['mon', 'tue', 'wed', 'thu', 'fri'],
  closedRanges: [{ from: '2026-08-06', to: '2026-08-10' }],
};

let service: Service;

/** 出来たファイルを名前で引く。 */
function fileNamed(files: readonly GtfsFile[], name: string): GtfsFile {
  const found = files.find((file) => file.name === name);
  if (found === undefined) throw new Error(`${name} がありません`);
  return found;
}

/** 中身を文字列で読む。**BOM を落とす。** */
function textOf(files: readonly GtfsFile[], name: string): string {
  return new TextDecoder().decode(fileNamed(files, name).bytes).replace(/^\ufeff/, '');
}

/**
 * 行に切る。**末尾の改行で空行が出るため落とす。**
 *
 * `\r` も落とす。素通しする `shapes.txt` だけが CRLF であり（上記）、行の中身を
 * 比べるときにそれを持ち回っても意味が無い。
 */
function linesOf(files: readonly GtfsFile[], name: string): string[] {
  return textOf(files, name).replaceAll('\r', '').split('\n').slice(0, -1);
}

function build(): readonly GtfsFile[] {
  return buildGtfs({ network, service, shapes });
}

beforeEach(() => {
  const project = createProject(network, { now: new Date('2026-08-09T00:00:00Z') });
  const [first] = project.services;
  if (first === undefined) throw new Error('ダイヤがありません');

  let trips = addTripForTest([], 'S3', '1_0', 7, 40, 'A', network);
  trips = addTripForTest(trips, 'T3', '4_0', 8, 30, 'A', network);
  trips = addTripForTest(trips, 'S1', '1_0', 9, 20, 'B', network);
  // 出区と入区を付ける。**回送は保存されず、書き出すときに展開される。**
  trips = trips.map((trip, index) =>
    index === 0 ? { ...trip, pullOut: true } : index === 1 ? { ...trip, pullIn: true } : trip,
  );

  service = { ...first, trips, calendar: CALENDAR };
});

describe('出すファイル（§6.4）', () => {
  it('**12 ファイル出す**', () => {
    expect(
      build()
        .map((file) => file.name)
        .sort(),
    ).toEqual(readdirSync(exampleDir).sort());
  });

  it('**すべてに BOM が付く**（§6.3.1。12 ファイルすべて）', () => {
    for (const file of build()) {
      expect([...file.bytes.slice(0, 3)], file.name).toEqual([0xef, 0xbb, 0xbf]);
    }
  });

  it('**改行は LF**（§6.3.1）', () => {
    for (const file of build()) {
      // `shapes.txt` は素通しである（§6.5.7）。**中身に手を入れない**以上、
      // 実例の CRLF がそのまま出る。
      if (file.name === 'shapes.txt') continue;
      expect(new TextDecoder().decode(file.bytes).includes('\r'), file.name).toBe(false);
    }
  });

  it('**末尾に改行を 1 つ置く**', () => {
    for (const file of build()) {
      const text = new TextDecoder().decode(file.bytes);
      expect(text.endsWith('\n'), file.name).toBe(true);
      expect(text.endsWith('\n\n'), file.name).toBe(false);
    }
  });
});

describe('見出しが実例と一致する', () => {
  it('**12 ファイルすべて**', () => {
    for (const name of readdirSync(exampleDir)) {
      expect(linesOf(build(), name)[0], name).toBe(example(name).split('\n')[0]);
    }
  });
});

describe('1 バイトも違わないファイル', () => {
  for (const name of ['agency.txt', 'feed_info.txt', 'office_jp.txt', 'transfers.txt']) {
    it(name, () => {
      expect(textOf(build(), name)).toBe(example(name));
    });
  }

  it('**stops.txt は車庫の 1 行だけが違う**（`location_type`）', () => {
    const ours = linesOf(build(), 'stops.txt');
    const theirs = example('stops.txt').split('\n').slice(0, -1);

    // 車庫（`9_0`）以外はそのまま一致する。
    expect(ours.filter((line) => !line.startsWith('9_0,'))).toEqual(
      theirs.filter((line) => !line.startsWith('9_0,')),
    );
  });

  it('**車庫も `location_type: 0` で出す**（`stop_times` から参照するため）', () => {
    // 実例は `1`（駅）としているが、それでは公式の検証器が
    // `location_with_unexpected_stop_time` をエラーとして出す。
    const depot = linesOf(build(), 'stops.txt').find((line) => line.startsWith('9_0,'));
    expect(depot?.endsWith(',0')).toBe(true);
  });

  it('**shapes.txt が実例と 1 バイト違わない**（受入条件。素通し）', () => {
    expect(fileNamed(build(), 'shapes.txt').bytes).toEqual(
      new Uint8Array(readFileSync(examplePath('shapes.txt'))),
    );
  });
});

describe('routes.txt（§6.5.3）', () => {
  it('**1 パターンにつき 1 行**（回送も出す）', () => {
    expect(linesOf(build(), 'routes.txt')).toHaveLength(network.def.patterns.length + 1);
  });

  it('**route_id は patternId**（§6.6）', () => {
    const ids = linesOf(build(), 'routes.txt')
      .slice(1)
      .map((line) => line.split(',')[0]);
    expect(ids).toEqual(network.def.patterns.map((pattern) => pattern.patternId));
  });

  it('**route_long_name を方向でひっくり返さない**', () => {
    const rows = linesOf(build(), 'routes.txt')
      .slice(1)
      .map((line) => line.split(','));
    const forward = rows.find((row) => row[0] === 'S1');
    const backward = rows.find((row) => row[0] === 'T1');

    expect(forward?.[3]).toBe('豊中吹田線');
    expect(backward?.[3]).toBe('豊中吹田線');
  });

  it('**回送は種別を名乗り、行先はパターン名で言う**', () => {
    const row = linesOf(build(), 'routes.txt')
      .slice(1)
      .map((line) => line.split(','))
      .find((entry) => entry[0] === 'DS-out');

    expect(row?.[2]).toBe('回送');
    expect(row?.[3]).toBe('車庫発吹田');
  });

  it('**agency_id に空白を付けない**（§6.7。実例は打ち間違い）', () => {
    const ids = linesOf(build(), 'routes.txt')
      .slice(1)
      .map((line) => line.split(',')[1]);
    expect(new Set(ids)).toEqual(new Set(['4120905002554']));
  });

  it('**route_text_color は 6 桁**（§6.7。実例は `0`）', () => {
    const colors = linesOf(build(), 'routes.txt')
      .slice(1)
      .map((line) => line.split(',')[7]);
    for (const color of colors) expect(color).toMatch(/^[0-9a-f]{6}$/i);
  });

  it('色は実例の値を写している', () => {
    const rows = linesOf(build(), 'routes.txt')
      .slice(1)
      .map((line) => line.split(','));
    expect(rows.find((row) => row[0] === 'S1')?.[6]).toBe('bdd7ee');
    expect(rows.find((row) => row[0] === 'M2')?.[6]).toBe('ffa7a7');
    expect(rows.find((row) => row[0] === 'DS-out')?.[6]).toBe('B0B0B0');
  });
});

describe('trips.txt（§6.5.4）', () => {
  it('**回送便も出す**（3 便 + 出区 + 入区 = 5 行）', () => {
    expect(linesOf(build(), 'trips.txt').slice(1)).toHaveLength(5);
  });

  it('**trip_id は便番号、回送は D1 D2 …**（§6.6）', () => {
    const ids = linesOf(build(), 'trips.txt')
      .slice(1)
      .map((line) => line.split(',')[2] ?? '');

    expect(ids.filter((id) => id.startsWith('D')).sort()).toEqual(['D1', 'D2']);
    expect(ids.filter((id) => !id.startsWith('D'))).toHaveLength(3);
  });

  it('**回送は出入庫も含めて通しで時刻順に振る**（#259）', () => {
    // 保存された回送を 1 本足す。出区（7:40 発）・入区（9:30 着）より遅い。
    service = {
      ...service,
      trips: addTripForTest(service.trips, 'DT-M', '1_0', 10, 0, 'C', network),
    };
    const rows = linesOf(build(), 'trips.txt')
      .slice(1)
      .map((line) => line.split(','));

    expect(rows.map((row) => row[2] ?? '').filter((id) => id.startsWith('D'))).toHaveLength(3);

    // **一番遅い回送であるため D3 になる。** 置かれた便かどうかは見ない。
    const placedRow = rows.find((row) => row[0] === 'DT-M');
    expect(placedRow?.[2]).toBe('D3');

    // **画面でも D3 である。** 画面の側（`selectTripNumbers`）も展開してから
    // 採番に渡しており、**入口が同じであるかぎり出口も同じ**になる。
    const placed = service.trips.find((trip) => trip.patternId === 'DT-M');
    expect(
      numberTrips(expandDeadheads(service.trips, network), network).get(placed?.tripId ?? ''),
    ).toBe('D3');
  });

  it('**trip_headsign は終着停留所の名前**（パターン名ではない）', () => {
    const row = linesOf(build(), 'trips.txt')
      .slice(1)
      .map((line) => line.split(','))
      .find((entry) => entry[0] === 'S3');

    expect(row?.[3]).toBe('工学部前');
  });

  it('**service_id は daily で固定**（§6.5.8）', () => {
    const ids = linesOf(build(), 'trips.txt')
      .slice(1)
      .map((line) => line.split(',')[1]);
    expect(new Set(ids)).toEqual(new Set([GTFS_SERVICE_ID]));
  });

  it('**direction_id と shape_id は空**（実例と同じ。§6.5.7）', () => {
    for (const line of linesOf(build(), 'trips.txt').slice(1)) {
      const row = line.split(',');
      expect(row[4]).toBe('');
      expect(row[6]).toBe('');
    }
  });

  it('block_id を出す', () => {
    const blocks = linesOf(build(), 'trips.txt')
      .slice(1)
      .map((line) => line.split(',')[5]);
    expect(blocks).toContain('A');
    expect(blocks).toContain('B');
  });
});

describe('stop_times.txt（§6.5.5）', () => {
  /** 便ごとの `stop_sequence` の並び。 */
  function sequences(): Map<string, number[]> {
    const found = new Map<string, number[]>();
    for (const line of linesOf(build(), 'stop_times.txt').slice(1)) {
      const row = line.split(',');
      const tripId = row[0] ?? '';
      const list = found.get(tripId) ?? [];
      list.push(Number(row[4]));
      found.set(tripId, list);
    }
    return found;
  }

  it('**stop_sequence が便ごとに 1 から増えている**（受入条件。§6.7.1）', () => {
    for (const [tripId, list] of sequences()) {
      expect(list, tripId).toEqual(list.map((_, index) => index + 1));
    }
  });

  it('**時刻は `7:15:00` の形**（時は 0 詰めしない）', () => {
    const times = linesOf(build(), 'stop_times.txt')
      .slice(1)
      .map((line) => line.split(',')[1] ?? '');
    for (const time of times) expect(time).toMatch(/^\d{1,2}:\d{2}:00$/);
  });

  it('**arrival と departure は同じ値**（このバスに停車時分は無い）', () => {
    for (const line of linesOf(build(), 'stop_times.txt').slice(1)) {
      const row = line.split(',');
      expect(row[1]).toBe(row[2]);
    }
  });

  it('**微生物研究所前を出す**（§6.7。実例には 1 行も無い）', () => {
    const stops = linesOf(build(), 'stop_times.txt')
      .slice(1)
      .map((line) => line.split(',')[3]);
    expect(stops).toContain('6_0');
  });

  it('**コンベンションセンター前と微生物研究所前は乗れない**（受入条件。T-83）', () => {
    const rows = linesOf(build(), 'stop_times.txt')
      .slice(1)
      .map((line) => line.split(','));

    for (const stopId of ['3_0', '6_0']) {
      const found = rows.filter((row) => row[3] === stopId);
      expect(found.length, stopId).toBeGreaterThan(0);
      for (const row of found) expect(row[6], stopId).toBe('1');
    }
  });

  it('**人間科学部前は降りられない**（受入条件。T-83）', () => {
    const found = linesOf(build(), 'stop_times.txt')
      .slice(1)
      .map((line) => line.split(','))
      .filter((row) => row[3] === '5_0');

    expect(found.length).toBeGreaterThan(0);
    for (const row of found) expect(row[7]).toBe('1');
  });

  it('**乗降ともの停留所は空欄**（既定値は書かない。箕面学舎は経路の途中）', () => {
    const found = linesOf(build(), 'stop_times.txt')
      .slice(1)
      .map((line) => line.split(','))
      .filter((row) => row[3] === '2_0');

    for (const row of found) {
      expect(row[6]).toBe('');
      expect(row[7]).toBe('');
    }
  });
});

describe('calendar.txt / calendar_dates.txt（§4.6）', () => {
  it('走る曜日と有効期間を出す', () => {
    expect(linesOf(build(), 'calendar.txt')[1]).toBe('daily,1,1,1,1,1,0,0,20260401,20270208');
  });

  it('**運休だけを出す**（`exception_type: 1` は出さない）', () => {
    const types = linesOf(build(), 'calendar_dates.txt')
      .slice(1)
      .map((line) => line.split(',')[2]);
    expect(new Set(types)).toEqual(new Set(['2']));
  });

  it('**曜日で既に外れている日が出ていない**（受入条件）', () => {
    // 8/6〜8/10 のうち 8/8（土）8/9（日）は、そもそも走らない日である。
    const dates = linesOf(build(), 'calendar_dates.txt')
      .slice(1)
      .map((line) => line.split(',')[1]);

    expect(dates).toEqual(['20260806', '20260807', '20260810']);
  });

  it('日付は `YYYYMMDD`', () => {
    for (const line of linesOf(build(), 'calendar_dates.txt').slice(1)) {
      expect(line.split(',')[1]).toMatch(/^\d{8}$/);
    }
  });
});

describe('translations.txt（§6.5.6）', () => {
  it('**停留所の訳語が実例と一致する**', () => {
    const ours = linesOf(build(), 'translations.txt').filter((line) => line.startsWith('stops,'));
    const theirs = example('translations.txt')
      .split('\n')
      .filter((line) => line.startsWith('stops,'));

    expect(new Set(ours)).toEqual(new Set(theirs));
  });

  it('**実例にある系統の訳語をすべて出す**', () => {
    const ours = new Set(
      linesOf(build(), 'translations.txt').filter((line) => line.startsWith('routes,')),
    );
    const theirs = example('translations.txt')
      .split('\n')
      .filter((line) => line.startsWith('routes,'));

    // **一致ではなく包含で見る**（#247、T-100）。実例に無い系統を足したため
    // ——停留所間の回送（`区間回送`）は、実例が作られた時点に存在しない。
    for (const line of theirs) expect(ours).toContain(line);
  });

  it('**足した系統の訳語も出る**（自分の系統から引く）', () => {
    const ours = linesOf(build(), 'translations.txt');

    expect(ours).toContain('routes,route_long_name,en,Out of Service (between stops),,箕面発豊中');
    // 車庫との出入りは今までどおり `回送` 系統の訳語を使う。
    expect(ours).toContain('routes,route_long_name,en,Out of Service,,箕面発車庫');
  });

  it('**回送は英語名だけを持つ**（実例によみがなが無い）', () => {
    const deadhead = linesOf(build(), 'translations.txt').filter((line) =>
      line.includes('車庫発吹田'),
    );

    expect(deadhead).toEqual(['routes,route_long_name,en,Out of Service,,車庫発吹田']);
  });

  it('**事業者の record_id は法人番号を出す**（実例は表計算に壊されている）', () => {
    const agency = linesOf(build(), 'translations.txt').filter((line) =>
      line.startsWith('agency,'),
    );

    expect(agency).toEqual([
      'agency,agency_name,ja-Hrkt,おおさかだいがく,4120905002554,',
      'agency,agency_name,en,Osaka University,4120905002554,',
    ]);
  });
});

describe('出せないとき', () => {
  it('**運行日が無ければ投げる**（画面が先に弾く）', () => {
    expect(() =>
      buildGtfs({ network, service: { ...service, calendar: undefined }, shapes }),
    ).toThrow(/運行日/);
  });
});

/**
 * 検証器が致命的とする指摘（受入条件）。
 *
 * **公式の検証器**（MobilityData `gtfs-validator` 8.0.1）に実際にかけて、
 * **エラーが 0 件**であることを確かめている。ただし 40MB の jar と Java が要り、
 * CI では走らせられない——**そこが見ている「致命的」の中身をここに置く。**
 *
 * 実例にかけると 3 種類のエラーが出る。**そのすべてを本ソフトは踏まない。**
 *
 * | 実例のエラー | なぜ出るか | 本ソフト |
 * | --- | --- | --- |
 * | `duplicate_key` × 194 | `stop_sequence` が全行 `1` | 1 から順に振る |
 * | `invalid_color` × 10 | `route_text_color` が `0` | 6 桁で出す |
 * | `location_with_unexpected_stop_time` | 車庫が `location_type: 1` | `0` で出す |
 */
describe('検証器が致命的とするもの（受入条件）', () => {
  /** ファイルを列名つきの行に開く。 */
  function table(name: string): Record<string, string>[] {
    const lines = linesOf(build(), name);
    const header = (lines[0] ?? '').split(',');
    return lines.slice(1).map((line) => {
      const values = line.split(',');
      return Object.fromEntries(header.map((key, index) => [key, values[index] ?? '']));
    });
  }

  it('**`trip_id` と `stop_sequence` の組が重ならない**（実例の `duplicate_key`）', () => {
    const keys = table('stop_times.txt').map(
      (row) => `${row.trip_id ?? ''}/${row.stop_sequence ?? ''}`,
    );
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('**色は 6 桁の 16 進数**（実例の `invalid_color`）', () => {
    for (const row of table('routes.txt')) {
      expect(row.route_color, row.route_id).toMatch(/^[0-9a-f]{6}$/i);
      expect(row.route_text_color, row.route_id).toMatch(/^[0-9a-f]{6}$/i);
    }
  });

  it('**`stop_times` が指す停留所はすべて `location_type: 0`**（実例の `location_with_unexpected_stop_time`）', () => {
    const kinds = new Map(table('stops.txt').map((row) => [row.stop_id, row.location_type]));
    for (const row of table('stop_times.txt')) {
      expect(kinds.get(row.stop_id ?? ''), row.stop_id).toBe('0');
    }
  });

  it('**`trips` の `route_id` がすべて `routes` にある**', () => {
    const routes = new Set(table('routes.txt').map((row) => row.route_id));
    for (const row of table('trips.txt'))
      expect(routes.has(row.route_id ?? ''), row.trip_id).toBe(true);
  });

  it('**`stop_times` の `trip_id` がすべて `trips` にある**', () => {
    const trips = new Set(table('trips.txt').map((row) => row.trip_id));
    for (const row of table('stop_times.txt')) expect(trips.has(row.trip_id ?? '')).toBe(true);
  });

  it('**`trips` の `service_id` が `calendar` にある**', () => {
    const services = new Set(table('calendar.txt').map((row) => row.service_id));
    for (const row of table('trips.txt')) expect(services.has(row.service_id ?? '')).toBe(true);
  });

  it('**`trip_id` が重ならない**', () => {
    const ids = table('trips.txt').map((row) => row.trip_id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('**`stop_id` が重ならない**', () => {
    const ids = table('stops.txt').map((row) => row.stop_id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('**便はどれも 2 つ以上の停留所を持つ**（1 点では走ったことにならない）', () => {
    const counts = new Map<string, number>();
    for (const row of table('stop_times.txt')) {
      counts.set(row.trip_id ?? '', (counts.get(row.trip_id ?? '') ?? 0) + 1);
    }
    for (const [tripId, count] of counts) expect(count, tripId).toBeGreaterThanOrEqual(2);
  });
});
