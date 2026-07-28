/**
 * アンカー 1 点方式の検証（T-08、仕様書 §5.6）。
 *
 * 実データ（`data/route.json`）を使う。停留所 7 件・パターン 14 件は合成データを
 * 組み立てるより読みやすく、区間所要時間の非対称性（箕面〜吹田で往復 5 分違う）や
 * 0 分区間（微研 → 工学部前）といった、この方式が実際に扱う条件をそのまま含む。
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Trip } from '@/domain/model';
import { loadNetworkDef, type NetworkIndex } from '@/domain/network';
import { formatTime, fromHM, MAX_SECONDS, seconds, type Seconds } from '@/domain/time';
import {
  allTimes,
  changePattern,
  isAnchored,
  originStopId,
  originTime,
  setTimeAt,
  shiftTrip,
  terminalStopId,
  terminalTime,
  timeAt,
} from './times';

const routeJsonPath = fileURLToPath(new URL('../../../data/route.json', import.meta.url));
const loaded = loadNetworkDef(readFileSync(routeJsonPath, 'utf8'));
if (!loaded.ok) throw new Error('route.json を読み込めません');
const network: NetworkIndex = loaded.network;

const TOYONAKA = '1_0';
const MINOH = '2_0';
const CONVENTION = '3_0';
const SUITA = '4_0';
const HUMAN = '5_0';
const BIKEN = '6_0';

/** S3（箕面経由吹田・40 分）の便。豊中学舎 8:00 発。 */
function makeTrip(overrides: Partial<Trip> = {}): Trip {
  return {
    tripId: 'trip-1',
    patternId: 'S3',
    anchor: { stopId: TOYONAKA, time: fromHM(8, 0) },
    blockId: '1',
    ...overrides,
  };
}

/** 時刻を `H:MM` で読めるようにする。失敗時の差分が秒数だと読めないため。 */
function at(trip: Trip, stopId: string): string | null {
  const time = timeAt(trip, stopId, network);
  return time === null ? null : formatTime(time);
}

describe('timeAt — 基本の導出', () => {
  const trip = makeTrip();

  it('アンカー停留所はアンカー時刻そのもの', () => {
    expect(at(trip, TOYONAKA)).toBe('8:00');
  });

  it.each([
    [MINOH, '8:20'],
    [CONVENTION, '8:35'],
    [SUITA, '8:40'],
  ])('%s の時刻は %s', (stopId, expected) => {
    expect(at(trip, stopId)).toBe(expected);
  });

  it('0 分区間の先にある微生物研究所前は工学部前と同時刻', () => {
    expect(at(trip, BIKEN)).toBe(at(trip, SUITA));
  });

  it('経路に無い停留所は null（時刻表の「−」欄）', () => {
    // S3 は人間科学部前を経由しない（吹田行きはコンベンションセンター前経由）
    expect(at(trip, HUMAN)).toBeNull();
  });

  it('存在しない停留所は null', () => {
    expect(at(trip, 'なにこれ')).toBeNull();
  });

  it('パターンが解決できない便はすべて null', () => {
    const broken = makeTrip({ patternId: 'なにこれ' });
    expect(at(broken, TOYONAKA)).toBeNull();
  });

  it('アンカー停留所が経路に無い便はすべて null', () => {
    const broken = makeTrip({ anchor: { stopId: HUMAN, time: fromHM(8, 0) } });
    expect(at(broken, TOYONAKA)).toBeNull();
  });
});

describe('timeAt — 逆方向と非対称な所要時間', () => {
  it('T3（箕面経由豊中・45 分）を工学部前 9:00 発とすると豊中学舎 9:45 着', () => {
    const trip = makeTrip({ patternId: 'T3', anchor: { stopId: SUITA, time: fromHM(9, 0) } });
    expect(at(trip, HUMAN)).toBe('9:05');
    expect(at(trip, MINOH)).toBe('9:25');
    expect(at(trip, TOYONAKA)).toBe('9:45');
  });

  it('箕面〜吹田は向きによって所要時間が違う（S2 は 20 分、M4 は 25 分）', () => {
    const outbound = makeTrip({ patternId: 'S2', anchor: { stopId: MINOH, time: fromHM(10, 0) } });
    const inbound = makeTrip({ patternId: 'M4', anchor: { stopId: SUITA, time: fromHM(10, 0) } });
    expect(at(outbound, SUITA)).toBe('10:20');
    expect(at(inbound, MINOH)).toBe('10:25');
  });
});

describe('timeAt — 24 時を超える便', () => {
  it('25:00 発の便の終着は 25:40', () => {
    const trip = makeTrip({ anchor: { stopId: TOYONAKA, time: fromHM(25, 0) } });
    expect(at(trip, TOYONAKA)).toBe('25:00');
    expect(at(trip, SUITA)).toBe('25:40');
  });

  it('24 時をまたぐ便が正しく繋がる（23:50 発 → 24:30 着）', () => {
    const trip = makeTrip({ anchor: { stopId: TOYONAKA, time: fromHM(23, 50) } });
    expect(at(trip, SUITA)).toBe('24:30');
  });
});

describe('allTimes', () => {
  it('経路の順に全停留所の時刻を返す', () => {
    expect([...allTimes(makeTrip(), network)].map(([id, t]) => [id, formatTime(t)])).toEqual([
      [TOYONAKA, '8:00'],
      [MINOH, '8:20'],
      [CONVENTION, '8:35'],
      [BIKEN, '8:40'],
      [SUITA, '8:40'],
    ]);
  });

  it('経路に無い停留所は含まない', () => {
    expect(allTimes(makeTrip(), network).has(HUMAN)).toBe(false);
  });

  it('パターンが解決できなければ空', () => {
    expect(allTimes(makeTrip({ patternId: 'なにこれ' }), network).size).toBe(0);
  });

  it('範囲を外れる停留所は含まない', () => {
    // T3 の終着を 0:00 とすると、始発の工学部前は 45 分前＝負になる
    const trip = makeTrip({ patternId: 'T3', anchor: { stopId: TOYONAKA, time: seconds(0) } });
    const times = allTimes(trip, network);
    expect(times.has(TOYONAKA)).toBe(true);
    expect(times.has(SUITA)).toBe(false);
  });
});

describe('始発・終着のヘルパ', () => {
  const trip = makeTrip();

  it('始発と終着の停留所を返す', () => {
    expect(originStopId(trip, network)).toBe(TOYONAKA);
    expect(terminalStopId(trip, network)).toBe(SUITA);
  });

  it('始発と終着の時刻を返す', () => {
    expect(originTime(trip, network)).toBe(fromHM(8, 0));
    expect(terminalTime(trip, network)).toBe(fromHM(8, 40));
  });

  it('アンカーが途中停留所でも始発時刻を導出できる', () => {
    const anchored = makeTrip({ anchor: { stopId: MINOH, time: fromHM(9, 0) } });
    expect(originTime(anchored, network)).toBe(fromHM(8, 40));
  });

  it('パターンが解決できなければ null', () => {
    const broken = makeTrip({ patternId: 'なにこれ' });
    expect(originStopId(broken, network)).toBeNull();
    expect(terminalStopId(broken, network)).toBeNull();
    expect(originTime(broken, network)).toBeNull();
    expect(terminalTime(broken, network)).toBeNull();
  });
});

describe('setTimeAt — アンカーの更新（仕様書 §5.6、UC-3）', () => {
  it('途中停留所に時刻を設定すると始発を含む全時刻が再計算される', () => {
    const next = setTimeAt(makeTrip(), MINOH, fromHM(9, 0), network);
    expect(next).not.toBeNull();
    if (next === null) return;
    expect(at(next, TOYONAKA)).toBe('8:40');
    expect(at(next, MINOH)).toBe('9:00');
    expect(at(next, SUITA)).toBe('9:20');
  });

  it('アンカーが指定した停留所に移る', () => {
    const next = setTimeAt(makeTrip(), MINOH, fromHM(9, 0), network);
    expect(next?.anchor).toEqual({ stopId: MINOH, time: fromHM(9, 0) });
  });

  it('**前のアンカーを完全に破棄する** — 2 回続けて別の停留所に設定する', () => {
    // 豊中学舎 8:00 と指定したあと、箕面学舎 9:00 と指定する。
    // 1 回目の「豊中学舎 8:00」は残らず、豊中学舎は 8:40 になる。
    const first = setTimeAt(makeTrip(), TOYONAKA, fromHM(8, 0), network);
    expect(first).not.toBeNull();
    if (first === null) return;
    const second = setTimeAt(first, MINOH, fromHM(9, 0), network);
    expect(second).not.toBeNull();
    if (second === null) return;

    expect(at(second, TOYONAKA)).toBe('8:40');
    expect(second.anchor).toEqual({ stopId: MINOH, time: fromHM(9, 0) });
    // 便が持つのはアンカー 1 点だけであり、以前の指定を記録する場所がない
    expect(Object.keys(second).sort()).toEqual(['anchor', 'blockId', 'patternId', 'tripId']);
  });

  it('同じ停留所に設定し直すと平行移動になる', () => {
    const next = setTimeAt(makeTrip(), TOYONAKA, fromHM(8, 30), network);
    expect(at(next ?? makeTrip(), SUITA)).toBe('9:10');
  });

  it('元の便を書き換えない', () => {
    const trip = makeTrip();
    setTimeAt(trip, MINOH, fromHM(9, 0), network);
    expect(trip.anchor).toEqual({ stopId: TOYONAKA, time: fromHM(8, 0) });
  });

  it('経路に無い停留所には設定できない', () => {
    expect(setTimeAt(makeTrip(), HUMAN, fromHM(9, 0), network)).toBeNull();
  });

  it('始発が負になる時刻は設定できない', () => {
    const trip = makeTrip({ patternId: 'T3' });
    expect(setTimeAt(trip, TOYONAKA, fromHM(0, 30), network)).toBeNull();
  });

  it('終着が上限を超える時刻は設定できない', () => {
    expect(setTimeAt(makeTrip(), TOYONAKA, seconds(MAX_SECONDS), network)).toBeNull();
  });

  it('上限ちょうどに終着する便は設定できる', () => {
    const time = (MAX_SECONDS - 40 * 60) as Seconds;
    const next = setTimeAt(makeTrip(), TOYONAKA, time, network);
    expect(next).not.toBeNull();
    expect(terminalTime(next ?? makeTrip(), network)).toBe(MAX_SECONDS);
  });
});

describe('shiftTrip — 平行移動', () => {
  it('全時刻が同じ分だけ動く', () => {
    const next = shiftTrip(makeTrip(), 15, network);
    expect(next).not.toBeNull();
    if (next === null) return;
    expect(at(next, TOYONAKA)).toBe('8:15');
    expect(at(next, SUITA)).toBe('8:55');
  });

  it('負の分で前にずらせる', () => {
    expect(at(shiftTrip(makeTrip(), -20, network) ?? makeTrip(), TOYONAKA)).toBe('7:40');
  });

  it('アンカー停留所は変わらない（スジの傾きが変わらない）', () => {
    const trip = makeTrip({ anchor: { stopId: MINOH, time: fromHM(9, 0) } });
    expect(shiftTrip(trip, 10, network)?.anchor).toEqual({
      stopId: MINOH,
      time: fromHM(9, 10),
    });
  });

  it('5 分の倍数でない分は受け付けない', () => {
    expect(shiftTrip(makeTrip(), 3, network)).toBeNull();
  });

  it('範囲を外れる移動はできない', () => {
    expect(shiftTrip(makeTrip(), -600, network)).toBeNull();
  });

  it('アンカー自体は範囲内でも、終着が上限を超えるなら移動できない', () => {
    // 47:15 発なら終着 47:55 でちょうど上限。5 分ずらすと終着が 48:00 になる。
    const late = makeTrip({ anchor: { stopId: TOYONAKA, time: fromHM(47, 15) } });
    expect(terminalTime(late, network)).toBe(MAX_SECONDS);
    expect(shiftTrip(late, 5, network)).toBeNull();
  });
});

describe('changePattern — パターン変更（仕様書 §6.1.4）', () => {
  it('アンカー停留所が新パターンにもあればアンカーを引き継ぐ', () => {
    // S3（箕面経由吹田）→ S1（直行吹田）。アンカーは豊中学舎で両方にある。
    const next = changePattern(makeTrip(), 'S1', network);
    expect(next?.anchor).toEqual({ stopId: TOYONAKA, time: fromHM(8, 0) });
    expect(next?.patternId).toBe('S1');
  });

  it('直行に変えると所要時間が縮む（40 分 → 30 分）', () => {
    const next = changePattern(makeTrip(), 'S1', network);
    expect(at(next ?? makeTrip(), SUITA)).toBe('8:30');
  });

  it('**アンカー停留所が失われる場合**は新パターンの始発に移し、元の始発時刻を引き継ぐ', () => {
    // 箕面学舎 8:20 をアンカーとする S3 の便を、箕面学舎を通らない S1 に変える。
    const trip = makeTrip({ anchor: { stopId: MINOH, time: fromHM(8, 20) } });
    expect(originTime(trip, network)).toBe(fromHM(8, 0));

    const next = changePattern(trip, 'S1', network);
    expect(next?.anchor).toEqual({ stopId: TOYONAKA, time: fromHM(8, 0) });
    expect(at(next ?? trip, SUITA)).toBe('8:30');
  });

  it('始発停留所そのものが変わる場合も引き継ぐ', () => {
    // S3（豊中発）→ S2（箕面発）。アンカーの豊中学舎は S2 に無い。
    const next = changePattern(makeTrip(), 'S2', network);
    expect(next?.anchor).toEqual({ stopId: MINOH, time: fromHM(8, 0) });
    expect(originStopId(next ?? makeTrip(), network)).toBe(MINOH);
  });

  it('営業便から回送便へも変えられる', () => {
    const next = changePattern(makeTrip(), 'DT-in', network);
    expect(next?.patternId).toBe('DT-in');
    expect(at(next ?? makeTrip(), '9_0')).toBe('8:20');
  });

  it('元の便を書き換えない', () => {
    const trip = makeTrip();
    changePattern(trip, 'S1', network);
    expect(trip.patternId).toBe('S3');
  });

  it('存在しないパターンには変えられない', () => {
    expect(changePattern(makeTrip(), 'なにこれ', network)).toBeNull();
  });

  it('変更前のパターンが解決できなければ変えられない', () => {
    const broken = makeTrip({
      patternId: 'なにこれ',
      anchor: { stopId: HUMAN, time: fromHM(8, 0) },
    });
    expect(changePattern(broken, 'S1', network)).toBeNull();
  });

  it('アンカーを引き継いだ結果が範囲を外れる場合は変えられない', () => {
    // 豊中学舎 0:05 発の M2（20 分）を T3（工学部前始発・45 分）に変える。
    // アンカーの豊中学舎は T3 にもあるが、そこは T3 の終着であり、始発は 45 分前
    // ＝負になる。
    const trip = makeTrip({ patternId: 'M2', anchor: { stopId: TOYONAKA, time: fromHM(0, 5) } });
    expect(changePattern(trip, 'T3', network)).toBeNull();
  });

  it('始発時刻を引き継いだ結果が範囲を外れる場合も変えられない', () => {
    // 人間科学部前 47:30 をアンカーとする T1（30 分）の便。始発 47:25・終着 47:55 で
    // それ自体は表現できる。人間科学部前を通らない S3（40 分）に変えると、始発
    // 47:25 を引き継いだ終着が 48:05 になり上限を超える。
    const trip = makeTrip({ patternId: 'T1', anchor: { stopId: HUMAN, time: fromHM(47, 30) } });
    expect(terminalTime(trip, network)).toBe(MAX_SECONDS);
    expect(changePattern(trip, 'S3', network)).toBeNull();
  });
});

describe('アンカー方式の帰結', () => {
  let trip: Trip;
  beforeEach(() => {
    trip = makeTrip();
  });

  it('どの停留所を基準にしても、便が表す時刻の組は同一', () => {
    const byOrigin = allTimes(trip, network);
    const byMiddle = setTimeAt(trip, CONVENTION, fromHM(8, 35), network);
    expect(byMiddle).not.toBeNull();
    if (byMiddle === null) return;
    expect([...allTimes(byMiddle, network)]).toEqual([...byOrigin]);
  });

  it('区間所要時間が変わってもアンカーの 1 点は動かない（UC-5）', () => {
    // 所要時間の改定は route.json の側で起きる。ここでは、豊中〜箕面が 20 分から
    // 25 分に延びたネットワークを作り、箕面学舎を基準に固定した便を確かめる。
    const revised = { ...network.def, segments: network.def.segments.map(withMinoh25) };
    const revisedIndex = loadNetworkDef(JSON.stringify(revised));
    expect(revisedIndex.ok).toBe(true);
    if (!revisedIndex.ok) return;

    const anchored = makeTrip({ anchor: { stopId: MINOH, time: fromHM(9, 0) } });
    expect(timeAt(anchored, MINOH, revisedIndex.network)).toBe(fromHM(9, 0));
    // 始発は 5 分早まる。基準にした箕面学舎 9:00 は動かない。
    expect(originTime(anchored, revisedIndex.network)).toBe(fromHM(8, 35));
  });
});

function withMinoh25(segment: { fromStopId: string; toStopId: string; runMinutes: number }): {
  fromStopId: string;
  toStopId: string;
  runMinutes: number;
} {
  const isToyonakaMinoh =
    (segment.fromStopId === TOYONAKA && segment.toStopId === MINOH) ||
    (segment.fromStopId === MINOH && segment.toStopId === TOYONAKA);
  return isToyonakaMinoh ? { ...segment, runMinutes: 25 } : segment;
}

describe('アンカー未設定の便（仕様書 §6.1.4）', () => {
  const empty: Trip = { ...makeTrip(), anchor: null };

  it('isAnchored が false', () => {
    expect(isAnchored(empty)).toBe(false);
    expect(isAnchored(makeTrip())).toBe(true);
  });

  it('すべての停留所の時刻が null', () => {
    expect(at(empty, TOYONAKA)).toBeNull();
    expect(at(empty, SUITA)).toBeNull();
  });

  it('allTimes が空', () => {
    expect(allTimes(empty, network).size).toBe(0);
  });

  it('始発・終着の停留所は分かるが、時刻は無い', () => {
    expect(originStopId(empty, network)).toBe(TOYONAKA);
    expect(terminalStopId(empty, network)).toBe(SUITA);
    expect(originTime(empty, network)).toBeNull();
    expect(terminalTime(empty, network)).toBeNull();
  });

  it('**時刻を設定すると通常の便になる**（初回入力の経路）', () => {
    const filled = setTimeAt(empty, MINOH, fromHM(9, 0), network);
    expect(filled).not.toBeNull();
    if (filled === null) return;
    expect(isAnchored(filled)).toBe(true);
    expect(at(filled, TOYONAKA)).toBe('8:40');
    expect(at(filled, SUITA)).toBe('9:20');
  });

  it('平行移動はできない（動かす時刻が無い）', () => {
    expect(shiftTrip(empty, 15, network)).toBeNull();
  });

  it('**パターンは変えられる。未設定のまま経路だけが変わる**', () => {
    const changed = changePattern(empty, 'S1', network);
    expect(changed?.patternId).toBe('S1');
    expect(changed?.anchor).toBeNull();
  });

  it('パターン変更が仮の時刻を作らない', () => {
    // 引き継ぐ時刻が無いのだから、始発 0:00 のような値を捏造してはならない
    const changed = changePattern(empty, 'S2', network);
    expect(changed === null ? null : originTime(changed, network)).toBeNull();
  });

  it('存在しないパターンには変えられない', () => {
    expect(changePattern(empty, 'なにこれ', network)).toBeNull();
  });
});
