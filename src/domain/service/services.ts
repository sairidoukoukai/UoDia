/**
 * ダイヤそのものに対する操作（仕様書 §5.7、T-33）。
 *
 * 便の操作（`operations.ts`）と同じ約束で書く——**ダイヤの配列からダイヤの
 * 配列を作る純関数**であり、できないことは `null` を返し、何も変わらなければ
 * 同じ参照を返す。
 *
 * ## 名前を空にできない
 *
 * `serviceName` はスキーマが 1 文字以上を要求する（`viewSettingsSchema` と
 * 同じく、**書けても読み込めないファイル**を作らないため）。空の名前を渡す
 * 改名は成り立たない操作であり、`null` を返す。
 *
 * ## 最後の 1 つは消せない
 *
 * ダイヤが 0 本のプロジェクトには便の置き場所が無く、時刻表も出せない。消した
 * 直後の画面に「作り直す」手立てが要ることになる。**そもそも作れない**ように
 * しておく。
 */

import type { Service } from '@/domain/model';

/** 新しく作るダイヤの ID の形。`s` に通し番号を付ける。 */
const SERVICE_ID_PREFIX = 's';

/** 名前を付けずに追加したダイヤの名前。 */
export const NEW_SERVICE_NAME = '新しいダイヤ';

/**
 * まだ使われていないダイヤ ID を配る道具を作る。
 *
 * `tripIdMinter` と同じく**既存の ID から決まる**。乱数を使わないのは、同じ
 * 操作から同じファイルが得られるようにするためである。
 */
export function serviceIdMinter(existing: readonly Service[]): () => string {
  // **一番大きい通し番号の次から配る。** 既定のダイヤ（`weekday`）のように
  // 接頭辞に沿わない ID は数に入らないが、`s` で始まる番号すべてより後ろから
  // 配るため、それらと重なることもない。
  let next = 1;
  for (const service of existing) {
    if (!service.serviceId.startsWith(SERVICE_ID_PREFIX)) continue;
    const digits = service.serviceId.slice(SERVICE_ID_PREFIX.length);
    if (!/^\d+$/.test(digits)) continue;
    next = Math.max(next, Number(digits) + 1);
  }

  return (): string => {
    const id = `${SERVICE_ID_PREFIX}${String(next)}`;
    next += 1;
    return id;
  };
}

/** ダイヤを追加した結果。 */
export interface ServiceInsertion {
  readonly services: readonly Service[];
  /** 作られたダイヤ。呼び出し側が編集対象を移すのに使う。 */
  readonly added: Service;
}

/**
 * 空のダイヤを末尾に足す。
 *
 * **便は写さない。** 既存のダイヤを元にした複製は「ダイヤ間コピー」であり
 * （`copyTripsToService`）、選んだ便だけを写す別の操作である。
 */
export function addService(
  services: readonly Service[],
  name = NEW_SERVICE_NAME,
): ServiceInsertion {
  const added: Service = {
    serviceId: serviceIdMinter(services)(),
    serviceName: name.trim() === '' ? NEW_SERVICE_NAME : name,
    trips: [],
  };
  return { services: [...services, added], added };
}

/**
 * ダイヤの名前を変える。
 *
 * @returns 名前が空、またはそのダイヤが無ければ `null`。名前が同じなら同じ参照
 */
export function renameService(
  services: readonly Service[],
  serviceId: string,
  name: string,
): readonly Service[] | null {
  if (name.trim() === '') return null;

  const index = services.findIndex((service) => service.serviceId === serviceId);
  const target = services[index];
  if (target === undefined) return null;
  if (target.serviceName === name) return services;

  const next = [...services];
  next[index] = { ...target, serviceName: name };
  return next;
}

/**
 * ダイヤを消す。
 *
 * @returns **最後の 1 つ**、またはそのダイヤが無ければ `null`
 */
export function removeService(
  services: readonly Service[],
  serviceId: string,
): readonly Service[] | null {
  if (services.length <= 1) return null;
  const next = services.filter((service) => service.serviceId !== serviceId);
  return next.length === services.length ? null : next;
}
