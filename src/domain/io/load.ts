/**
 * プロジェクトの読込（仕様書 §7.3、§7.4）。
 *
 * ネットワーク定義の読込（T-06）と同じく、**どの段階で失敗したかを型で区別する**。
 * 加えて、開けはするが伝えるべきことがある場合を `warnings` として返す。
 *
 * 壊れた参照でファイルを開けなくするのは避ける。`route.json` を書き換えたあとに
 * 古いプロジェクトを開く、という状況は普通に起こり、そこで「開けません」とだけ
 * 言われても利用者は手を打てない。既定値へ倒したうえで、何をどう倒したかを
 * 警告として並べる。
 */

import {
  parseWithSchema,
  projectSchema,
  type Project,
  type SchemaIssue,
  type Service,
  type Trip,
} from '@/domain/model';
import type { NetworkIndex } from '@/domain/network';
import { originStopId, originTime, terminalStopId, terminalTime } from '@/domain/trip';
import { parseJson } from '@/domain/util';
import { MIGRATIONS, migrateProjectData, type Migration } from './migrate';

/** 読込時の警告の種類。 */
export type ProjectWarningId =
  /** `route.json` の版数がプロジェクトの想定と違う。 */
  | 'W-01'
  /** 停車パターンが見つからず、既定のパターンへ倒した。 */
  | 'W-02'
  /** アンカー停留所が経路に無く、時刻を未入力へ倒した。 */
  | 'W-03'
  /** 知らないキーがあったので読み飛ばした。 */
  | 'W-04'
  /** マイグレーションを適用した。 */
  | 'W-05'
  /** 営業便に畳めない回送便があったので取り除いた（版数 3 への移行）。 */
  | 'W-06';

export interface ProjectWarning {
  readonly id: ProjectWarningId;
  readonly message: string;
  /** 該当箇所。ファイル全体に関わる警告では省略される。 */
  readonly path?: string;
}

export type LoadProjectResult =
  | { readonly ok: true; readonly project: Project; readonly warnings: readonly ProjectWarning[] }
  | { readonly ok: false; readonly stage: 'json'; readonly message: string }
  | { readonly ok: false; readonly stage: 'version'; readonly message: string }
  | { readonly ok: false; readonly stage: 'schema'; readonly issues: readonly SchemaIssue[] };

export interface LoadProjectOptions {
  /**
   * 適用する変換の一覧。既定は {@link MIGRATIONS}。
   *
   * 差し替えられるようにしてあるのは、変換が 1 つも無い今の段階でも読込全体を
   * 通して確かめられるようにするためである（{@link migrateProjectData} と同じ理由）。
   */
  readonly migrations?: readonly Migration[];
  /** 引き上げ先の版数。既定は現在の形式版数。 */
  readonly targetVersion?: number;
}

/**
 * `.uodia` の内容を読み込む。
 *
 * @param json ファイルの中身
 * @param network 参照整合性の検査に使うネットワーク定義
 */
export function loadProject(
  json: string,
  network: NetworkIndex,
  options: LoadProjectOptions = {},
): LoadProjectResult {
  const parsed = parseJson(json);
  if (!parsed.ok) {
    return { ok: false, stage: 'json', message: parsed.message };
  }

  return loadProjectData(parsed.value, network, options);
}

/**
 * 解釈済みのデータから読み込む。`json` の段階だけを飛ばす。
 *
 * 自動バックアップ（T-18）は入れ物の中にプロジェクトを抱えており、既に解釈が
 * 済んでいる。**文字列へ戻してから読み直すのを避けるため**に分けてある。
 * 版数の変換も参照の修復も、通常の読込とまったく同じ手順を通す。
 */
export function loadProjectData(
  raw: unknown,
  network: NetworkIndex,
  options: LoadProjectOptions = {},
): LoadProjectResult {
  const formatVersion = readFormatVersion(raw);
  if (formatVersion === null) {
    return {
      ok: false,
      stage: 'version',
      message: 'meta.formatVersion がありません。UoDia のプロジェクトファイルではないようです',
    };
  }

  const migrated = migrateProjectData(
    raw,
    formatVersion,
    options.migrations ?? MIGRATIONS,
    options.targetVersion,
  );
  if (!migrated.ok) {
    return { ok: false, stage: 'version', message: describeMigrationFailure(migrated) };
  }

  const parsed = parseWithSchema(projectSchema, migrated.data);
  if (!parsed.ok) {
    return { ok: false, stage: 'schema', issues: parsed.issues };
  }

  const warnings: ProjectWarning[] = migrated.applied.map((version) => ({
    id: 'W-05' as const,
    message: `ファイル形式を版 ${String(version)} に変換しました`,
  }));

  warnings.push(...findUnknownKeys(migrated.data, parsed.value).map(unknownKeyWarning));
  warnings.push(...checkRouteVersion(parsed.value, network));

  const repaired = repairReferences(parsed.value, network, warnings);
  // 畳むのは修復のあとである。パターンの参照が直っていなければ、その便が回送
  // なのかどうかも決められない。
  return { ok: true, project: foldDeadheads(repaired, network, warnings), warnings };
}

/** スキーマ検証の前に版数だけを覗く。古いファイルは現在のスキーマに適合しない。 */
function readFormatVersion(raw: unknown): number | null {
  if (!isPlainObject(raw)) return null;
  const { meta } = raw;
  if (!isPlainObject(meta)) return null;
  const { formatVersion } = meta;
  return typeof formatVersion === 'number' && Number.isInteger(formatVersion)
    ? formatVersion
    : null;
}

function describeMigrationFailure(
  failure: Extract<ReturnType<typeof migrateProjectData>, { ok: false }>,
): string {
  const version = String(failure.formatVersion);
  return failure.reason === 'tooNew'
    ? `このファイルは新しい形式（版 ${version}）です。UoDia を更新してください`
    : `版 ${version} からの変換手順がありません`;
}

/** `route.json` の版数がプロジェクトの想定と一致するか（仕様書 §7.3）。 */
function checkRouteVersion(project: Project, network: NetworkIndex): ProjectWarning[] {
  if (project.meta.routeVersion === network.def.version) return [];
  return [
    {
      id: 'W-01',
      message:
        `ネットワーク定義が変更されています（プロジェクト: 版 ${String(project.meta.routeVersion)}、` +
        `現在: 版 ${String(network.def.version)}）。時刻が再計算されます`,
      path: 'meta.routeVersion',
    },
  ];
}

function unknownKeyWarning(path: string): ProjectWarning {
  return { id: 'W-04', message: `知らない項目を読み飛ばしました: ${path}`, path };
}

/**
 * 読み飛ばされたキーを探す。
 *
 * スキーマ検証は知らないキーを黙って捨てる。捨てたこと自体は正しい振る舞いだが、
 * 黙っていると「保存し直したら項目が消えた」という結果だけが残る。検証の前後を
 * 突き合わせて、入力にしか無いキーを集める。
 *
 * 既定値の補完で**出力にだけ**現れるキーは対象外である。
 */
function findUnknownKeys(raw: unknown, parsed: unknown, path = ''): string[] {
  if (Array.isArray(raw) && Array.isArray(parsed)) {
    return raw.flatMap((item: unknown, index) =>
      findUnknownKeys(item, parsed[index], `${path}[${String(index)}]`),
    );
  }
  if (!isPlainObject(raw) || !isPlainObject(parsed)) {
    return [];
  }

  const unknown: string[] = [];
  for (const [key, value] of Object.entries(raw)) {
    const childPath = path === '' ? key : `${path}.${key}`;
    if (key in parsed) {
      unknown.push(...findUnknownKeys(value, parsed[key], childPath));
    } else {
      unknown.push(childPath);
    }
  }
  return unknown;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 壊れた参照を既定値へ倒す（仕様書 §7.4）。
 *
 * - 停車パターンが見つからない便は、方向 0 の既定パターンへ倒す。方向が分からない
 *   以上どちらかを選ぶほかなく、既定パターンなら区間表が揃っていることが保証
 *   されている（R-03・R-05）。
 * - アンカー停留所が経路に無い便は、**時刻を未入力に戻す**。始発へ寄せるなどして
 *   時刻を残すと、利用者が入力した覚えのない時刻がダイヤに紛れ込む。時刻が
 *   消えたことは検証（V-08）にも出るため、見落とされない。
 */
function repairReferences(
  project: Project,
  network: NetworkIndex,
  warnings: ProjectWarning[],
): Project {
  const fallbackPatternId = network.def.patterns.find(
    (p) => p.isDefault && !p.isDeadhead && p.directionId === 0,
  )?.patternId;

  const services = project.services.map((service, serviceIndex) => ({
    ...service,
    trips: service.trips.map((trip, tripIndex) =>
      repairTrip(trip, {
        network,
        warnings,
        fallbackPatternId,
        path: `services[${String(serviceIndex)}].trips[${String(tripIndex)}]`,
      }),
    ),
  }));

  return { ...project, services: services satisfies Service[] };
}

interface RepairContext {
  readonly network: NetworkIndex;
  readonly warnings: ProjectWarning[];
  readonly fallbackPatternId: string | undefined;
  readonly path: string;
}

/**
 * 保存されている回送便を営業便の `pullOut` / `pullIn` へ畳む（仕様書 §7.3、T-51）。
 *
 * 版数 2 以前のファイルには回送便が便として入っている。版数 3 では回送便を
 * 保存しないため、接している営業便の真偽値に移し替えて取り除く。
 *
 * 接点は**停留所と時刻の一致**で見る。0 分折返しの制約により、繋がっている回送は
 * 必ず営業便の始発・終着とぴたり一致する（§6.1.7）。運用番号が違えば繋がって
 * いない。
 *
 * **畳めなかった回送便は黙って捨てない。** 運用番号が空欄のもの、接点が合わない
 * もの、既に畳んだ側と重複しているもの——いずれも本アプリでは作れず、V-01 や
 * V-07 が既に報告していた壊れたデータである。それでも「開いたら便が減っていた」
 * とだけ言われては、何が起きたのか分からない。
 */
function foldDeadheads(
  project: Project,
  network: NetworkIndex,
  warnings: ProjectWarning[],
): Project {
  const services = project.services.map((service, index) =>
    foldServiceDeadheads(service, network, warnings, `services[${String(index)}].trips`),
  );
  return { ...project, services };
}

function foldServiceDeadheads(
  service: Service,
  network: NetworkIndex,
  warnings: ProjectWarning[],
  path: string,
): Service {
  const isDeadhead = (trip: Trip): boolean =>
    network.patternIndex(trip.patternId)?.pattern.isDeadhead === true;

  const deadheads = service.trips.filter(isDeadhead);
  // 回送便が 1 つも無ければ写しを作らない。版数 3 のファイルはここを素通りする。
  if (deadheads.length === 0) return service;

  const kept = service.trips.filter((trip) => !isDeadhead(trip)).map((trip) => ({ ...trip }));

  for (const [index, deadhead] of deadheads.entries()) {
    if (!fold(deadhead, kept, network)) {
      warnings.push({
        id: 'W-06',
        message:
          `回送便 ${deadhead.tripId}（${deadhead.patternId}）を繋がる営業便に畳めませんでした。` +
          `取り除きます`,
        path: `${path}[${String(index)}]`,
      });
    }
  }

  return { ...service, trips: kept };
}

/**
 * 回送便 1 本を、接している営業便へ畳む。畳めれば `true`。
 *
 * 車庫を出る回送は次の営業便の**始発**に、車庫へ入る回送は前の営業便の**終着**に
 * 接する。どちらの向きかを営業所の位置で調べる必要は無い。**接点が一致するかを
 * 両方向で試せば足りる**——営業便が営業所を発着することはなく（R-07）、2 つの
 * 向きが取り違えられることはない。
 *
 * 既にその側が立っている便は選ばない。同じ場所に回送が 2 本あったということで
 * あり、2 本目は畳めなかったものとして報告する。
 */
function fold(deadhead: Trip, revenue: Trip[], network: NetworkIndex): boolean {
  // 運用番号が空欄の回送はどの便とも繋がらない（仕様書 §6.1.3）。
  if (deadhead.blockId === '') return false;

  const sameBlock = (trip: Trip): boolean => trip.blockId === deadhead.blockId;

  const next = revenue.find(
    (trip) =>
      !trip.pullOut &&
      sameBlock(trip) &&
      originStopId(trip, network) === terminalStopId(deadhead, network) &&
      originTime(trip, network) === terminalTime(deadhead, network),
  );
  if (next !== undefined) {
    next.pullOut = true;
    return true;
  }

  const previous = revenue.find(
    (trip) =>
      !trip.pullIn &&
      sameBlock(trip) &&
      terminalStopId(trip, network) === originStopId(deadhead, network) &&
      terminalTime(trip, network) === originTime(deadhead, network),
  );
  if (previous !== undefined) {
    previous.pullIn = true;
    return true;
  }

  return false;
}

function repairTrip(trip: Trip, context: RepairContext): Trip {
  const { network, warnings, fallbackPatternId, path } = context;

  let patternId = trip.patternId;
  if (network.patternIndex(patternId) === undefined && fallbackPatternId !== undefined) {
    warnings.push({
      id: 'W-02',
      message: `停車パターン ${patternId} が見つかりません。${fallbackPatternId} へ変更しました`,
      path: `${path}.patternId`,
    });
    patternId = fallbackPatternId;
  }

  const pattern = network.patternIndex(patternId);
  const { anchor } = trip;
  if (anchor !== null && pattern !== undefined && !pattern.includes(anchor.stopId)) {
    warnings.push({
      id: 'W-03',
      message: `停留所 ${anchor.stopId} は ${patternId} の経路にありません。時刻を未入力に戻しました`,
      path: `${path}.anchor`,
    });
    return { ...trip, patternId, anchor: null };
  }

  return { ...trip, patternId };
}
