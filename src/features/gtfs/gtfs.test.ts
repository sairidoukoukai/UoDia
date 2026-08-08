import { describe, expect, it } from 'vitest';
import type { Agency, NetworkDef } from '@/domain/model';
import {
  AGENCY_DEFAULTS,
  agencyChanged,
  agencyEditsOf,
  missingRequired,
  toAgency,
  type AgencyEdits,
} from './agency';
import {
  changedCoordinates,
  invalidRows,
  parseLat,
  parseLon,
  stopCoordinateRows,
  stopsWithoutCoordinates,
  type CoordinateEdits,
} from './coordinates';

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

describe('agencyChanged', () => {
  it('打ち直していなければ変更としない', () => {
    expect(agencyChanged(agency, agencyEditsOf(agency))).toBe(false);
  });

  it('1 項目でも違えば変更とする', () => {
    const edits = { ...agencyEditsOf(agency), agencyLang: 'en' };
    expect(agencyChanged(agency, edits)).toBe(true);
  });

  it('**まだ事業者が無いとき、既定のままなら変更としない**', () => {
    // 開いて閉じただけで route.json が書き換わってはならない。
    expect(agencyChanged(undefined, AGENCY_DEFAULTS)).toBe(false);
  });
});

describe('toAgency', () => {
  it('必須が空なら null', () => {
    expect(toAgency(AGENCY_DEFAULTS, '123')).toBeNull();
  });

  it('前後の空白を落とす', () => {
    const edits = { ...agencyEditsOf(agency), agencyName: '  大阪大学  ' };
    expect(toAgency(edits, '123')?.agencyName).toBe('大阪大学');
  });

  it('**電話番号が空なら項目ごと落とす**（空の欄と値が無いことは同じ）', () => {
    expect(toAgency(agencyEditsOf(agency), '123')?.agencyPhone).toBeUndefined();
  });

  it('**agencyId は渡されたものを使う**（こちらで採番し直さない）', () => {
    expect(toAgency(agencyEditsOf(agency), '4120905002554')?.agencyId).toBe('4120905002554');
  });

  it('よみがな・英語名を引き継ぐ（画面から打てない項目を消さない）', () => {
    const existing: Agency = { ...agency, nameKana: 'おおさかだいがく', nameEn: 'Osaka Univ' };
    const result = toAgency(agencyEditsOf(existing), existing.agencyId, existing);

    expect(result?.nameKana).toBe('おおさかだいがく');
    expect(result?.nameEn).toBe('Osaka Univ');
  });
});

describe('parseLat / parseLon', () => {
  it('数を読む', () => {
    expect(parseLat('34.80542')).toBe(34.80542);
    expect(parseLon('135.45537')).toBe(135.45537);
  });

  it('**空文字は「消した」として undefined を返す**（一度入れた値を取り消せる）', () => {
    expect(parseLat('')).toBeUndefined();
    expect(parseLat('   ')).toBeUndefined();
  });

  it('読めない文字は null', () => {
    expect(parseLat('北緯 34 度')).toBeNull();
  });

  it('範囲の外は null', () => {
    expect(parseLat('91')).toBeNull();
    expect(parseLat('-91')).toBeNull();
    expect(parseLon('181')).toBeNull();
    expect(parseLon('-181')).toBeNull();
  });

  it('**経度は 180 まで通す**（緯度の上限と取り違えない）', () => {
    expect(parseLon('135.5')).toBe(135.5);
    expect(parseLat('135.5')).toBeNull();
  });
});

describe('stopCoordinateRows', () => {
  it('定義の並びをそのまま使う', () => {
    expect(stopCoordinateRows(makeNetwork()).map((r) => r.stopId)).toEqual(['1_0', '9_0']);
  });

  it('**車庫も出す**（stops.txt に出す以上、座標が要る）', () => {
    const depot = stopCoordinateRows(makeNetwork()).find((r) => r.stopId === '9_0');
    expect(depot?.isDepot).toBe(true);
  });

  it('まだ無い値は空文字にする（0 と見分ける）', () => {
    const depot = stopCoordinateRows(makeNetwork()).find((r) => r.stopId === '9_0');
    expect(depot?.lat).toBe('');
  });
});

describe('invalidRows', () => {
  it('読めない値の行を返す', () => {
    const edits: CoordinateEdits = new Map([['1_0', { lat: 'あ', lon: '135.5' }]]);
    expect(invalidRows(edits)).toEqual(['1_0']);
  });

  it('空文字は読めない値としない', () => {
    const edits: CoordinateEdits = new Map([['1_0', { lat: '', lon: '' }]]);
    expect(invalidRows(edits)).toEqual([]);
  });
});

describe('changedCoordinates', () => {
  it('違う値だけを残す', () => {
    const edits: CoordinateEdits = new Map([['9_0', { lat: '34.80548', lon: '135.5061' }]]);
    expect(changedCoordinates(makeNetwork(), edits).get('9_0')).toEqual({
      lat: 34.80548,
      lon: 135.5061,
    });
  });

  it('**同じ値を打ち直しても変更にしない**', () => {
    const edits: CoordinateEdits = new Map([['1_0', { lat: '34.80542', lon: '135.45537' }]]);
    expect(changedCoordinates(makeNetwork(), edits).size).toBe(0);
  });

  it('読めない値は当てない（状態を壊さない）', () => {
    const edits: CoordinateEdits = new Map([['1_0', { lat: 'あ', lon: '135.5' }]]);
    expect(changedCoordinates(makeNetwork(), edits).size).toBe(0);
  });

  it('**空にすると消す**（undefined を当てる）', () => {
    const edits: CoordinateEdits = new Map([['1_0', { lat: '', lon: '' }]]);
    expect(changedCoordinates(makeNetwork(), edits).get('1_0')).toEqual({
      lat: undefined,
      lon: undefined,
    });
  });
});

describe('stopsWithoutCoordinates', () => {
  it('緯度経度が欠けている停留所を返す（R-15 が弾く先）', () => {
    expect(stopsWithoutCoordinates(makeNetwork().stops).map((s) => s.stopId)).toEqual(['9_0']);
  });
});
