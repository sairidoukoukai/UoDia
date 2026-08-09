/**
 * 事業者と緯度経度の読み取り（T-72・T-85）。
 *
 * **打つ場所は無くなった**（#221）。残っているのは「`route.json` に何が入って
 * いるか」「何が欠けているか」を読むところだけであり、確かめるのもそこである。
 */

import { describe, expect, it } from 'vitest';
import type { Agency, NetworkDef } from '@/domain/model';
import { AGENCY_DEFAULTS, agencyEditsOf, missingRequired, type AgencyEdits } from './agency';
import { stopsWithoutCoordinates } from './coordinates';

const agency: Agency = {
  agencyId: '4120905002554',
  agencyName: '国立大学法人大阪大学',
  agencyUrl: 'https://example.invalid/',
  agencyTimezone: 'Asia/Tokyo',
  agencyLang: 'ja',
};

function makeNetwork(): NetworkDef {
  return {
    version: 3,
    name: 'テスト用',
    timeGrain: 300,
    agency,
    stops: [
      {
        stopId: '1_0',
        stopName: '豊中学舎',
        shortName: '豊中',
        area: '',
        axisPosition: 0,
        gridStyle: 'bold',
        hiddenInEditor: false,
        isDepot: false,
        lat: 34.80542,
        lon: 135.45537,
      },
      {
        stopId: '9_0',
        stopName: '千里営業所',
        shortName: '車庫',
        area: '',
        axisPosition: 50,
        gridStyle: 'normal',
        hiddenInEditor: false,
        isDepot: true,
      },
    ],
    segments: [],
    patterns: [],
  };
}

describe('agencyEditsOf', () => {
  it('**まだ無ければ既定値を出す**（タイムゾーンと言語は埋まっている）', () => {
    expect(agencyEditsOf(undefined)).toEqual(AGENCY_DEFAULTS);
    expect(agencyEditsOf(undefined).agencyTimezone).toBe('Asia/Tokyo');
    expect(agencyEditsOf(undefined).agencyLang).toBe('ja');
  });

  it('電話番号が無ければ空文字にする', () => {
    expect(agencyEditsOf(agency).agencyPhone).toBe('');
  });
});

describe('missingRequired', () => {
  it('空の必須項目を返す', () => {
    const edits: AgencyEdits = { ...AGENCY_DEFAULTS };
    expect(missingRequired(edits)).toEqual(['agencyName', 'agencyUrl']);
  });

  it('**空白だけの入力を空として扱う**', () => {
    const edits: AgencyEdits = { ...agencyEditsOf(agency), agencyName: '   ' };
    expect(missingRequired(edits)).toContain('agencyName');
  });

  it('任意項目（電話番号）は空でも報告しない', () => {
    expect(missingRequired(agencyEditsOf(agency))).toEqual([]);
  });
});

describe('stopsWithoutCoordinates', () => {
  it('緯度経度が欠けている停留所を返す（R-15 が弾く先）', () => {
    expect(stopsWithoutCoordinates(makeNetwork().stops).map((s) => s.stopId)).toEqual(['9_0']);
  });
});
