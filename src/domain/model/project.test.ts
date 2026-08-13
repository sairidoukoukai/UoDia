import { describe, expect, it } from 'vitest';
import {
  clampDiagramView,
  clampSplitRatio,
  DEFAULT_SPLIT_RATIO,
  diagramViewSchema,
  DIAGRAM_ZOOM_LIMITS,
  SPLIT_RATIO_LIMITS,
  projectSchema,
  serviceCalendarSchema,
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
    pullOut: false,
    pullIn: false,
    ...overrides,
  };
}

/**
 * 最小の路線（T-89）。**版数 5 でプロジェクトが持つようになった。**
 *
 * スキーマの検証であるため `route.json` は読まない。**必須の項目だけ**を置く
 * ——事業者と系統は版数 2 以前を表せるように省略できる。
 */
function makeNetwork(): ProjectInput['network'] {
  return {
    version: 1,
    name: 'テスト用',
    timeGrain: 300,
    stops: [],
    segments: [],
    patterns: [],
  };
}

/** 仕様書 §7.2 のファイル例に相当する最小のプロジェクト。 */
function makeProjectInput(): ProjectInput {
  return {
    network: makeNetwork(),
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

  it('永続化されるのは 6 フィールドのみ（note は任意）', () => {
    const parsed = tripSchema.parse(makeTrip());
    expect(Object.keys(parsed).sort()).toEqual([
      'anchor',
      'blockId',
      'patternId',
      'pullIn',
      'pullOut',
      'tripId',
    ]);
  });

  it('**出区・入区は既定で付かない**（版数 2 のファイルにも無い。T-51）', () => {
    const { pullOut: _out, pullIn: _in, ...withoutFlags } = makeTrip();
    const parsed = tripSchema.parse(withoutFlags);
    expect(parsed.pullOut).toBe(false);
    expect(parsed.pullIn).toBe(false);
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

describe('ダイヤグラムの視野（仕様書 §6.2.3、T-27）', () => {
  const defaults = diagramViewSchema.parse({});

  it('既定は 7:00 から、1 分 3px・軸 1 単位 8px', () => {
    expect(defaults).toEqual({
      pxPerMinute: 3,
      pxPerAxisUnit: 8,
      scrollTime: fromHM(7, 0),
      scrollAxis: 0,
    });
  });

  it('**スクロール位置は 5 分の倍数でなくてよい**（v4.17）', () => {
    const result = parseWithSchema(diagramViewSchema, { ...defaults, scrollTime: 25230 });
    expect(result.ok && result.value.scrollTime).toBe(25230);
  });

  it('拡大率を下限と上限に収める', () => {
    expect(clampDiagramView({ ...defaults, pxPerMinute: 0.01 }).pxPerMinute).toBe(
      DIAGRAM_ZOOM_LIMITS.minPxPerMinute,
    );
    expect(clampDiagramView({ ...defaults, pxPerMinute: 1000 }).pxPerMinute).toBe(
      DIAGRAM_ZOOM_LIMITS.maxPxPerMinute,
    );
    expect(clampDiagramView({ ...defaults, pxPerAxisUnit: 0 }).pxPerAxisUnit).toBe(
      DIAGRAM_ZOOM_LIMITS.minPxPerAxisUnit,
    );
    expect(clampDiagramView({ ...defaults, pxPerAxisUnit: 999 }).pxPerAxisUnit).toBe(
      DIAGRAM_ZOOM_LIMITS.maxPxPerAxisUnit,
    );
  });

  it('**収まっているならそのまま返す**（同じ参照のまま）', () => {
    expect(clampDiagramView(defaults)).toBe(defaults);
  });

  it('送りの位置は収めない（画面の大きさを知らないため）', () => {
    const scrolled = { ...defaults, scrollTime: 999_999, scrollAxis: -50 };
    expect(clampDiagramView(scrolled)).toBe(scrolled);
  });

  it('**範囲外の値を持つファイルも開ける**（拒まず収める）', () => {
    const result = parseWithSchema(viewSettingsSchema, { diagram: { pxPerMinute: 500 } });
    expect(result.ok).toBe(true);
    expect(result.ok && clampDiagramView(result.value.diagram).pxPerMinute).toBe(
      DIAGRAM_ZOOM_LIMITS.maxPxPerMinute,
    );
  });
});

describe('分割比率（仕様書 §6.4、T-32）', () => {
  it('既定はダイヤグラムをやや広く取る', () => {
    const result = parseWithSchema(viewSettingsSchema, {});
    expect(result.ok && result.value.splitRatio).toBe(DEFAULT_SPLIT_RATIO);
  });

  it('**どちらかを潰しきれない**（下限と上限に収める）', () => {
    expect(clampSplitRatio(0)).toBe(SPLIT_RATIO_LIMITS.min);
    expect(clampSplitRatio(1)).toBe(SPLIT_RATIO_LIMITS.max);
    expect(clampSplitRatio(-5)).toBe(SPLIT_RATIO_LIMITS.min);
  });

  it('収まっているならそのまま返す', () => {
    expect(clampSplitRatio(0.42)).toBe(0.42);
  });

  it('数でない値は既定に戻す（0 で割った結果などを書き込まない）', () => {
    expect(clampSplitRatio(Number.NaN)).toBe(DEFAULT_SPLIT_RATIO);
    expect(clampSplitRatio(Number.POSITIVE_INFINITY)).toBe(DEFAULT_SPLIT_RATIO);
  });

  it('**収めた値はスキーマを通る**（書けても開けないファイルを作らない）', () => {
    for (const ratio of [-1, 0, 0.5, 1, 42]) {
      const result = parseWithSchema(viewSettingsSchema, { splitRatio: clampSplitRatio(ratio) });
      expect(result.ok).toBe(true);
    }
  });

  it('範囲を外れた比率のファイルは受け付けない（収めるのは書く側の仕事）', () => {
    expect(parseWithSchema(viewSettingsSchema, { splitRatio: 0.95 }).ok).toBe(false);
  });
});

describe('serviceCalendarSchema（T-71、#197）', () => {
  const valid = {
    startDate: '2026-04-01',
    endDate: '2027-03-31',
    weekdays: ['mon', 'tue', 'wed', 'thu', 'fri'],
    closedRanges: [{ from: '2026-08-06', to: '2026-09-30', note: '夏季休業' }],
  };

  it('揃っていれば通る', () => {
    expect(serviceCalendarSchema.safeParse(valid).success).toBe(true);
  });

  it('**走る曜日が空なら弾く**（1 日も走らないダイヤは運行日を持つ意味が無い）', () => {
    expect(serviceCalendarSchema.safeParse({ ...valid, weekdays: [] }).success).toBe(false);
  });

  it('**有効期間が逆順なら弾く**', () => {
    const reversed = { ...valid, startDate: '2027-03-31', endDate: '2026-04-01' };
    expect(serviceCalendarSchema.safeParse(reversed).success).toBe(false);
  });

  it('**運行なしの範囲が逆順なら弾く**', () => {
    const reversed = { ...valid, closedRanges: [{ from: '2026-09-30', to: '2026-08-06' }] };
    expect(serviceCalendarSchema.safeParse(reversed).success).toBe(false);
  });

  it('日付の形が違えば弾く', () => {
    expect(serviceCalendarSchema.safeParse({ ...valid, startDate: '2026/04/01' }).success).toBe(
      false,
    );
  });

  it('**存在しない日付を弾く**（形だけでは 2026-02-30 が通る）', () => {
    expect(serviceCalendarSchema.safeParse({ ...valid, startDate: '2026-02-30' }).success).toBe(
      false,
    );
  });

  it('閏日は通す', () => {
    const leap = { ...valid, startDate: '2028-02-29', endDate: '2028-03-01' };
    expect(serviceCalendarSchema.safeParse(leap).success).toBe(true);
  });

  it('1 日だけの運行なしを作れる（from と to が同じ日）', () => {
    const single = { ...valid, closedRanges: [{ from: '2026-05-01', to: '2026-05-01' }] };
    expect(serviceCalendarSchema.safeParse(single).success).toBe(true);
  });

  it('**カレンダーを持たないダイヤが通る**（省略できる）', () => {
    const service = { serviceId: 's1', serviceName: '平日', trips: [] };
    expect(serviceSchema.safeParse(service).success).toBe(true);
  });
});
