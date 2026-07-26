import { describe, expect, it } from 'vitest';
import {
  projectSchema,
  serviceSchema,
  tripSchema,
  viewSettingsSchema,
  type ProjectInput,
  type Trip,
} from './project';
import { parseWithSchema } from './parse';
import { fromHM } from '@/domain/time';

function makeTrip(overrides: Partial<Trip> = {}): Trip {
  return {
    tripId: '550e8400-e29b-41d4-a716-446655440000',
    patternId: 'S1',
    anchor: { stopId: '1_0', time: fromHM(8, 0) },
    blockId: 'A',
    tripShortName: '1',
    ...overrides,
  };
}

/** 仕様書 §7.2 のファイル例に相当する最小のプロジェクト。 */
function makeProjectInput(): ProjectInput {
  return {
    meta: {
      format: 'uodia',
      formatVersion: 1,
      appVersion: '1.0.0',
      routeVersion: 1,
      createdAt: '2026-07-25T10:00:00+09:00',
      updatedAt: '2026-07-25T12:34:56+09:00',
    },
    document: { name: '2026年度 授業期間ダイヤ', author: '', comment: '' },
    services: [{ serviceId: 'weekday', serviceName: '授業期間平日ダイヤ', trips: [makeTrip()] }],
  };
}

describe('tripSchema', () => {
  it('仕様書 §5.6 の便を受け入れる', () => {
    expect(tripSchema.safeParse(makeTrip()).success).toBe(true);
  });

  it('永続化されるのは 5 フィールドのみ（note は任意）', () => {
    const parsed = tripSchema.parse(makeTrip());
    expect(Object.keys(parsed).sort()).toEqual([
      'anchor',
      'blockId',
      'patternId',
      'tripId',
      'tripShortName',
    ]);
  });

  it('停留所時刻を保持しない（アンカーから導出するため。仕様書 §5.6）', () => {
    const parsed = tripSchema.parse(makeTrip());
    expect(parsed).not.toHaveProperty('stopTimes');
    expect(parsed).not.toHaveProperty('times');
  });

  it('運用番号の空文字を受け入れる（未割当を意味する）', () => {
    expect(tripSchema.safeParse(makeTrip({ blockId: '' })).success).toBe(true);
  });

  it('note を任意で持てる', () => {
    expect(tripSchema.safeParse(makeTrip({ note: '臨時' })).success).toBe(true);
  });

  it('5 分刻みでないアンカー時刻を拒否する', () => {
    const broken = { ...makeTrip(), anchor: { stopId: '1_0', time: 28802 } };
    const result = parseWithSchema(tripSchema, broken);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.issues[0]?.path).toBe('anchor.time');
  });

  it('24 時超えのアンカー時刻を受け入れる', () => {
    expect(
      tripSchema.safeParse(makeTrip({ anchor: { stopId: '1_0', time: fromHM(25, 30) } })).success,
    ).toBe(true);
  });

  it('アンカーの null を受け入れる（時刻が未入力の便。仕様書 §6.1.4）', () => {
    expect(tripSchema.safeParse(makeTrip({ anchor: null })).success).toBe(true);
  });

  it('アンカーの省略は受け入れない（未入力は null で明示する）', () => {
    const { anchor: _anchor, ...withoutAnchor } = makeTrip();
    expect(tripSchema.safeParse(withoutAnchor).success).toBe(false);
  });
});

describe('serviceSchema', () => {
  it('便を持たないダイヤを受け入れる', () => {
    expect(
      serviceSchema.safeParse({ serviceId: 'weekday', serviceName: '平日', trips: [] }).success,
    ).toBe(true);
  });

  it('空のダイヤ名を拒否する', () => {
    expect(
      serviceSchema.safeParse({ serviceId: 'weekday', serviceName: '', trips: [] }).success,
    ).toBe(false);
  });
});

describe('viewSettingsSchema — 既定値', () => {
  it('空オブジェクトからすべての既定値を埋める', () => {
    const parsed = viewSettingsSchema.parse({});
    expect(parsed.splitRatio).toBe(0.6);
    expect(parsed.activeServiceId).toBeNull();
    expect(parsed.activeDirection).toBe(0);
    expect(parsed.colorMode).toBe('pattern');
    expect(parsed.hiddenPatternIds).toEqual([]);
    expect(parsed.showDeadhead).toBe(true);
  });

  it('ダイヤグラムのビューポートにも既定値が入る（既定の左端は 7:00）', () => {
    const parsed = viewSettingsSchema.parse({});
    expect(parsed.diagram.scrollTime).toBe(fromHM(7, 0));
    expect(parsed.diagram.pxPerMinute).toBeGreaterThan(0);
  });

  it('一部だけ指定しても残りは既定値で埋まる', () => {
    const parsed = viewSettingsSchema.parse({ colorMode: 'block' });
    expect(parsed.colorMode).toBe('block');
    expect(parsed.splitRatio).toBe(0.6);
  });

  it('範囲外の splitRatio を拒否する', () => {
    expect(viewSettingsSchema.safeParse({ splitRatio: 0 }).success).toBe(false);
    expect(viewSettingsSchema.safeParse({ splitRatio: 1 }).success).toBe(false);
  });
});

describe('projectSchema', () => {
  it('仕様書 §7.2 のファイル例を受け入れる', () => {
    const result = parseWithSchema(projectSchema, makeProjectInput());
    expect(result.ok).toBe(true);
  });

  it('view を省略しても既定値で埋まる', () => {
    const result = parseWithSchema(projectSchema, makeProjectInput());
    expect(result.ok && result.value.view.splitRatio).toBe(0.6);
  });

  it('停留所・区間・パターンの定義を含まない（route.json から読むため）', () => {
    const parsed = projectSchema.parse(makeProjectInput());
    expect(parsed).not.toHaveProperty('stops');
    expect(parsed).not.toHaveProperty('segments');
    expect(parsed).not.toHaveProperty('patterns');
  });

  it('format が uodia でないファイルを拒否する', () => {
    const input = makeProjectInput();
    const broken = { ...input, meta: { ...input.meta, format: 'oudia' } };
    const result = parseWithSchema(projectSchema, broken);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.issues[0]?.path).toBe('meta.format');
  });

  it('深く入れ子になった不正箇所をパスで示す（仕様書 §7.4）', () => {
    const input = makeProjectInput();
    const broken = {
      ...input,
      services: [
        {
          serviceId: 'weekday',
          serviceName: '平日',
          trips: [makeTrip(), makeTrip(), { ...makeTrip(), anchor: { stopId: '', time: 28800 } }],
        },
      ],
    };
    const result = parseWithSchema(projectSchema, broken);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.issues[0]?.path).toBe('services[0].trips[2].anchor.stopId');
  });

  it('null や配列など全く違う値を拒否する', () => {
    expect(parseWithSchema(projectSchema, null).ok).toBe(false);
    expect(parseWithSchema(projectSchema, []).ok).toBe(false);
    expect(parseWithSchema(projectSchema, 'uodia').ok).toBe(false);
  });

  it('未知のキーは無視して読み込む（仕様書 §7.3 の前方互換性）', () => {
    const withUnknown = { ...makeProjectInput(), futureFeature: { enabled: true } };
    const result = parseWithSchema(projectSchema, withUnknown);
    expect(result.ok).toBe(true);
    expect(result.ok && result.value).not.toHaveProperty('futureFeature');
  });
});
