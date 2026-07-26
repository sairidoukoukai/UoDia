/**
 * 新規プロジェクトの生成（仕様書 §7.2）。
 *
 * ダイヤを 1 件だけ含む空のプロジェクトを作る。0 件だと「どのダイヤを編集して
 * いるのか」が定まらず、最初の便を追加する前に利用者がダイヤの作成を強いられる。
 */

import { CURRENT_FORMAT_VERSION, projectSchema, type Project } from '@/domain/model';
import type { NetworkIndex } from '@/domain/network';

export interface CreateProjectOptions {
  readonly name?: string;
  readonly author?: string;
  /**
   * アプリの版数。ドメイン層はビルド設定を知らないため、呼び出し側が渡す。
   */
  readonly appVersion?: string;
  /** 生成時刻。テストを決定的にするために差し替えられる。 */
  readonly now?: Date;
}

/** 既定のダイヤ。 */
const DEFAULT_SERVICE_ID = 'weekday';
const DEFAULT_SERVICE_NAME = '授業期間平日ダイヤ';

export function createProject(network: NetworkIndex, options: CreateProjectOptions = {}): Project {
  const timestamp = (options.now ?? new Date()).toISOString();

  return projectSchema.parse({
    meta: {
      format: 'uodia',
      formatVersion: CURRENT_FORMAT_VERSION,
      appVersion: options.appVersion ?? '0.0.0',
      routeVersion: network.def.version,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    document: {
      name: options.name ?? '',
      author: options.author ?? '',
      comment: '',
    },
    services: [
      {
        serviceId: DEFAULT_SERVICE_ID,
        serviceName: DEFAULT_SERVICE_NAME,
        trips: [],
      },
    ],
    // view は省略する。既定値はスキーマが唯一の定義源であり（T-04）、
    // ここで書き下すと定義が 2 箇所に分かれる。
  });
}

/**
 * 保存時刻を打ち直したプロジェクトを返す。
 *
 * `updatedAt` の更新をシリアライズに紛れ込ませないのは、同じ内容を 2 回保存した
 * ときにバイト単位で同一になる、という性質を壊さないためである。
 */
export function touchProject(project: Project, now: Date = new Date()): Project {
  return { ...project, meta: { ...project.meta, updatedAt: now.toISOString() } };
}
