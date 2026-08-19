/**
 * `data/route.json` そのものの検証（T-05）。
 *
 * 仕様書 §5.5.2 の R-01〜R-07 と、付録 A.4 の全区間所要時間が実データと
 * 一致することを確認する。R-01〜R-07 を再利用可能な検証器として切り出すのは
 * T-06 の担当であり、本テストはそれまでの間 `route.json` の正しさを保証する。
 *
 * ファイルは `fs` で読む。アプリ本体も `PlatformAdapter` 経由で文字列として
 * 読み込むため（実装計画書 §3.3）、バンドラの JSON import に依存しない形を
 * とることで実際の読込経路に近づけている。
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { networkDefSchema, parseWithSchema, type NetworkDef } from '@/domain/model';
import { loadNetworkDef, type LoadNetworkResult } from './load';
import { formatNetworkIssues, validateNetwork } from './validate';

const routeJsonPath = fileURLToPath(new URL('../../../data/route.json', import.meta.url));
const rawJson = readFileSync(routeJsonPath, 'utf8');

/** 読込に失敗した理由を、段階ごとに読める形にする。 */
function formatLoadFailure(result: LoadNetworkResult): string {
  if (result.ok) return '';
  switch (result.stage) {
    case 'json':
      return `JSON 構文エラー: ${result.message}`;
    case 'schema':
      return `スキーマ違反:\n${result.issues.map((i) => `${i.path}: ${i.message}`).join('\n')}`;
    case 'rules':
      return `規則違反:\n${formatNetworkIssues(result.issues)}`;
  }
}

function loadNetwork(): NetworkDef {
  const result = parseWithSchema(networkDefSchema, JSON.parse(rawJson));
  if (!result.ok) {
    throw new Error(
      `route.json がスキーマに適合しません:\n${JSON.stringify(result.issues, null, 2)}`,
    );
  }
  return result.value;
}

const network = loadNetwork();
const segmentKey = (from: string, to: string): string => `${from}→${to}`;
const segmentMap = new Map(network.segments.map((s) => [segmentKey(s.fromStopId, s.toStopId), s]));
const stopIds = new Set(network.stops.map((s) => s.stopId));

describe('route.json — スキーマ適合', () => {
  it('networkDefSchema で読み込める', () => {
    expect(parseWithSchema(networkDefSchema, JSON.parse(rawJson)).ok).toBe(true);
  });

  it('停留所 7 件・区間 19 件・パターン 20 件を持つ', () => {
    expect(network.stops).toHaveLength(7);
    // 版数 5 で停留所間の直通を 4 本足した（#247）。
    expect(network.segments).toHaveLength(19);
    expect(network.patterns).toHaveLength(20);
  });

  it('営業パターン 8 件・回送パターン 12 件', () => {
    expect(network.patterns.filter((p) => !p.isDeadhead)).toHaveLength(8);
    expect(network.patterns.filter((p) => p.isDeadhead)).toHaveLength(12);
  });

  it('**回送は 2 つの系統に分かれる**（車庫との出入りと、停留所間。#247）', () => {
    const byRoute = new Map<string, number>();
    for (const pattern of network.patterns.filter((p) => p.isDeadhead)) {
      byRoute.set(pattern.routeName, (byRoute.get(pattern.routeName) ?? 0) + 1);
    }

    expect(Object.fromEntries(byRoute)).toEqual({ 回送: 6, 区間回送: 6 });
  });

  it('**営業便の端どうしが、どの向きにも繋がる**（6 通り。#247）', () => {
    // 区間便を組み合わせると、営業所を経由しない移動が要る。**繋げない対が
    // 1 つでもあると、そこだけ運用を組めない。**
    const ends = new Set<string>();
    for (const pattern of network.patterns.filter((p) => !p.isDeadhead)) {
      ends.add(pattern.stopSequence[0]?.stopId ?? '');
      ends.add(pattern.stopSequence.at(-1)?.stopId ?? '');
    }
    expect([...ends].sort()).toEqual(['1_0', '2_0', '4_0']);

    const between = new Set(
      network.patterns
        .filter((p) => p.routeName === '区間回送')
        .map((p) => `${p.stopSequence[0]?.stopId ?? ''}→${p.stopSequence.at(-1)?.stopId ?? ''}`),
    );

    for (const from of ends) {
      for (const to of ends) {
        if (from === to) continue;
        expect(between).toContain(`${from}→${to}`);
      }
    }
    // 過不足なく 6 通り。**要らない対を先回りして作っていない。**
    expect(between.size).toBe(6);
  });

  it('**停留所間の回送は直通で書く**（経由地を並べない）', () => {
    // 経由地の扱い（`handling`）に正しい値が無い——`stop` も `boardOnly` も
    // `alightOnly` も、誰も乗り降りしない回送では嘘になる。**車庫との回送も
    // 直通で書いてある**（`9_0 → 4_0`）ので、それに揃える。
    for (const pattern of network.patterns.filter((p) => p.isDeadhead)) {
      expect(pattern.stopSequence).toHaveLength(2);
    }
  });

  it('**回送の系統に印が付いている**（R-07 が照らす先）', () => {
    const deadheadRoutes = (network.routes ?? []).filter((route) => route.isDeadhead);
    expect(deadheadRoutes.map((route) => route.routeName).sort()).toEqual(['区間回送', '回送']);
  });

  it('**回送の ID はすべて `D` で始まる**（#262）', () => {
    // 出入庫は `DS-out` `DT-in` …、停留所間は `DM-T` `DT-S` …。**同じ「客を
    // 乗せない便」が 2 つの綴りで並んでいた**（区間回送だけが `X` だった）。
    // ID の一覧を上から読んで、**営業便か回送かが 1 文字目で分かる。**
    for (const pattern of network.patterns.filter((p) => p.isDeadhead)) {
      expect(pattern.patternId.startsWith('D'), pattern.patternId).toBe(true);
    }
  });

  it('**営業便の ID は `D` で始まらない**（1 文字目が種別を決める）', () => {
    for (const pattern of network.patterns.filter((p) => !p.isDeadhead)) {
      expect(pattern.patternId.startsWith('D'), pattern.patternId).toBe(false);
    }
  });

  it('**停留所間の回送は営業所を含まない**（それが表したかったこと）', () => {
    const between = network.patterns.filter((p) => p.routeName === '区間回送');
    expect(between).toHaveLength(6);

    for (const pattern of between) {
      expect(pattern.stopSequence.map((entry) => entry.stopId)).not.toContain('9_0');
    }
  });
});

describe('route.json — 停留所（仕様書 付録 A.1）', () => {
  it('千里営業所が isDepot である', () => {
    expect(network.stops.find((s) => s.stopId === '9_0')?.isDepot).toBe(true);
  });

  it('千里営業所だけが営業所である', () => {
    expect(network.stops.filter((s) => s.isDepot).map((s) => s.stopId)).toEqual(['9_0']);
  });

  it('微生物研究所前が hiddenInEditor である', () => {
    expect(network.stops.find((s) => s.stopId === '6_0')?.hiddenInEditor).toBe(true);
  });

  it('微生物研究所前だけが非表示である', () => {
    expect(network.stops.filter((s) => s.hiddenInEditor).map((s) => s.stopId)).toEqual(['6_0']);
  });

  it('豊中学舎の axisPosition が 0 である', () => {
    expect(network.stops.find((s) => s.stopId === '1_0')?.axisPosition).toBe(0);
  });

  it('axisPosition が方向 0（吹田方面＝下向き）の順に並んでいる', () => {
    const order = ['1_0', '2_0', '3_0', '5_0', '6_0', '4_0'];
    const positions = order.map(
      (id) => network.stops.find((s) => s.stopId === id)?.axisPosition ?? Number.NaN,
    );
    // **戻らなければよい。** 所要時間 0 の区間（微研→工学部前）と、同じ所要時間の
    // 停留所（コンベ前・人科前）は同じ位置に来る（#117）。
    for (let i = 1; i < positions.length; i++) {
      expect(positions[i]).toBeGreaterThanOrEqual(positions[i - 1] ?? Number.NaN);
    }
  });

  it('**コンベ前と人科前が同じ位置にある**（#117）', () => {
    // どちらも工学部前から 5 分である。違う高さに置くと、同じ 5 分の区間が
    // 違う傾きで描かれ、ダイヤグラムの読み方（傾き＝速さ）が壊れる。
    const conv = network.stops.find((s) => s.stopId === '3_0')?.axisPosition;
    const human = network.stops.find((s) => s.stopId === '5_0')?.axisPosition;
    expect(conv).toBe(human);
  });

  it('**軸差が所要時間と一致する**（同じ所要時間は同じ傾きになる。#117）', () => {
    const posOf = (id: string): number =>
      network.stops.find((s) => s.stopId === id)?.axisPosition ?? Number.NaN;
    const depotIds = new Set(network.stops.filter((s) => s.isDepot).map((s) => s.stopId));

    /**
     * 一致させられない区間。
     *
     * 網目の路線を 1 本の縦軸に潰した以上、すべては合わせられない。**直行は
     * 箕面を経由しないぶん速い**ため、箕面を通る軸の上では必ず寝る（往復とも
     * 25 分 = 35 単位で、食い違い方は揃っている）。人科前→箕面も、箕面と
     * 工学部前の位置が先に決まっている以上、動かす余地が無い。
     *
     * **停留所間の回送の直通も、同じ理由を引き継ぐ**（#247）。3 本とも上の
     * 区間を含む道の合計であり、**元が合わないものの和が合うことはない。**
     *
     * | 直通 | 通る道 | 合わない元 |
     * | --- | --- | --- |
     * | `1_0>4_0` | 豊中 → コンベ前 → 微研 → 工学部 | `1_0>3_0` |
     * | `4_0>1_0` | 工学部 → 人科前 → 豊中 | `5_0>1_0` |
     * | `4_0>2_0` | 工学部 → 人科前 → 箕面 | `5_0>2_0` |
     *
     * **`2_0>4_0` は入れていない。** 箕面 → コンベ前 → 微研 → 工学部 は
     * 20 分 = 20 単位で合っており、**除ける理由が無い。**
     */
    const unavoidable = new Set(['1_0>3_0', '5_0>1_0', '5_0>2_0', '1_0>4_0', '4_0>1_0', '4_0>2_0']);

    for (const segment of network.segments) {
      if (depotIds.has(segment.fromStopId) || depotIds.has(segment.toStopId)) continue;
      const key = `${segment.fromStopId}>${segment.toStopId}`;
      if (unavoidable.has(key)) continue;

      expect(Math.abs(posOf(segment.toStopId) - posOf(segment.fromStopId)), key).toBe(
        segment.runMinutes,
      );
    }
  });

  it('営業所の axisPosition が営業区間の外側にある（縦軸には並べない。#118）', () => {
    const depot = network.stops.find((s) => s.isDepot)?.axisPosition ?? Number.NaN;
    const serviceMax = Math.max(
      ...network.stops.filter((s) => !s.isDepot).map((s) => s.axisPosition),
    );
    expect(depot).toBeGreaterThan(serviceMax);
  });

  it('stopId が重複しない', () => {
    expect(stopIds.size).toBe(network.stops.length);
  });
});

describe('route.json — ネットワーク定義の検証（仕様書 §5.5.2）', () => {
  // 各規則そのものの振る舞いは validate.test.ts が網羅する。ここでは実データが
  // すべての規則を満たすことだけを確認する（T-06 で検証器を切り出した）。
  it('R-01〜R-10 のすべてを満たす', () => {
    const issues = validateNetwork(network);
    expect(formatNetworkIssues(issues)).toBe('');
  });

  it('loadNetworkDef が段階を通過して読み込める', () => {
    const result = loadNetworkDef(rawJson);
    expect(result.ok, result.ok ? '' : formatLoadFailure(result)).toBe(true);
  });

  it('使われていない区間が存在しない', () => {
    const used = new Set<string>();
    for (const p of network.patterns) {
      for (let i = 1; i < p.stopSequence.length; i++) {
        used.add(segmentKey(p.stopSequence[i - 1]?.stopId ?? '', p.stopSequence[i]?.stopId ?? ''));
      }
    }
    for (const key of segmentMap.keys()) {
      expect(used.has(key), `区間 ${key} はどのパターンからも使われていない`).toBe(true);
    }
  });
});

describe('route.json — 全区間所要時間（仕様書 付録 A.4）', () => {
  /** パターンの停留所列に沿って区間表を引き、始発から終着までの所要時間を求める。 */
  function totalMinutes(patternId: string): number {
    const pattern = network.patterns.find((p) => p.patternId === patternId);
    if (!pattern) throw new Error(`パターン ${patternId} が見つかりません`);
    let total = 0;
    for (let i = 1; i < pattern.stopSequence.length; i++) {
      const key = segmentKey(
        pattern.stopSequence[i - 1]?.stopId ?? '',
        pattern.stopSequence[i]?.stopId ?? '',
      );
      const segment = segmentMap.get(key);
      if (!segment) throw new Error(`区間 ${key} が見つかりません`);
      total += segment.runMinutes;
    }
    return total;
  }

  it.each([
    ['S1', '直行吹田', 30],
    ['T1', '直行豊中', 30],
    ['M2', '箕面（豊中発）', 20],
    ['T2', '豊中（箕面発）', 20],
    ['S3', '箕面経由吹田', 40],
    ['T3', '箕面経由豊中', 45],
    ['S2', '吹田（箕面発）', 20],
    ['M4', '箕面（吹田発）', 25],
  ])('%s（%s）は %d 分', (patternId, _name, expected) => {
    expect(totalMinutes(patternId)).toBe(expected);
  });

  it('車庫との回送 6 種はすべて 20 分', () => {
    // 営業所は 3 拠点のいずれからも 20 分にある（#118）。
    for (const p of network.patterns.filter((x) => x.routeName === '回送')) {
      expect(totalMinutes(p.patternId), p.patternId).toBe(20);
    }
  });

  it('**停留所間の回送は営業便と同じ所要時間である**（#247）', () => {
    // 空車でも道は同じである。**回送だから速い、ということはない。**
    expect(totalMinutes('DT-M')).toBe(20); // 豊中 → 箕面（M2 と同じ）
    expect(totalMinutes('DM-T')).toBe(20); // 箕面 → 豊中（T2 と同じ）
    expect(totalMinutes('DT-S')).toBe(30); // 豊中 → 工学部（コンベ前経由）
    expect(totalMinutes('DS-T')).toBe(30); // 工学部 → 豊中（人科前経由）
    expect(totalMinutes('DM-S')).toBe(20); // 箕面 → 工学部（S2 と同じ）
    expect(totalMinutes('DS-M')).toBe(25); // 工学部 → 箕面（M4 と同じ。往復で非対称）
  });

  it('箕面〜吹田間は往復で 5 分非対称（経路が異なるため。仕様書 付録 A.4）', () => {
    expect(totalMinutes('S2')).toBe(20); // 箕面 → コンベ経由 → 吹田
    expect(totalMinutes('M4')).toBe(25); // 吹田 → 人科経由 → 箕面
  });

  it('豊中〜吹田（直行）と豊中〜箕面は往復対称', () => {
    expect(totalMinutes('S1')).toBe(totalMinutes('T1'));
    expect(totalMinutes('M2')).toBe(totalMinutes('T2'));
  });
});

describe('route.json — 停車パターンの取扱区分', () => {
  it('始発は boardOnly、終着は alightOnly', () => {
    for (const p of network.patterns) {
      expect(p.stopSequence.at(0)?.handling, `${p.patternId} の始発`).toBe('boardOnly');
      expect(p.stopSequence.at(-1)?.handling, `${p.patternId} の終着`).toBe('alightOnly');
    }
  });

  it('微生物研究所前は常に降車専用（仕様書 付録 A.1）', () => {
    for (const p of network.patterns) {
      const biken = p.stopSequence.find((ps) => ps.stopId === '6_0');
      if (biken) {
        expect(biken.handling, p.patternId).toBe('alightOnly');
      }
    }
  });

  it('微生物研究所前はコンベンションセンター前から工学部前へ向かうパターンにのみ現れる', () => {
    for (const p of network.patterns) {
      const index = p.stopSequence.findIndex((ps) => ps.stopId === '6_0');
      if (index >= 0) {
        expect(p.stopSequence[index - 1]?.stopId, p.patternId).toBe('3_0');
        expect(p.stopSequence[index + 1]?.stopId, p.patternId).toBe('4_0');
      }
    }
  });

  it('微生物研究所前から工学部前までが 0 分である（仕様書 §5.5.1）', () => {
    expect(segmentMap.get(segmentKey('6_0', '4_0'))?.runMinutes).toBe(0);
  });
});

describe('route.json — 方向と経路の整合', () => {
  it('方向 0 のパターンは axisPosition が増加する向きに進む', () => {
    const posOf = (id: string): number =>
      network.stops.find((s) => s.stopId === id)?.axisPosition ?? Number.NaN;
    for (const p of network.patterns.filter((x) => x.directionId === 0 && !x.isDeadhead)) {
      for (let i = 1; i < p.stopSequence.length; i++) {
        const prev = posOf(p.stopSequence[i - 1]?.stopId ?? '');
        const curr = posOf(p.stopSequence[i]?.stopId ?? '');
        // 所要時間 0 の区間（微研→工学部前）は同じ位置に来る（#117）。
        expect(curr, p.patternId).toBeGreaterThanOrEqual(prev);
      }
    }
  });

  it('方向 1 のパターンは axisPosition が減少する向きに進む', () => {
    const posOf = (id: string): number =>
      network.stops.find((s) => s.stopId === id)?.axisPosition ?? Number.NaN;
    for (const p of network.patterns.filter((x) => x.directionId === 1 && !x.isDeadhead)) {
      for (let i = 1; i < p.stopSequence.length; i++) {
        const prev = posOf(p.stopSequence[i - 1]?.stopId ?? '');
        const curr = posOf(p.stopSequence[i]?.stopId ?? '');
        expect(curr, p.patternId).toBeLessThanOrEqual(prev);
      }
    }
  });

  it('直行便（S1）は箕面学舎を経由しない', () => {
    const s1 = network.patterns.find((p) => p.patternId === 'S1');
    expect(s1?.stopSequence.some((ps) => ps.stopId === '2_0')).toBe(false);
  });

  it('吹田発のパターンは人間科学部前を、吹田行きはコンベンションセンター前を経由する', () => {
    for (const p of network.patterns.filter((x) => !x.isDeadhead)) {
      const ids = p.stopSequence.map((ps) => ps.stopId);
      expect(ids.includes('3_0') && ids.includes('5_0'), p.patternId).toBe(false);
    }
  });

  it('パターン ID の接頭辞が行先と一致する（S=吹田 / T=豊中 / M=箕面）', () => {
    const terminalOf: Record<string, string> = { S: '4_0', T: '1_0', M: '2_0' };
    for (const p of network.patterns.filter((x) => !x.isDeadhead)) {
      const prefix = p.patternId.charAt(0);
      expect(p.stopSequence.at(-1)?.stopId, p.patternId).toBe(terminalOf[prefix]);
    }
  });
});

describe('route.json — GTFS に要る静的データ（T-70、#198）', () => {
  const network = loadNetwork();

  it('版数 6 である（#262 で区間回送の ID を `D` に改めた）', () => {
    expect(network.version).toBe(6);
  });

  it('事業者は大阪大学である（**同好会ではない**）', () => {
    // バスを走らせているのは大学であり、配信を作っているのが同好会である。
    // GTFS はこの 2 つを agency.txt と feed_info.txt の別の欄で分けている
    // （仕様書 v2 §6.5.1）。
    expect(network.agency?.agencyName).toBe('国立大学法人大阪大学');
    expect(network.agency?.agencyId).toBe('4120905002554');
    expect(network.agency?.agencyTimezone).toBe('Asia/Tokyo');
  });

  it('**すべての停留所が緯度経度を持つ**（車庫を含む）', () => {
    const missing = network.stops.filter((s) => s.lat === undefined || s.lon === undefined);
    expect(missing.map((s) => s.stopId)).toEqual([]);
  });

  it('緯度経度が実例と一致する', () => {
    const toyonaka = network.stops.find((s) => s.stopId === '1_0');
    expect(toyonaka?.lat).toBe(34.80542);
    expect(toyonaka?.lon).toBe(135.45537);
  });

  it('**パターンが使う系統がすべて `routes` に定義されている**', () => {
    // 1 つでも欠けると、その系統の色と訳語が GTFS に出せない。
    const defined = new Set((network.routes ?? []).map((r) => r.routeName));
    const used = [...new Set(network.patterns.map((p) => p.routeName))];
    expect(used.filter((name) => !defined.has(name))).toEqual([]);
  });

  it('**系統名は方向でひっくり返さない**（往復が同じ `longName` に寄る）', () => {
    // 同じ線の往復に 2 つの名前があると、読む側には別の系統に見える
    // （仕様書 v2 §6.5.3）。
    const routes = new Map((network.routes ?? []).map((r) => [r.routeName, r]));
    const outbound = routes.get('豊中吹田線');
    const inbound = routes.get('吹田豊中線');

    expect(outbound?.longName ?? '豊中吹田線').toBe('豊中吹田線');
    expect(inbound?.longName).toBe('豊中吹田線');
  });

  it('往復の系統が同じ色を持つ', () => {
    const routes = new Map((network.routes ?? []).map((r) => [r.routeName, r]));
    expect(routes.get('吹田豊中線')?.color).toBe(routes.get('豊中吹田線')?.color);
    expect(routes.get('箕面豊中線')?.color).toBe(routes.get('豊中箕面線')?.color);
  });

  it('**GTFS の色は画面のスジ色と別物である**', () => {
    // 画面はスジを描くための濃い色、GTFS は地色として使う淡い色である
    // （仕様書 v2 §6.8）。片方から計算すると、どちらの用途にも合わない色が出る。
    const routes = new Map((network.routes ?? []).map((r) => [r.routeName, r]));
    const s1 = network.patterns.find((p) => p.patternId === 'S1');

    expect(routes.get('豊中吹田線')?.color).toBe('bdd7ee');
    expect(s1?.color).not.toBe(`#${routes.get('豊中吹田線')?.color ?? ''}`);
  });

  it('訳語は `stops.txt` に出す停留所に揃っている', () => {
    // 千里営業所は実例が訳語を持たないため、ここでも持たない。
    const translated = network.stops.filter((s) => !s.isDepot);
    expect(translated.filter((s) => s.nameKana === undefined).map((s) => s.stopId)).toEqual([]);
    expect(translated.filter((s) => s.nameEn === undefined).map((s) => s.stopId)).toEqual([]);
  });
});
