// @vitest-environment jsdom

/**
 * 時刻表グリッドの描画の検証（T-19、仕様書 §6.1.1）。
 *
 * 中身の組み立ては `model.test.ts` が受け持つ。ここで固定するのは
 * **画面に何が見えるか**である。経由しない升目の `−`・アンカーの目印・
 * 停留所名の列が残ること——いずれも間違えても型検査を通ってしまう。
 */

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
// jsdom 環境では `import.meta.url` がファイルの場所を指さないため、node:fs で
// 読めない。Vite の生読み込みに任せる。
import routeJson from '../../../data/route.json?raw';
import type { Trip } from '@/domain/model';
import { loadNetworkDef, type NetworkIndex } from '@/domain/network';
import { fromHM, type Seconds } from '@/domain/time';
import { allTimes } from '@/domain/trip';
import { buildTimetable, stopsForDirection } from './model';
import { TimetableGrid } from './TimetableGrid';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const loaded = loadNetworkDef(routeJson);
if (!loaded.ok) throw new Error('route.json を読み込めません');
const network: NetworkIndex = loaded.network;

let counter = 0;

function makeTrip(
  patternId: string,
  hours: number,
  minutes: number,
  extra: Partial<Trip> = {},
): Trip {
  const pattern = network.patternIndex(patternId);
  if (pattern === undefined) throw new Error(`パターン ${patternId} がありません`);
  counter += 1;
  return {
    tripId: `t${String(counter)}`,
    patternId,
    anchor: { stopId: pattern.originStopId, time: fromHM(hours, minutes) },
    blockId: '',
    tripShortName: '',
    ...extra,
  };
}

let container: HTMLDivElement;

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
});

afterEach(() => {
  container.remove();
});

function render(trips: readonly Trip[]): void {
  const times = new Map<string, ReadonlyMap<string, Seconds>>(
    trips.map((trip) => [trip.tripId, allTimes(trip, network)]),
  );
  const timetable = buildTimetable(trips, stopsForDirection(network, 0), network, times);

  const root = createRoot(container);
  act(() => {
    root.render(<TimetableGrid timetable={timetable} />);
  });
}

/** 行の見出し（停留所名）から、その行の升目の文字列を並べて返す。 */
function rowOf(stopName: string): (string | null)[] {
  const heading = [...container.querySelectorAll('tbody th')].find(
    (th) => th.textContent === stopName,
  );
  if (heading === undefined) throw new Error(`${stopName} の行がありません`);
  return [...(heading.parentElement?.querySelectorAll('td') ?? [])].map((td) => td.textContent);
}

describe('見出し', () => {
  it('パターン・行先・便番号・運用を出す', () => {
    render([makeTrip('S1', 8, 0, { tripShortName: 'E1', blockId: 'A' })]);

    const headings = [...container.querySelectorAll('thead th[scope="row"]')].map(
      (th) => th.textContent,
    );
    expect(headings).toEqual(['パターン', '行先', '便番号', '運用']);

    const cells = [...container.querySelectorAll('thead td')].map((td) => td.textContent);
    expect(cells).toEqual(['S1', '直行吹田', 'E1', 'A']);
  });

  it('便番号と運用が空なら印を出す（空欄と区別する）', () => {
    render([makeTrip('S1', 8, 0)]);
    const cells = [...container.querySelectorAll('thead td')].map((td) => td.textContent);
    expect(cells).toEqual(['S1', '直行吹田', '―', '―']);
  });

  it('**回送便の列は見出しで分かる**', () => {
    render([makeTrip('S1', 8, 0), makeTrip('DT-in', 8, 0)]);

    const tops = [...container.querySelectorAll('thead tr:first-child th[scope="col"]')];
    expect(tops.map((th) => th.textContent)).toEqual(['停留所', '1便', '2便回送']);
    expect(tops[2]?.className).toContain('deadhead');
  });

  it('参照が壊れた列は行先を「？」にし、目印を付ける', () => {
    render([makeTrip('S1', 8, 0, { patternId: '無いパターン' })]);

    expect([...container.querySelectorAll('thead td')].map((td) => td.textContent)).toEqual([
      '無いパターン',
      '？',
      '―',
      '―',
    ]);
    expect(container.querySelector('.timetable__head--broken')).not.toBeNull();
  });
});

describe('升目（受入条件）', () => {
  it('**直行便の箕面学舎は `−`、箕面経由便は時刻**', () => {
    render([makeTrip('S1', 8, 0), makeTrip('S3', 8, 30)]);
    expect(rowOf('箕面学舎')).toEqual(['−', '8:50']);
  });

  it('**アンカーの升目が目印で分かる**', () => {
    render([makeTrip('S1', 8, 0)]);

    const anchors = [...container.querySelectorAll('.timetable__cell--anchor')];
    expect(anchors).toHaveLength(1);
    expect(anchors[0]?.textContent).toBe('△8:00');
  });

  it('取扱区分の記号を時刻に添える', () => {
    // 箕面学舎は S2 では始発（乗車のみ）、M2 では終着（降車のみ）。
    render([makeTrip('S2', 8, 0), makeTrip('M2', 8, 0)]);
    expect(rowOf('箕面学舎')).toEqual(['△8:00', '▽8:20']);
  });

  it('時刻が未入力なら空欄にする（`−` とは違う）', () => {
    render([makeTrip('S1', 8, 0, { anchor: null })]);
    expect(rowOf('豊中学舎')).toEqual(['△']);
    expect(rowOf('箕面学舎')).toEqual(['−']);
  });
});

describe('並び', () => {
  it('行は縦軸の順、営業所は最後', () => {
    render([makeTrip('S1', 8, 0)]);
    expect([...container.querySelectorAll('tbody th')].map((th) => th.textContent)).toEqual([
      '豊中学舎',
      '箕面学舎',
      'コンベンションセンター前',
      '工学部前',
      '千里営業所',
    ]);
  });

  it('停留所名の列は横スクロールしても残す', () => {
    render([makeTrip('S1', 8, 0)]);
    // 位置の固定は CSS が行う。ここでは目印が付いていることだけを確かめる。
    expect(container.querySelector('tbody th')?.className).toContain('timetable__stop');
    expect(container.querySelector('.timetable__scroll')).not.toBeNull();
  });
});

describe('便が無いとき', () => {
  it('表ではなく案内を出す', () => {
    render([]);
    expect(container.querySelector('table')).toBeNull();
    expect(container.textContent).toContain('まだありません');
  });
});

describe('多数の便', () => {
  it('100 便でも全部の列を描く（間引かない）', () => {
    const trips = Array.from({ length: 100 }, (_, index) =>
      makeTrip('S1', 6 + Math.floor(index / 12), (index % 12) * 5),
    );
    render(trips);

    expect(container.querySelectorAll('thead tr:first-child th[scope="col"]')).toHaveLength(101);
    expect(rowOf('豊中学舎')).toHaveLength(100);
  });
});
