/**
 * 便の距離の検証（T-63、#161、仕様書 v1.1 §6.1）。
 *
 * **付録 B の 6 つの行程が、区間の合計と一致すること**をここで固定する。
 * 区間表を直したときに行程が合わなくなれば、ここが落ちる。
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadNetworkDef, type NetworkIndex } from '@/domain/network';
import { METERS_PER_KM, formatKm, patternDistance, sumDistances } from './distance';

const routeJsonPath = fileURLToPath(new URL('../../../data/route.json', import.meta.url));
const loaded = loadNetworkDef(readFileSync(routeJsonPath, 'utf8'));
if (!loaded.ok) throw new Error('route.json を読み込めません');
const network: NetworkIndex = loaded.network;

describe('patternDistance', () => {
  /*
   * 仕様書 v1.1 付録 B.3 の検算。**提出された 6 つの行程すべてが、区間の合計と
   * 一致する。** ここが落ちたら、区間表か行程のどちらかが間違っている。
   */
  it.each([
    ['S1', '[直] 豊中 → 吹田', 9.8],
    ['T1', '[直] 吹田 → 豊中', 11.6],
    ['M2', '豊中 → 箕面', 6.4],
    ['T2', '箕面 → 豊中', 6.5],
    ['S3', '豊中 → 箕面 → 吹田', 13.8],
    ['T3', '吹田 → 箕面 → 豊中', 16.5],
    ['S2', '箕面 → 吹田', 7.4],
    ['M4', '吹田 → 箕面', 10.0],
  ])('%s（%s）は %s km', (patternId, _label, km) => {
    expect(patternDistance(patternId, network)).toBe(Math.round(km * METERS_PER_KM));
  });

  it('回送も距離を持つ（**回送も走っている**）', () => {
    expect(patternDistance('DT-out', network)).toBe(5600);
  });

  it('知らないパターンは分からない', () => {
    expect(patternDistance('無い', network)).toBeNull();
  });

  it('**距離の入っていない区間を通れば分からない**（0 として足さない）', () => {
    // 版数 1（距離なし）の定義を組み立てる。入力漏れが「短い運用」に化けない
    // ことを確かめる。
    const withoutDistances = loadNetworkDef(
      JSON.stringify({
        ...network.def,
        version: 1,
        segments: network.def.segments.map(({ distanceMeters: _drop, ...rest }) => rest),
      }),
    );
    if (!withoutDistances.ok) throw new Error('組み立てられません');

    expect(patternDistance('S1', withoutDistances.network)).toBeNull();
  });
});

describe('sumDistances', () => {
  it('足す', () => {
    expect(sumDistances([100, 200, 300])).toBe(600);
  });

  it('空なら 0', () => {
    expect(sumDistances([])).toBe(0);
  });

  it('**1 つでも分からなければ分からない**（一部が抜けた合計を出さない）', () => {
    expect(sumDistances([100, null, 300])).toBeNull();
  });
});

describe('formatKm', () => {
  it('小数第 1 位まで出す', () => {
    expect(formatKm(8500)).toBe('8.5 km');
    expect(formatKm(0)).toBe('0.0 km');
  });

  it('丸めは近いほう', () => {
    expect(formatKm(1250)).toBe('1.3 km');
  });
});
