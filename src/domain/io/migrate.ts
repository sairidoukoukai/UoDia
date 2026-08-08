/**
 * ファイル形式のマイグレーション（仕様書 §7.3）。
 *
 * マイグレーションは**スキーマ検証の前**に走る。古いファイルは現在のスキーマに
 * 適合しないのだから、検証を通してから変換することはできない。したがって変換関数が
 * 受け取るのは `unknown` であり、自分が扱う版の形を自分で確かめる責任を持つ。
 */

import { CURRENT_FORMAT_VERSION } from '@/domain/model';

/** 1 つ前の版から次の版への変換。 */
export interface Migration {
  /** この変換が受け取る版。 */
  readonly from: number;
  /** この変換が出力する版。 */
  readonly to: number;
  readonly migrate: (data: unknown) => unknown;
}

/**
 * オブジェクトとして読める値だけを返す。配列と `null` は除く。
 *
 * 変換関数が受け取るのは検証前の `unknown` であり、形が違えば**何もせずに
 * そのまま返す**。壊れたファイルをここで直そうとしても、直したつもりの形が
 * スキーマ検証で弾かれるだけである。
 */
function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/**
 * 配列として読める値だけを返す。
 *
 * `Array.isArray` は `unknown` を `any[]` に絞る。そのまま扱うと、要素に触れた
 * 先の戻り値まで `any` に染まる。ここで `unknown[]` に受け直す。
 */
function asArray(value: unknown): unknown[] | null {
  return Array.isArray(value) ? (value as unknown[]) : null;
}

/**
 * 版数 1 → 2: 便番号（`tripShortName`）を捨てる。
 *
 * 便番号は始発時刻から導出される値になった（仕様書 §6.1.6）。保存されていた値を
 * 復元する必要はなく、むしろ古い番号が残っていると、導出結果と食い違ったまま
 * ファイルに居座る。
 *
 * スキーマは未知のキーを黙って落とすため、値を消すだけなら関数が無くても読み込みは
 * 通る。それでも書くのは、**版数 1 から 2 への道が無い**と `migrateProjectData` が
 * 判断してしまうためであり、また「何を捨てたか」を残すためである。
 *
 * `meta.formatVersion` もここで繰り上げる。読み込んだあとのプロジェクトが名乗る
 * 版数は、**変換後の形**でなければならない。保存し直したファイルが「版数 1 だが
 * 中身は版数 2」になると、次に開いたときに変換をもう一度試みることになる。
 */
function dropTripShortName(data: unknown): unknown {
  const root = asRecord(data);
  if (root === null) return data;

  const services = asArray(root.services);
  if (services === null) return data;

  return {
    ...root,
    // null の展開は空オブジェクトになる。meta が壊れていても、その事実は
    // スキーマ検証が拾う。
    meta: { ...asRecord(root.meta), formatVersion: 2 },
    services: services.map((service) => {
      const record = asRecord(service);
      if (record === null) return service;

      const trips = asArray(record.trips);
      if (trips === null) return service;

      return {
        ...record,
        trips: trips.map((trip) => {
          const fields = asRecord(trip);
          if (fields === null) return trip;
          const { tripShortName: _dropped, ...rest } = fields;
          return rest;
        }),
      };
    }),
  };
}

/**
 * 版数 2 → 3: 版数だけを繰り上げる。
 *
 * 版数 3 で回送便を保存しないことにしたが（仕様書 §7.3、T-51）、**回送便を
 * 営業便へ畳む処理はここに置かない**。畳むには停車パターンと区間所要時間が要り、
 * それはネットワーク定義にしかない。変換関数が受け取るのは検証前の `unknown`
 * だけである。
 *
 * 畳むのは参照の修復と同じ段階（`load.ts` の `foldDeadheads`）であり、そこでは
 * 便が型として揃っており、警告（W-06）を並べる先もある。
 *
 * `pullOut` / `pullIn` はスキーマの既定値（`false`）で埋まるため、ここで足す
 * 必要はない。
 */
function bumpToVersion3(data: unknown): unknown {
  const root = asRecord(data);
  if (root === null) return data;
  return { ...root, meta: { ...asRecord(root.meta), formatVersion: 3 } };
}

/**
 * 版数 3 → 4: 版数だけを繰り上げる。
 *
 * 版数 4 でダイヤが運行日カレンダーを持てるようになった（#197、仕様書 v2 §4.4）。
 * **何も足さない。** `Service.calendar` は任意項目であり、**持たないことが正しい
 * 状態**である——案を並べて比べているだけのダイヤは運行日を持たない。
 *
 * 既定値で埋めることもしない。埋めれば「利用者が決めた運行日」と「アプリが
 * 勝手に入れた運行日」が区別できなくなり、**入力した覚えのない日付が GTFS に
 * 出る**。
 */
function bumpToVersion4(data: unknown): unknown {
  const root = asRecord(data);
  if (root === null) return data;
  return { ...root, meta: { ...asRecord(root.meta), formatVersion: 4 } };
}

/**
 * 版数の昇順に並んだ変換の一覧。
 *
 * 形式を変えるときは、ここに `{ from: n, to: n + 1, migrate }` を追加する。
 */
export const MIGRATIONS: readonly Migration[] = [
  { from: 1, to: 2, migrate: dropTripShortName },
  { from: 2, to: 3, migrate: bumpToVersion3 },
  { from: 3, to: 4, migrate: bumpToVersion4 },
];

export type MigrateResult =
  | { readonly ok: true; readonly data: unknown; readonly applied: readonly number[] }
  | { readonly ok: false; readonly reason: 'tooNew'; readonly formatVersion: number }
  | { readonly ok: false; readonly reason: 'noPath'; readonly formatVersion: number };

/**
 * ファイルの内容を現在の形式まで引き上げる。
 *
 * `migrations` を差し替えられるようにしてあるのは、変換が 1 つも無い今の段階でも
 * **枠組みそのものを動かして確かめられる**ようにするためである。動かしたことの
 * ない仕組みは、最初に使う日に必ず壊れている。
 *
 * @param data JSON として解釈しただけの値
 * @param formatVersion ファイルが名乗っている版数
 * @param target 引き上げ先の版数
 */
export function migrateProjectData(
  data: unknown,
  formatVersion: number,
  migrations: readonly Migration[] = MIGRATIONS,
  target: number = CURRENT_FORMAT_VERSION,
): MigrateResult {
  if (formatVersion > target) {
    return { ok: false, reason: 'tooNew', formatVersion };
  }

  let current = data;
  let version = formatVersion;
  const applied: number[] = [];

  while (version < target) {
    const migration = migrations.find((m) => m.from === version);
    if (migration === undefined) {
      // 版数の連なりに穴がある。変換を書き忘れたということであり、
      // 推測で読み進めるより開かない方が安全である。
      return { ok: false, reason: 'noPath', formatVersion: version };
    }
    current = migration.migrate(current);
    version = migration.to;
    applied.push(migration.to);
  }

  return { ok: true, data: current, applied };
}
