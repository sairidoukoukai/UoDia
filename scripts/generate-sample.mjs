/**
 * 性能検証用のプロジェクトを作る（T-40、仕様書 §9.1）。
 *
 * **150 便**は仕様書の目標値が置かれている規模である（1 日 100 便程度を前提に
 * 余裕を見た数）。実際のダイヤに近い形——朝夕に寄せた 3 方向の便と、運用ごとの
 * 出入庫——にしないと、測っても現実の重さが出ない。
 *
 * 使い方: node scripts/generate-sample.mjs [便数] > sample.uodia
 */

const count = Number(process.argv[2] ?? 150);

/** 便を作る順に使うパターン。実データの比率に寄せる（三点間が多い）。 */
const PATTERNS = ['S3', 'T3', 'S1', 'T1', 'S2', 'T2', 'M2', 'M4'];
/** パターンごとの始発停留所（route.json より）。 */
const ORIGIN = {
  S1: '1_0',
  S3: '1_0',
  S2: '2_0',
  M2: '1_0',
  T1: '4_0',
  T3: '4_0',
  T2: '2_0',
  M4: '4_0',
};

const FIRST = 7 * 3600;
const LAST = 21 * 3600;
const GRAIN = 300;

const trips = [];
for (let index = 0; index < count; index += 1) {
  const patternId = PATTERNS[index % PATTERNS.length];
  // 7:00〜21:00 に散らす。5 分の倍数に丸める（§2.1）。
  const raw = FIRST + Math.round(((LAST - FIRST) * index) / count);
  const time = Math.round(raw / GRAIN) * GRAIN;
  // 運用は 10 台で回す。先頭と末尾に出入庫を付ける。
  const block = String.fromCharCode(65 + (index % 10));

  trips.push({
    tripId: `t${String(index + 1).padStart(3, '0')}`,
    patternId,
    anchor: { stopId: ORIGIN[patternId], time },
    blockId: block,
    pullOut: index < 10,
    pullIn: index >= count - 10,
  });
}

const now = new Date('2026-08-02T09:00:00+09:00').toISOString();

process.stdout.write(
  `${JSON.stringify(
    {
      meta: {
        format: 'uodia',
        formatVersion: 3,
        appVersion: '0.1.0',
        routeVersion: 1,
        createdAt: now,
        updatedAt: now,
      },
      document: { name: `性能検証（${String(count)} 便）`, author: '', comment: '' },
      services: [{ serviceId: 'weekday', serviceName: '授業期間平日ダイヤ', trips }],
      view: {},
    },
    null,
    2,
  )}\n`,
);
