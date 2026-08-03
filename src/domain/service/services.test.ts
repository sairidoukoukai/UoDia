/**
 * ダイヤの操作の検証（T-33、仕様書 §5.7）。
 *
 * 確かめるのは 3 つ——**書けても読めないファイルを作らない**（空の名前）、
 * **戻せない状態を作らない**（最後の 1 つ）、**何も変わらなければ同じ参照**。
 */

import { describe, expect, it } from 'vitest';
import { serviceSchema, type Service } from '@/domain/model';
import {
  NEW_SERVICE_NAME,
  addService,
  removeService,
  renameService,
  serviceIdMinter,
} from './services';

function makeService(serviceId: string, serviceName = serviceId): Service {
  return { serviceId, serviceName, trips: [] };
}

const SERVICES: readonly Service[] = [makeService('weekday', '授業期間平日ダイヤ')];

describe('ID の採番', () => {
  it('既存の ID から決まる（同じ操作から同じファイルになる）', () => {
    const mint = serviceIdMinter([makeService('s1'), makeService('s2')]);
    expect(mint()).toBe('s3');
    expect(mint()).toBe('s4');
  });

  it('接頭辞に沿わない ID があっても衝突しない', () => {
    const mint = serviceIdMinter([makeService('weekday'), makeService('s1')]);
    expect(mint()).toBe('s2');
  });

  it('数でない後ろが付いた ID は数に入れない', () => {
    const mint = serviceIdMinter([makeService('s2'), makeService('sx')]);
    expect(mint()).toBe('s3');
  });

  it('配った ID どうしも重ならない', () => {
    const mint = serviceIdMinter([]);
    expect([mint(), mint(), mint()]).toEqual(['s1', 's2', 's3']);
  });
});

describe('追加', () => {
  it('空のダイヤが末尾に増える', () => {
    const { services, added } = addService(SERVICES);

    expect(services).toHaveLength(2);
    expect(services[1]).toBe(added);
    expect(added.trips).toEqual([]);
    expect(added.serviceName).toBe(NEW_SERVICE_NAME);
  });

  it('**便は写さない**（複製はダイヤ間コピーの仕事）', () => {
    const { added } = addService([{ ...makeService('weekday'), trips: [] }]);
    expect(added.trips).toHaveLength(0);
  });

  it('名前を渡せる。空白だけなら既定の名前にする', () => {
    expect(addService(SERVICES, '試験期間ダイヤ').added.serviceName).toBe('試験期間ダイヤ');
    expect(addService(SERVICES, '   ').added.serviceName).toBe(NEW_SERVICE_NAME);
  });

  it('作られたダイヤはスキーマを通る', () => {
    expect(serviceSchema.safeParse(addService(SERVICES).added).success).toBe(true);
  });
});

describe('改名', () => {
  it('名前が変わる', () => {
    const next = renameService(SERVICES, 'weekday', '平日');
    expect(next?.[0]?.serviceName).toBe('平日');
    // 元の配列は変えない。
    expect(SERVICES[0]?.serviceName).toBe('授業期間平日ダイヤ');
  });

  it('**空の名前は受け付けない**（スキーマが拒み、開けないファイルになる）', () => {
    expect(renameService(SERVICES, 'weekday', '')).toBeNull();
    expect(renameService(SERVICES, 'weekday', '   ')).toBeNull();
  });

  it('無いダイヤなら何も起きない', () => {
    expect(renameService(SERVICES, 'missing', '平日')).toBeNull();
  });

  it('同じ名前なら同じ参照を返す（履歴に空の 1 段を積まない）', () => {
    expect(renameService(SERVICES, 'weekday', '授業期間平日ダイヤ')).toBe(SERVICES);
  });
});

describe('削除', () => {
  const two = [makeService('weekday'), makeService('s1')];

  it('指したダイヤが消える', () => {
    const next = removeService(two, 's1');
    expect(next).toHaveLength(1);
    expect(next?.[0]?.serviceId).toBe('weekday');
  });

  it('**最後の 1 つは消せない**（便の置き場所が無くなる）', () => {
    expect(removeService(SERVICES, 'weekday')).toBeNull();
  });

  it('無いダイヤなら何も起きない', () => {
    expect(removeService(two, 'missing')).toBeNull();
  });
});
