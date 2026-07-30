/**
 * 線種の割り当ての検証（T-26、仕様書 §9.4）。
 *
 * **色の見分けがつかなくても数えられること**を確かめる。同じ方向のパターンが
 * 同じ線種になっていれば、色以外に手掛かりが無い。
 */

import { describe, expect, it } from 'vitest';
import type { StopPattern } from '@/domain/model';
import { DEADHEAD_DASH, assignPatternDashes, patternDashAt } from './tripStyle';

function pattern(patternId: string, directionId: 0 | 1, isDeadhead = false): StopPattern {
  return {
    patternId,
    patternName: patternId,
    routeName: '豊中吹田線',
    directionId,
    color: '#000000',
    isDefault: false,
    isDeadhead,
    stopSequence: [
      { stopId: '1_0', handling: 'boardOnly' },
      { stopId: '4_0', handling: 'alightOnly' },
    ],
  };
}

describe('営業パターン', () => {
  it('**同じ方向のパターンは違う線種になる**', () => {
    const dashes = assignPatternDashes([
      pattern('S1', 0),
      pattern('S3', 0),
      pattern('S2', 0),
      pattern('M2', 0),
    ]);

    const assigned = [...dashes.values()].map((dash) => dash.join(','));
    expect(new Set(assigned).size).toBe(4);
  });

  it('**方向をまたぐと使い回す**（方向は線の傾きで分かる。§6.2.1）', () => {
    const dashes = assignPatternDashes([pattern('S1', 0), pattern('T1', 1)]);

    expect(dashes.get('S1')).toEqual(dashes.get('T1'));
  });

  it('1 本目は実線', () => {
    expect(assignPatternDashes([pattern('S1', 0)]).get('S1')).toEqual([]);
  });

  it('数を超えたら先頭から巡回する', () => {
    expect(patternDashAt(4)).toEqual(patternDashAt(0));
    expect(patternDashAt(5)).toEqual(patternDashAt(1));
  });

  it('定義の順だけで決まる（同じ路線図なら同じ絵になる）', () => {
    const patterns = [pattern('S1', 0), pattern('S3', 0)];

    expect(assignPatternDashes(patterns)).toEqual(assignPatternDashes([...patterns]));
  });
});

describe('回送パターン', () => {
  it('**すべて同じ破線**（回送どうしを見分ける必要はない）', () => {
    const dashes = assignPatternDashes([
      pattern('DS-out', 0, true),
      pattern('DS-in', 1, true),
      pattern('DT-out', 1, true),
    ]);

    for (const dash of dashes.values()) expect(dash).toEqual(DEADHEAD_DASH);
  });

  it('営業パターンの線種を消費しない', () => {
    const dashes = assignPatternDashes([
      pattern('DS-out', 0, true),
      pattern('S1', 0),
      pattern('DS-in', 1, true),
      pattern('S3', 0),
    ]);

    // 回送を挟んでも、営業パターンは 1 本目・2 本目として割り当てられる。
    expect(dashes.get('S1')).toEqual(patternDashAt(0));
    expect(dashes.get('S3')).toEqual(patternDashAt(1));
  });

  it('回送は営業パターンと違う線種を使う', () => {
    expect(DEADHEAD_DASH).not.toEqual(patternDashAt(0));
    expect(DEADHEAD_DASH).not.toEqual(patternDashAt(1));
  });
});
