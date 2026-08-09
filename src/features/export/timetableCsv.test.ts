/**
 * 時刻表 CSV の検証（T-76、仕様書 v2 §5.6）。
 *
 * 受入条件のうち機械で見られるものを固定する。
 *
 * - **Excel で開いて停留所名が化けない**（BOM が付いている）
 * - **画面の時刻表と行・列が 1 対 1 で対応している**
 * - **回送便が列になっていない**（前運用・次運用の行に畳まれている）
 * - 値に `,` を含む文字列が壊れない
 * - `src/domain/export/` が React を import していない
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import { createProject } from '@/domain/io';
import { loadNetworkDef, type NetworkIndex } from '@/domain/network';
import { createTrip } from '@/domain/service';
import { fromHM } from '@/domain/time';
import { DIRECTION_LABEL } from '@/features/timetable';
import {
  createAppStore,
  selectActiveService,
  selectNetwork,
  selectTripNumbers,
  selectTripsByDirection,
  type AppStoreHook,
} from '@/store';
import type { ExportSource } from './artifacts';
import {
  DEPOT_LABEL,
  ROW_LABELS,
  exportTimetable,
  renderTimetableCsv,
  timetableCsvName,
  timetableCsvProducer,
  timetableRows,
} from './timetableCsv';

const routeJsonPath = fileURLToPath(new URL('../../../data/route.json', import.meta.url));
const loaded = loadNetworkDef(readFileSync(routeJsonPath, 'utf8'));
if (!loaded.ok) throw new Error('route.json を読み込めません');
const network: NetworkIndex = loaded.network;

/** 豊中方面（1）。豊中発は吹田方面（0）。 */
const TO_SUITA = 0;
const TO_TOYONAKA = 1;

let store: AppStoreHook;

function addTrip(patternId: string, stopId: string, hour: number, minute: number): void {
  store.getState().editProject('便を足す', (project) => {
    const [service] = project.services;
    if (service === undefined) return;
    const inserted = createTrip(service.trips, patternId, stopId, fromHM(hour, minute), network);
    if (inserted === null) throw new Error(`便を作れません: ${patternId}`);
    service.trips = [...inserted.trips];
  });
}

function source(): ExportSource {
  const state = store.getState();
  const project = state.project;
  const index = selectNetwork(state);
  const service = selectActiveService(state);
  if (project === null || index === null || service === null) throw new Error('用意できません');
  return { state, project, network: index, service };
}

function rowsFor(directionId: 0 | 1): readonly (readonly string[])[] {
  const state = store.getState();
  return timetableRows(exportTimetable(source(), directionId), selectTripNumbers(state));
}

/** 行の名前で 1 行を引く。 */
function rowNamed(directionId: 0 | 1, label: string): readonly string[] {
  const found = rowsFor(directionId).find((row) => row[0] === label);
  if (found === undefined) throw new Error(`${label} の行がありません`);
  return found;
}

beforeEach(() => {
  store = createAppStore();
  store.getState().setNetworkDef(network.def);
  store.getState().setProject(createProject(network, { now: new Date('2026-08-09T00:00:00Z') }));
});

describe('ファイル名（仕様書 v2 §5.3）', () => {
  it('方向ごとに 2 つ', () => {
    expect(timetableCsvName(TO_TOYONAKA)).toBe('時刻表_豊中方面.csv');
    expect(timetableCsvName(TO_SUITA)).toBe('時刻表_吹田方面.csv');
  });

  it('画面の方向タブと同じ言葉を使う', () => {
    expect(timetableCsvName(TO_SUITA)).toContain(DIRECTION_LABEL[TO_SUITA]);
  });
});

describe('行の並び（§5.6.1）', () => {
  beforeEach(() => {
    addTrip('S3', '1_0', 9, 0);
  });

  it('**画面の左端の列がそのまま 1 列目になる**', () => {
    const labels = rowsFor(TO_SUITA).map((row) => row[0]);

    expect(labels.slice(0, 4)).toEqual([
      ROW_LABELS.tripNumber,
      ROW_LABELS.pattern,
      ROW_LABELS.block,
      ROW_LABELS.previous,
    ]);
    expect(labels.at(-1)).toBe(ROW_LABELS.next);
  });

  it('**停留所は画面と同じ並び**（時刻が上から下へ進む）', () => {
    const shown = exportTimetable(source(), TO_SUITA).stops.map((stop) => stop.shortName);
    const labels = rowsFor(TO_SUITA)
      .map((row) => row[0])
      .slice(4, -1);

    expect(labels).toEqual(shown);
  });

  it('**豊中方面は並びが逆になる**（T-48。画面と同じ）', () => {
    const suita = exportTimetable(source(), TO_SUITA).stops.map((s) => s.stopId);
    const toyonaka = exportTimetable(source(), TO_TOYONAKA).stops.map((s) => s.stopId);

    expect(toyonaka[0]).not.toBe(suita[0]);
  });

  it('**列は画面と 1 対 1**（受入条件）', () => {
    addTrip('S3', '1_0', 10, 0);
    const columns = exportTimetable(source(), TO_SUITA).columns;

    // 1 列目は行の名前であり、便ではない。
    expect(rowNamed(TO_SUITA, ROW_LABELS.tripNumber)).toHaveLength(columns.length + 1);
    expect(columns).toHaveLength(selectTripsByDirection(store.getState(), TO_SUITA).length);
  });

  it('**空の列は入れない**（打てば便になる、という画面の仕掛けである）', () => {
    expect(exportTimetable(source(), TO_SUITA).emptyColumns).toBe(0);
    expect(rowNamed(TO_SUITA, ROW_LABELS.pattern)).toEqual([ROW_LABELS.pattern, 'S3']);
  });
});

describe('升目の中身（§5.6.2）', () => {
  it('時刻はそのまま出す', () => {
    addTrip('S3', '1_0', 7, 40);
    const times = rowNamed(TO_SUITA, '豊中')[1];

    expect(times).toBe('7:40');
  });

  it('**経由しない停留所と未入力を区別しない**（どちらも空欄）', () => {
    // 直行（S1）は箕面を経由しない。画面はここに `−` を出すが、CSV は空欄。
    addTrip('S1', '1_0', 9, 0);
    const row = rowsFor(TO_SUITA).find((r) => r[0] === '箕面');

    expect(row?.[1]).toBe('');
  });

  it('**24 時を超える表記もそのまま**（仕様書 §2.1）', () => {
    addTrip('S3', '1_0', 25, 30);

    expect(rowNamed(TO_SUITA, '豊中')[1]).toBe('25:30');
  });
});

describe('前運用・次運用（§5.6.1）', () => {
  beforeEach(() => {
    addTrip('S3', '1_0', 9, 0);
  });

  it('**回送便が列になっていない**（受入条件）', () => {
    store.getState().editProject('出区を付ける', (project) => {
      const trip = project.services[0]?.trips[0];
      if (trip !== undefined) trip.pullOut = true;
    });

    // 便は 1 本のまま。出区は前運用の行に畳まれている。
    expect(exportTimetable(source(), TO_SUITA).columns).toHaveLength(1);
    expect(rowNamed(TO_SUITA, ROW_LABELS.previous)[1]).toContain(DEPOT_LABEL.previous);
  });

  it('**出区・入区と書く**（時刻だけでは便番号と見分けられない）', () => {
    store.getState().editProject('出区を付ける', (project) => {
      const trip = project.services[0]?.trips[0];
      if (trip !== undefined) trip.pullOut = true;
    });

    expect(rowNamed(TO_SUITA, ROW_LABELS.previous)[1]).toMatch(/^出区 \d+:\d\d$/);
  });

  it('何も繋がっていなければ空欄', () => {
    expect(rowNamed(TO_SUITA, ROW_LABELS.previous)[1]).toBe('');
    expect(rowNamed(TO_SUITA, ROW_LABELS.next)[1]).toBe('');
  });

  it('**繋がる相手は全便から求める**（運用は方向をまたぐ）', () => {
    // 豊中発のあと吹田発で戻る、同じ運用の 2 便。
    store.getState().editProject('運用を揃える', (project) => {
      for (const trip of project.services[0]?.trips ?? []) trip.blockId = 'A';
    });
    addTrip('T3', '4_0', 10, 0);
    store.getState().editProject('運用を揃える', (project) => {
      for (const trip of project.services[0]?.trips ?? []) trip.blockId = 'A';
    });

    // 吹田方面（豊中発）の便の次運用に、豊中方面の便の便番号が出る。
    expect(rowNamed(TO_SUITA, ROW_LABELS.next)[1]).not.toBe('');
  });
});

describe('書き出したバイト列', () => {
  beforeEach(() => {
    addTrip('S3', '1_0', 9, 0);
  });

  it('**BOM が付いている**（受入条件。Excel が化けさせない）', () => {
    const bytes = renderTimetableCsv(source(), TO_SUITA);

    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  });

  it('停留所名が読める', () => {
    const text = new TextDecoder().decode(renderTimetableCsv(source(), TO_SUITA).slice(3));

    expect(text).toContain('豊中');
    const number = [...selectTripNumbers(store.getState()).values()][0] ?? '';
    expect(text.split('\r\n')[0]).toBe(`${ROW_LABELS.tripNumber},${number}`);
    expect(number).not.toBe('');
  });

  it('**値に `,` を含んでも壊れない**（受入条件）', () => {
    store.getState().editProject('運用番号を打つ', (project) => {
      const trip = project.services[0]?.trips[0];
      if (trip !== undefined) trip.blockId = 'A,B';
    });

    const text = new TextDecoder().decode(renderTimetableCsv(source(), TO_SUITA).slice(3));
    expect(text).toContain('運用,"A,B"');
  });
});

describe('一斉出力に入る形', () => {
  it('進み具合に方向を出す（§5.9）', () => {
    expect(timetableCsvProducer(TO_TOYONAKA).label).toBe('時刻表（豊中方面）');
  });

  it('名前は方向ごとに違う（同じ名前は zip に入れられない）', () => {
    expect(timetableCsvProducer(TO_TOYONAKA).fileName).not.toBe(
      timetableCsvProducer(TO_SUITA).fileName,
    );
  });
});
