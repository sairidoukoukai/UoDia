/**
 * 線種の割り当ての検証（T-26、仕様書 §9.4、#114）。
 *
 * **色の見分けがつかなくても読めること**を確かめる。線種が担うのは「各駅か
 * 通過か」の 1 点だけであり、それ以上を線種に載せない。
 */

import { describe, expect, it } from 'vitest';
import type { ServiceType, StopPattern } from '@/domain/model';
import { DEADHEAD_DASH, assignPatternDashes, dashForServiceType } from './tripStyle';

function pattern(
  patternId: string,
  directionId: 0 | 1,
  serviceType: ServiceType | null = 'local',
): StopPattern {
  return {
    patternId,
    patternName: patternId,
    routeName: '豊中吹田線',
    directionId,
    color: '#000000',
    isDefault: false,
    isDeadhead: serviceType === null,
    ...(serviceType === null ? {} : { serviceType }),
    stopSequence: [
      { stopId: '1_0', handling: 'boardOnly' },
      { stopId: '4_0', handling: 'alightOnly' },
    ],
  };
}

describe('営業パターン', () => {
  it('**線種は 2 種類しかない**（各駅と通過。#114）', () => {
    const dashes = assignPatternDashes([
      pattern('S1', 0, 'express'),
      pattern('S3', 0),
      pattern('S2', 0),
      pattern('M2', 0),
    ]);

    const assigned = [...dashes.values()].map((dash) => dash.join(','));
    expect(new Set(assigned).size).toBe(2);
  });

  it('**同じタイプなら同じ線種**（区間便かどうかで分けない）', () => {
    // S3（豊中発）・S2（箕面発）・M2（豊中→箕面）はどれも箕面に停まる。端が
    // どこにあるかはスジを見れば分かるため、線種を分ける理由が無い。
    const dashes = assignPatternDashes([pattern('S3', 0), pattern('S2', 0), pattern('M2', 0)]);

    expect(dashes.get('S2')).toEqual(dashes.get('S3'));
    expect(dashes.get('M2')).toEqual(dashes.get('S3'));
  });

  it('**方向をまたいでも同じタイプは同じ線種**（方向は線の傾きで分かる。§6.2.1）', () => {
    const dashes = assignPatternDashes([pattern('S1', 0, 'express'), pattern('T1', 1, 'express')]);

    expect(dashes.get('S1')).toEqual(dashes.get('T1'));
  });

  it('各駅は実線、通過は破線', () => {
    const dashes = assignPatternDashes([pattern('S3', 0), pattern('S1', 0, 'express')]);

    expect(dashes.get('S3')).toEqual([]);
    expect(dashes.get('S1')).not.toEqual([]);
    expect(dashes.get('S1')).toEqual(dashForServiceType('express'));
  });

  it('**定義の順に左右されない**（並べ替えても絵が変わらない）', () => {
    const patterns = [pattern('S1', 0, 'express'), pattern('S3', 0)];
    const reversed = [...patterns].reverse();

    expect(assignPatternDashes(reversed).get('S1')).toEqual(
      assignPatternDashes(patterns).get('S1'),
    );
  });

  it('種別が無ければ各駅として描く（R-12 が別に報告する）', () => {
    const missing: StopPattern = { ...pattern('S9', 0), serviceType: undefined };

    expect(assignPatternDashes([missing]).get('S9')).toEqual(dashForServiceType('local'));
  });
});

describe('回送パターン', () => {
  it('**すべて同じ破線**（回送どうしを見分ける必要はない）', () => {
    const dashes = assignPatternDashes([
      pattern('DS-out', 0, null),
      pattern('DS-in', 1, null),
      pattern('DT-out', 1, null),
    ]);

    for (const dash of dashes.values()) expect(dash).toEqual(DEADHEAD_DASH);
  });

  it('回送は営業パターンと違う線種を使う', () => {
    expect(DEADHEAD_DASH).not.toEqual(dashForServiceType('local'));
    expect(DEADHEAD_DASH).not.toEqual(dashForServiceType('express'));
  });
});
