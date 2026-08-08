/**
 * ダイヤ検証の検証（T-10、仕様書 §6.6）。
 *
 * V-01〜V-09 のそれぞれに、検出されるケースと検出されないケースの両方を置く。
 * 「検出される」だけを確かめると、常に発火する実装でもテストが通ってしまう。
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Trip } from '@/domain/model';
import { loadNetworkDef, type NetworkIndex } from '@/domain/network';
import { fromHM, seconds } from '@/domain/time';
import { validateService } from './validate';
import { DEFAULT_THRESHOLDS, SEVERITY_OF, type ValidationId } from './types';

const routeJsonPath = fileURLToPath(new URL('../../../data/route.json', import.meta.url));
const loaded = loadNetworkDef(readFileSync(routeJsonPath, 'utf8'));
if (!loaded.ok) throw new Error('route.json を読み込めません');
const network: NetworkIndex = loaded.network;

const TOYONAKA = '1_0';

let counter = 0;

function trip(patternId: string, hours: number, minutes: number, blockId = ''): Trip {
  const pattern = network.patternIndex(patternId);
  if (pattern === undefined) throw new Error(`パターン ${patternId} がありません`);
  counter += 1;
  return {
    tripId: `t${String(counter)}`,
    patternId,
    anchor: { stopId: pattern.originStopId, time: fromHM(hours, minutes) },
    blockId,
    pullOut: false,
    pullIn: false,
  };
}

/** 検出された検証項目の一覧。 */
function idsOf(trips: readonly Trip[]): ValidationId[] {
  return validateService(trips, network).map((i) => i.id);
}

/**
 * 何も指摘されない運用。
 *
 * 7:00 出庫 → 豊中 7:20 → 直行吹田 7:50 → 豊中 8:30 → 8:50 入庫。
 * 便が 1 本ずつなので便間隔（V-06）の指摘も生じない。
 */
function makeCleanBlock(): Trip[] {
  return [
    trip('DT-out', 7, 0, '1'),
    trip('S1', 7, 20, '1'),
    trip('T1', 8, 0, '1'),
    trip('DT-in', 8, 30, '1'),
  ];
}

describe('validateService — 正常系', () => {
  it('整合したダイヤでは何も指摘しない', () => {
    expect(validateService(makeCleanBlock(), network)).toEqual([]);
  });

  it('便が無ければ何も指摘しない', () => {
    expect(validateService([], network)).toEqual([]);
  });
});

describe('V-01: 同一運用内の停留所不一致', () => {
  it('前便の終着と次便の始発が違うと検出する', () => {
    // 吹田着の次に豊中発が来る
    expect(idsOf([trip('S1', 8, 0, '1'), trip('S1', 9, 0, '1')])).toContain('V-01');
  });

  it('繋がっていれば検出しない', () => {
    expect(idsOf([trip('S1', 8, 0, '1'), trip('T1', 8, 30, '1')])).not.toContain('V-01');
  });

  it('運用が違えば繋がっていなくても検出しない', () => {
    expect(idsOf([trip('S1', 8, 0, '1'), trip('S1', 9, 0, '2')])).not.toContain('V-01');
  });

  it('エラーとして報告し、該当の便と運用を指す', () => {
    const trips = [trip('S1', 8, 0, '1'), trip('S1', 9, 0, '1')];
    const found = validateService(trips, network).filter((i) => i.id === 'V-01');

    expect(found.every((i) => i.severity === 'error')).toBe(true);
    // **両側から 1 件ずつ出す**（T-61、#165）。時刻表では指摘のある便の列に印を
    // 付けるため、片方だけを指すとどちらが悪いのかを探すことになる。
    expect(found.map((i) => i.target)).toEqual([
      { blockId: '1', tripId: trips[0]?.tripId },
      { blockId: '1', tripId: trips[1]?.tripId },
    ]);
  });

  it('**文面はその便の視点で書く**（前の便に「前の便は」と出さない）', () => {
    const trips = [trip('S1', 8, 0, '1'), trip('S1', 9, 0, '1')];
    const [onEarlier, onLater] = validateService(trips, network).filter((i) => i.id === 'V-01');

    expect(onEarlier?.message).toContain('次の便は');
    expect(onEarlier?.message).not.toContain('前の便は');
    expect(onLater?.message).toContain('前の便は');
  });

  it('名前を引けない停留所は ID のまま出す（伏せると何が壊れたか分からない）', () => {
    // 路線図と便が食い違っている状態を作る。名前が無いからといって黙ると、
    // 「前の便は  着です」という読めない指摘になる。
    const broken: NetworkIndex = { ...network, findStop: () => undefined };
    const found = validateService([trip('S1', 8, 0, '1'), trip('S1', 9, 0, '1')], broken).find(
      (i) => i.id === 'V-01',
    );

    expect(found?.message).toMatch(/\d+_\d+/);
  });

  it('**停留所は名前で言う**（`4_0` と書かれても直せない。T-34）', () => {
    const trips = [trip('S1', 8, 0, '1'), trip('S1', 9, 0, '1')];
    const found = validateService(trips, network).find((i) => i.id === 'V-01');

    // **画面に出ているのと同じ略称で言う**（#116）。指摘を読んだ人が探すのは
    // 縦軸と行見出しであり、そこには略称が並んでいる。
    expect(found?.message).toContain('工学部');
    expect(found?.message).toContain('豊中');
    expect(found?.message).not.toMatch(/\d+_\d+/);
  });
});

describe('V-02: 折返し時分が負', () => {
  it('前便の終着より前に発車すると検出する', () => {
    // S1 は 8:00 → 8:30 吹田着。T1 が 8:20 吹田発では 10 分足りない。
    expect(idsOf([trip('S1', 8, 0, '1'), trip('T1', 8, 20, '1')])).toContain('V-02');
  });

  it('**折返し 0 分は検出しない**（下限は 0 分）', () => {
    expect(idsOf([trip('S1', 8, 0, '1'), trip('T1', 8, 30, '1')])).not.toContain('V-02');
  });

  it('余裕があれば検出しない', () => {
    expect(idsOf([trip('S1', 8, 0, '1'), trip('T1', 8, 45, '1')])).not.toContain('V-02');
  });
});

describe('V-03: 運行時間帯の重複', () => {
  it('離れた便との重複を検出する', () => {
    // T3（45 分）の中に短い便が 2 本収まっている
    expect(
      idsOf([trip('T3', 8, 0, '1'), trip('T2', 8, 10, '1'), trip('T2', 8, 20, '1')]),
    ).toContain('V-03');
  });

  it('**隣り合う便の重複は V-02 が報告するため V-03 では検出しない**', () => {
    const ids = idsOf([trip('S1', 8, 0, '1'), trip('T1', 8, 20, '1')]);
    expect(ids).toContain('V-02');
    expect(ids).not.toContain('V-03');
  });

  it('重複していなければ検出しない', () => {
    expect(
      idsOf([trip('S1', 8, 0, '1'), trip('T1', 8, 30, '1'), trip('S1', 9, 5, '1')]),
    ).not.toContain('V-03');
  });
});

describe('V-05: 運用の先頭・末尾', () => {
  it('先頭が出庫回送でないと検出する', () => {
    const found = validateService([trip('S1', 8, 0, '1'), trip('DS-in', 8, 30, '1')], network);
    expect(found.filter((i) => i.id === 'V-05').map((i) => i.message)).toEqual([
      '運用の先頭が出庫回送ではありません',
    ]);
  });

  it('末尾が入庫回送でないと検出する', () => {
    const found = validateService([trip('DT-out', 7, 0, '1'), trip('S1', 7, 20, '1')], network);
    expect(found.filter((i) => i.id === 'V-05').map((i) => i.message)).toEqual([
      '運用の末尾が入庫回送ではありません',
    ]);
  });

  it('両方欠けていれば 2 件検出する', () => {
    expect(idsOf([trip('S1', 8, 0, '1')]).filter((id) => id === 'V-05')).toHaveLength(2);
  });

  it('出入庫が揃っていれば検出しない', () => {
    expect(idsOf(makeCleanBlock())).not.toContain('V-05');
  });

  it('警告として報告し、運用を指す', () => {
    const found = validateService([trip('S1', 8, 0, '1')], network).find((i) => i.id === 'V-05');
    expect(found?.severity).toBe('warning');
    expect(found?.target).toEqual({ blockId: '1' });
  });
});

describe('V-06: 便間隔が極端', () => {
  it('間隔が短すぎると検出する', () => {
    expect(idsOf([trip('S1', 8, 0), trip('S1', 8, 0)])).toContain('V-06');
  });

  it('間隔が空きすぎると検出する', () => {
    expect(idsOf([trip('S1', 8, 0), trip('S1', 11, 0)])).toContain('V-06');
  });

  it('適度な間隔なら検出しない', () => {
    expect(idsOf([trip('S1', 8, 0), trip('S1', 8, 30)])).not.toContain('V-06');
  });

  it('境界（5 分・120 分ちょうど）は検出しない', () => {
    expect(idsOf([trip('S1', 8, 0), trip('S1', 8, 5)])).not.toContain('V-06');
    expect(idsOf([trip('S1', 8, 0), trip('S1', 10, 0)])).not.toContain('V-06');
  });

  it('方向が違う便どうしは間隔を測らない', () => {
    expect(idsOf([trip('S1', 8, 0), trip('T1', 8, 0)])).not.toContain('V-06');
  });

  it('始発が違う便でも共通の停留所で間隔を測る', () => {
    // S3（豊中 8:00 発）は箕面学舎を 8:20 に通る。S2（箕面 8:20 発）と同時刻。
    expect(idsOf([trip('S3', 8, 0), trip('S2', 8, 20)])).toContain('V-06');
  });

  it('閾値を設定から差し替えられる', () => {
    const trips = [trip('S1', 8, 0), trip('S1', 8, 30)];
    const strict = validateService(trips, network, {
      ...DEFAULT_THRESHOLDS,
      minHeadwayMinutes: 45,
    });
    expect(strict.map((i) => i.id)).toContain('V-06');
  });

  it('**どこの間隔かを停留所名で言う**（`1_0 で` では直せない。T-38）', () => {
    // 5 分未満の間隔（0 分）。時刻は 5 分刻みでしか作れない。
    const found = validateService([trip('S1', 8, 0), trip('S1', 8, 0)], network).find(
      (i) => i.id === 'V-06',
    );

    expect(found?.message).toContain('豊中');
    expect(found?.message).not.toMatch(/\d+_\d+/);
  });
});

describe('V-07: 運用番号が空欄', () => {
  it('空欄の便を検出する', () => {
    expect(idsOf([trip('S1', 8, 0, '')])).toContain('V-07');
  });

  it('運用番号があれば検出しない', () => {
    expect(idsOf(makeCleanBlock())).not.toContain('V-07');
  });

  it('情報として報告し、該当の便を指す', () => {
    const trips = [trip('S1', 8, 0, '')];
    const found = validateService(trips, network).find((i) => i.id === 'V-07');
    expect(found?.severity).toBe('info');
    expect(found?.target).toEqual({ tripId: trips[0]?.tripId });
  });
});

describe('V-04: 参照が壊れていて時刻を導出できない', () => {
  it('パターンが解決できない便を検出する', () => {
    const broken = { ...trip('S1', 8, 0, '1'), patternId: 'なにこれ' };
    expect(idsOf([broken])).toContain('V-04');
  });

  it('時刻が範囲を外れる便を検出する', () => {
    const broken: Trip = {
      ...trip('T3', 8, 0, '1'),
      anchor: { stopId: TOYONAKA, time: seconds(0) },
    };
    expect(idsOf([broken])).toContain('V-04');
  });

  it('アンカー停留所が経路に無い便を検出する', () => {
    // S1（直行）は箕面学舎を通らない。時刻が 1 つも導出できない。
    const broken: Trip = {
      ...trip('S1', 8, 0, '1'),
      anchor: { stopId: '2_0', time: fromHM(8, 0) },
    };
    const ids = idsOf([broken]);
    expect(ids).toContain('V-04');
    // 時刻が無い便は便間隔（V-06）の対象にならない
    expect(ids).not.toContain('V-06');
  });

  it('**車庫発が範囲を外れる出区を検出する**（T-51、仕様書 §6.1.7）', () => {
    // 0:10 発の便の出区は前日 23:50 となり、表せない。
    const early: Trip = { ...trip('S1', 0, 10, '1'), pullOut: true };
    const found = validateService([early], network).find((i) => i.id === 'V-04');

    expect(found?.message).toContain('出区');
    expect(found?.target.tripId).toBe(early.tripId);
  });

  it('**車庫着が範囲を外れる入区を検出する**', () => {
    const late: Trip = { ...trip('S1', 47, 20, '1'), pullIn: true };
    expect(validateService([late], network).find((i) => i.id === 'V-04')?.message).toContain(
      '入区',
    );
  });

  it('作れる出区・入区は報告しない', () => {
    const trips: Trip[] = [{ ...trip('S1', 8, 0, '1'), pullOut: true, pullIn: true }];
    expect(idsOf(trips)).not.toContain('V-04');
  });

  it('時刻が未入力の便の出区は報告しない（回送の時刻も決まらないのは当然）', () => {
    const empty: Trip = { ...trip('S1', 8, 0, '1'), anchor: null, pullOut: true, pullIn: true };
    expect(idsOf([empty])).not.toContain('V-04');
  });

  it('エラーとして報告する（データが壊れている）', () => {
    const broken = { ...trip('S1', 8, 0, '1'), patternId: 'なにこれ' };
    expect(validateService([broken], network).find((i) => i.id === 'V-04')?.severity).toBe('error');
  });

  it('導出できれば検出しない', () => {
    expect(idsOf(makeCleanBlock())).not.toContain('V-04');
  });

  it('**時刻が未入力なだけの便は検出しない**（壊れているのではない）', () => {
    const empty: Trip = { ...trip('S1', 8, 0, '1'), anchor: null };
    expect(idsOf([empty])).not.toContain('V-04');
  });
});

describe('V-08: 時刻が未入力', () => {
  it('アンカー未設定の便を検出する', () => {
    const empty: Trip = { ...trip('S1', 8, 0, '1'), anchor: null };
    expect(idsOf([empty])).toContain('V-08');
  });

  it('情報として報告し、該当の便を指す', () => {
    const empty: Trip = { ...trip('S1', 8, 0, '1'), anchor: null };
    const found = validateService([empty], network).find((i) => i.id === 'V-08');
    expect(found?.severity).toBe('info');
    expect(found?.target).toEqual({ tripId: empty.tripId });
  });

  it('時刻が入っていれば検出しない', () => {
    expect(idsOf(makeCleanBlock())).not.toContain('V-08');
  });

  it('参照が壊れているだけの便は検出しない', () => {
    const broken = { ...trip('S1', 8, 0, '1'), patternId: 'なにこれ' };
    expect(idsOf([broken])).not.toContain('V-08');
  });

  it('運用番号も空欄なら V-07 と両方が出る', () => {
    const empty: Trip = { ...trip('S1', 8, 0, ''), anchor: null };
    const ids = idsOf([empty]);
    expect(ids).toContain('V-07');
    expect(ids).toContain('V-08');
  });
});

describe('V-09: 営業所待機が短い', () => {
  it('待機が短いと検出する', () => {
    // 8:20 入庫 → 8:40 出庫で 20 分
    expect(idsOf([trip('DT-in', 8, 0, '1'), trip('DT-out', 8, 40, '1')])).toContain('V-09');
  });

  it('十分に長ければ検出しない', () => {
    // 8:20 入庫 → 9:20 出庫で 60 分
    expect(idsOf([trip('DT-in', 8, 0, '1'), trip('DT-out', 9, 20, '1')])).not.toContain('V-09');
  });

  it('境界（30 分ちょうど）は検出しない', () => {
    expect(idsOf([trip('DT-in', 8, 0, '1'), trip('DT-out', 8, 50, '1')])).not.toContain('V-09');
  });

  it('閾値を設定から差し替えられる', () => {
    const trips = [trip('DT-in', 8, 0, '1'), trip('DT-out', 9, 20, '1')];
    const strict = validateService(trips, network, {
      ...DEFAULT_THRESHOLDS,
      minStandbyMinutes: 90,
    });
    expect(strict.map((i) => i.id)).toContain('V-09');
  });
});

describe('検証項目の全体', () => {
  it('**便内の時刻矛盾を検査する項目が存在しない**', () => {
    // 便はアンカー 1 点から全時刻が決まるため、便内の矛盾は表現できない。
    // 便を見る項目は V-01〜V-09 のみであり、後から足していない。V-10・V-11 は
    // 運行日カレンダーを見るものであり、便を見ない（T-71、仕様書 v2 §8.2）。
    expect(Object.keys(SEVERITY_OF)).toEqual([
      'V-01',
      'V-02',
      'V-03',
      'V-04',
      'V-05',
      'V-06',
      'V-07',
      'V-08',
      'V-09',
      'V-10',
      'V-11',
    ]);
  });

  it('重大度が仕様書 §6.6 の表と一致する', () => {
    expect(Object.values(SEVERITY_OF)).toEqual([
      'error',
      'error',
      'error',
      'error',
      'warning',
      'warning',
      'info',
      'info',
      'info',
      'warning',
      'warning',
    ]);
  });

  it('検証項目 ID の昇順に並ぶ（重大度の順でもある）', () => {
    const ids = idsOf([
      trip('S1', 8, 0, ''), // 運用番号が空欄なので運用にならない → V-06
      trip('S1', 8, 0, '1'), // V-05 × 2、V-06（間隔 0 分）
      trip('S1', 9, 0, '1'), // V-01（吹田着の次に豊中発）
    ]);
    expect([...ids]).toEqual([...ids].sort((a, b) => a.localeCompare(b)));
  });
});

describe('性能（仕様書 §9.1）', () => {
  it('150 便の検証が 50ms 以内に終わる', () => {
    const trips: Trip[] = [];
    for (let i = 0; i < 150; i++) {
      const hours = 7 + Math.floor(i / 10);
      const minutes = (i % 10) * 5;
      const blockId = String(i % 8);
      trips.push(trip(i % 2 === 0 ? 'S1' : 'T1', hours, minutes, blockId));
    }

    const started = performance.now();
    validateService(trips, network);
    expect(performance.now() - started).toBeLessThan(50);
  });
});
