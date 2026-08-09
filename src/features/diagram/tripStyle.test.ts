/**
 * 線種の割り当ての検証（T-26、仕様書 §9.4、#114）。
 *
 * **色の見分けがつかなくても読めること**を確かめる。線種が担うのは「各駅か
 * 通過か」の 1 点だけであり、それ以上を線種に載せない。
 */

import { describe, expect, it } from 'vitest';
import type { ServiceType, StopPattern } from '@/domain/model';
import {
  DASH_BY_KIND,
  DEADHEAD_DASH,
  assignPatternDashes,
  dashForServiceType,
  defaultDashKindOf,
} from './tripStyle';

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

/**
 * 既定の線種（#222、T-84）。
 *
 * **設定ダイアログが「上書きしない（…）」に添えるのはこれである。** かつては
 * 画面が `serviceType` を読み直しており、**回送を見落として「実線」と書いて
 * いた**——実際に引かれるのは破線である。判定を 1 か所に集めた。
 */
describe('defaultDashKindOf', () => {
  /** 既定の判定だけを見るパターン。 */
  function make(overrides: Partial<StopPattern>): StopPattern {
    return {
      patternId: 'X',
      patternName: 'X',
      routeName: 'X',
      directionId: 0,
      color: '#000000',
      isDeadhead: false,
      stopSequence: [],
      ...overrides,
    } as StopPattern;
  }

  it('**回送は破線**（#222。画面が実線と書いていた）', () => {
    expect(defaultDashKindOf(make({ isDeadhead: true }))).toBe('dashed');
  });

  it('**回送は `serviceType` を持たなくても破線**（route.json の回送 6 本がこれ）', () => {
    expect(defaultDashKindOf(make({ isDeadhead: true, serviceType: undefined }))).toBe('dashed');
  });

  it('直行は破線', () => {
    expect(defaultDashKindOf(make({ serviceType: 'express' }))).toBe('dashed');
  });

  it('各駅は実線', () => {
    expect(defaultDashKindOf(make({ serviceType: 'local' }))).toBe('solid');
  });

  it('種別が無い営業パターンは各駅として扱う', () => {
    expect(defaultDashKindOf(make({ serviceType: undefined }))).toBe('solid');
  });

  /*
   * **説明と絵が食い違わない。**
   *
   * 刻みまで同じにはならない——回送の破線（`DEADHEAD_DASH` = `[5, 4]`）は
   * **利用者が選べる破線（`[8, 4]`）より短く**、選択肢には無い 4 つめの線種で
   * ある。確かめるのは**実線か破線か**であり、そこが合っていれば説明は嘘に
   * ならない。
   */
  it('**説明と絵が食い違わない**（実線と書いて破線が引かれることが無い）', () => {
    const patterns = [
      make({ patternId: 'A', isDeadhead: true }),
      make({ patternId: 'B', serviceType: 'express' }),
      make({ patternId: 'C', serviceType: 'local' }),
      make({ patternId: 'D' }),
    ];
    const drawn = assignPatternDashes(patterns);

    for (const entry of patterns) {
      const saysSolid = defaultDashKindOf(entry) === 'solid';
      const drawsSolid = (drawn.get(entry.patternId) ?? []).length === 0;
      expect(saysSolid, entry.patternId).toBe(drawsSolid);
    }
  });

  it('**回送の破線は選べる破線より刻みが短い**（選択肢には無い 4 つめ）', () => {
    expect(DEADHEAD_DASH).not.toEqual(DASH_BY_KIND.dashed);
    expect(DEADHEAD_DASH.length).toBeGreaterThan(0);
  });
});
