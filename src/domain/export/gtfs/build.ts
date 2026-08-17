/**
 * GTFS を組み立てる（仕様書 v2 §6.4〜§6.6、#163、T-82）。**純関数のみ。**
 *
 * ## 12 ファイルのうち 10 を出し、2 は見出しだけ出す
 *
 * | ファイル | 出どころ |
 * | --- | --- |
 * | `agency.txt` / `feed_info.txt` | 固定値 |
 * | `stops.txt` / `routes.txt` / `translations.txt` | `route.json` |
 * | `trips.txt` / `stop_times.txt` | プロジェクトの便 |
 * | `calendar.txt` / `calendar_dates.txt` | `Service.calendar` |
 * | `shapes.txt` | **素通し**（何にも依存させない。§6.5.7） |
 * | `office_jp.txt` / `transfers.txt` | **見出しだけ** |
 *
 * ## 回送便を出す
 *
 * v1.0 仕様書 §5.9 の「回送便は出力しない」を**この形式では取り消す**（§6.5.4）。
 * 実例には回送が 26 本入っている。回送は保存されていない導出値であるため、
 * **書き出すときに展開する**（`expandDeadheads`）。
 */

import type {
  Agency,
  NetworkDef,
  Service,
  ServiceCalendar,
  Stop,
  StopPattern,
  Trip,
  Weekday,
} from '@/domain/model';
import type { NetworkIndex } from '@/domain/network';
import { closedDates } from '@/domain/calendar';
import { allTimes, expandDeadheads, numberTrips } from '@/domain/trip';
import type { CsvRows } from '../csv';
import {
  formatGtfsDate,
  formatGtfsTime,
  passthroughFile,
  toGtfsFile,
  type GtfsFile,
} from './format';

/**
 * GTFS の `service_id`（§6.5.8）。**`daily` で固定する。**
 *
 * 書き出すのはダイヤ 1 つだけであり、**その ID が何であるかは誰にも読まれない**
 * ——`calendar.txt` と `trips.txt` を繋ぐためだけの値である。実例が `daily` で
 * あり、揃えれば突き合わせのテストがこの列で落ちない。
 */
export const GTFS_SERVICE_ID = 'daily';

/** `route_type`。**バスで固定。** */
const ROUTE_TYPE_BUS = '3';

/**
 * `location_type`。**車庫も含めてすべて `0`（停留所）とする。**
 *
 * 実例は車庫を `1`（駅・親の括り）としているが、**それでは `stop_times` から
 * 参照できない。** GTFS は「`stop_times` が指してよいのは `location_type: 0`
 * だけ」と定めており、公式の検証器（MobilityData `gtfs-validator` 8.0.1）が
 * `location_with_unexpected_stop_time` をエラーとして出す。**実例をかけても
 * 同じエラーが出る。**
 *
 * **車庫はバスが実際に停まる場所であり、駅ではない。** 回送便を出す以上
 * （§6.5.4）、そこは停留所として書かなければならない。
 */
const LOCATION_TYPE_STOP = '0';

/** 乗れない／降りられないことを表す値。**既定（`0`）は空欄で出す。** */
const NOT_AVAILABLE = '1';

/** 運休（`calendar_dates.txt`）。**`exception_type: 1`（臨時運行）は出さない。** */
const EXCEPTION_REMOVED = '2';

/**
 * その系統が回送か（#247、T-100）。
 *
 * **系統名で決め打たない。** かつては `回送` という名前を直に照らしていたが、
 * 停留所間の回送が別の系統として増えた（`区間回送`）。**回送かどうかは
 * `route.json` が宣言する**（`RouteInfo.isDeadhead`）。
 */
function isDeadheadRoute(def: NetworkDef, routeName: string): boolean {
  return def.routes?.some((route) => route.routeName === routeName && route.isDeadhead) === true;
}

/** 発行者（§6.5.1）。**事業者は大阪大学、発行者は再履バス同好会である。** */
const FEED_PUBLISHER = {
  name: '再履バス同好会',
  url: 'https://sairibus.com/',
  lang: 'ja',
  contactUrl: 'https://sairibus.com/contact/',
} as const;

export interface BuildGtfsInput {
  readonly network: NetworkIndex;
  /** 書き出すダイヤ。**1 つだけ**（§5.2）。 */
  readonly service: Service;
  /**
   * `shapes.txt` の中身。**素通しする**（§6.5.7）。
   *
   * 便からも、パターンからも、`route.json` からも切り離す。**依存が無ければ、
   * 「道筋も直さなくてよいか」という問いが立たない。**
   */
  readonly shapes: string;
}

/**
 * GTFS の 12 ファイルを組み立てる。
 *
 * @throws 運行日が入っていないとき（画面が先に弾く。`features/gtfs/readiness.ts`）
 */
export function buildGtfs(input: BuildGtfsInput): readonly GtfsFile[] {
  const { network, service } = input;
  const { calendar } = service;
  if (calendar === undefined) {
    throw new Error('運行日が入っていません');
  }

  const trips = expandDeadheads(service.trips, network);
  const ids = tripIdsOf(trips, network);

  return [
    toGtfsFile('agency.txt', agencyRows(network.def.agency)),
    toGtfsFile('stops.txt', stopRows(network.def.stops)),
    toGtfsFile('routes.txt', routeRows(network.def, agencyIdOf(network.def.agency))),
    toGtfsFile('trips.txt', tripRows(trips, network, ids)),
    toGtfsFile('stop_times.txt', stopTimeRows(trips, network, ids)),
    toGtfsFile('calendar.txt', calendarRows(calendar)),
    toGtfsFile('calendar_dates.txt', calendarDateRows(calendar)),
    toGtfsFile('translations.txt', translationRows(network.def)),
    toGtfsFile('feed_info.txt', feedInfoRows()),
    toGtfsFile('office_jp.txt', [['office_id', 'office_name', 'office_phone']]),
    toGtfsFile('transfers.txt', [
      ['from_stop_id', 'to_stop_id', 'transfer_type', 'min_transfer_time'],
    ]),
    passthroughFile('shapes.txt', input.shapes),
  ];
}

/** 事業者の ID。**外と突き合わせる ID であり、簡潔にしない**（§6.6）。 */
function agencyIdOf(agency: Agency | undefined): string {
  return agency?.agencyId ?? '';
}

function agencyRows(agency: Agency | undefined): CsvRows {
  return [
    ['agency_id', 'agency_name', 'agency_url', 'agency_timezone', 'agency_lang', 'agency_phone'],
    [
      agencyIdOf(agency),
      agency?.agencyName ?? '',
      agency?.agencyUrl ?? '',
      agency?.agencyTimezone ?? '',
      agency?.agencyLang ?? '',
      agency?.agencyPhone ?? '',
    ],
  ];
}

function feedInfoRows(): CsvRows {
  return [
    [
      'feed_publisher_name',
      'feed_publisher_url',
      'feed_lang',
      'feed_start_date',
      'feed_end_date',
      'feed_version',
      'feed_contact_email',
      'feed_contact_url',
    ],
    [
      FEED_PUBLISHER.name,
      FEED_PUBLISHER.url,
      FEED_PUBLISHER.lang,
      '',
      '',
      '',
      '',
      FEED_PUBLISHER.contactUrl,
    ],
  ];
}

/**
 * `stops.txt`（§6.5.2）。
 *
 * **車庫も出す。** v1.0 仕様書 §5.9 の「`isDepot` は出力しない」を取り消す
 * ——出さないと、**回送便の `stop_times` が参照先の無い停留所を指す。**
 */
function stopRows(stops: readonly Stop[]): CsvRows {
  // **`stop_id` の順に並べる。** `route.json` の並びは縦軸に描く順であり
  // （`axisPosition`）、**絵の都合がフィードの行順に出るのはおかしい。** 実例も
  // `stop_id` 順である。
  const sorted = [...stops].sort((a, b) => a.stopId.localeCompare(b.stopId));

  const rows: CsvRows = [
    ['stop_id', 'stop_name', 'platform_code', 'stop_lat', 'stop_lon', 'location_type'],
    ...sorted.map((stop) => [
      stop.stopId,
      stop.stopName,
      '',
      stop.lat === undefined ? '' : String(stop.lat),
      stop.lon === undefined ? '' : String(stop.lon),
      LOCATION_TYPE_STOP,
    ]),
  ];
  return rows;
}

/**
 * `routes.txt`（§6.5.3）。**1 パターンにつき 1 行。**
 *
 * `route_long_name` は**方向でひっくり返さない。** `route.json` は復りを
 * `吹田豊中線` と持つが、**系統は 1 本**であり、同じ線の往復に 2 つの名前が
 * あると読む側には別の系統に見える。方向は `route_short_name` で分かれる。
 */
function routeRows(def: NetworkDef, agencyId: string): CsvRows {
  return [
    [
      'route_id',
      'agency_id',
      'route_short_name',
      'route_long_name',
      'route_desc',
      'route_type',
      'route_color',
      'route_text_color',
    ],
    ...def.patterns.map((pattern) => {
      const info = routeInfoOf(def, pattern.routeName);
      return [
        pattern.patternId,
        agencyId,
        // 回送は系統名を名乗り、行先はパターン名で言う（実例に合わせる）。
        pattern.isDeadhead ? pattern.routeName : pattern.patternName,
        pattern.isDeadhead ? pattern.patternName : (info?.longName ?? pattern.routeName),
        '',
        ROUTE_TYPE_BUS,
        info?.color ?? '',
        info?.textColor ?? '',
      ];
    }),
  ];
}

function routeInfoOf(def: NetworkDef, routeName: string) {
  return def.routes?.find((route) => route.routeName === routeName);
}

/**
 * 便ごとの `trip_id`（§6.6）。
 *
 * | | |
 * | --- | --- |
 * | 営業便 | **便番号**（`E6` / `W5`。仕様書 §6.1.6） |
 * | 回送便 | **`D1` `D2` …**（同上。#259） |
 *
 * **採番は 1 か所で行う**（`numberTrips`）。かつてはここが回送だけを別の規則で
 * 振っており、**同じ関数が 2 つあった。**
 *
 * **画面と同じ番号になる。** 回送は出入庫も含めて通しで時刻順に振るため
 * （#259）、番号は**採番に何を渡したか**で決まる。ここへ渡すのは展開した便で
 * あり、画面（`selectTripNumbers`）も展開してから渡している。**入口が同じで
 * あるかぎり、出口も同じである。**
 *
 * @param expanded 回送を展開した便。**出入庫にも `trip_id` が要る**
 */
export function tripIdsOf(
  expanded: readonly Trip[],
  network: NetworkIndex,
): ReadonlyMap<string, string> {
  return numberTrips(expanded, network);
}

/**
 * `trips.txt`（§6.5.4）。
 *
 * `trip_headsign` は**終着停留所の名前**である。パターン名（`直行吹田`）は
 * **どう走るか**であって、**どこへ行くか**ではない。乗る人が見るのは後者である。
 *
 * `direction_id` と `shape_id` は**空**（実例と同じ。§6.5.7）。
 */
function tripRows(
  trips: readonly Trip[],
  network: NetworkIndex,
  ids: ReadonlyMap<string, string>,
): CsvRows {
  const rows: string[][] = [
    ['route_id', 'service_id', 'trip_id', 'trip_headsign', 'direction_id', 'block_id', 'shape_id'],
  ];

  for (const trip of trips) {
    const pattern = network.patternIndex(trip.patternId);
    if (pattern === undefined) continue;

    rows.push([
      trip.patternId,
      GTFS_SERVICE_ID,
      ids.get(trip.tripId) ?? trip.tripId,
      network.findStop(pattern.terminalStopId)?.stopName ?? '',
      '',
      trip.blockId,
      '',
    ]);
  }

  return rows;
}

/**
 * `stop_times.txt`（§6.5.5）。
 *
 * **`stop_sequence` を 1 から順に振る**（§6.7.1）。実例は全行 `1` だが、それでは
 * **順序がフィードのどこにも書かれていないことになる**——`stop_id` から引ける表は
 * 存在しない。
 *
 * `arrival_time` と `departure_time` は同じ値である（このバスに停車時分は無い）。
 */
function stopTimeRows(
  trips: readonly Trip[],
  network: NetworkIndex,
  ids: ReadonlyMap<string, string>,
): CsvRows {
  const rows: string[][] = [
    [
      'trip_id',
      'arrival_time',
      'departure_time',
      'stop_id',
      'stop_sequence',
      'stop_headsign',
      'pickup_type',
      'drop_off_type',
      'timepoint',
    ],
  ];

  for (const trip of trips) {
    const pattern = network.patternIndex(trip.patternId);
    if (pattern === undefined) continue;

    const times = allTimes(trip, network);
    const handlings = handlingsOf(pattern.pattern);
    let sequence = 0;

    for (const [stopId] of pattern.offsets) {
      const time = times.get(stopId);
      // **時刻を出せない停留所は行にしない。** 空の時刻を持つ行は GTFS では
      // 「通過」を意味してしまい、通らない便と区別が付かない。
      if (time === undefined) continue;

      sequence += 1;
      const handling = handlings.get(stopId);
      rows.push([
        ids.get(trip.tripId) ?? trip.tripId,
        formatGtfsTime(time),
        formatGtfsTime(time),
        stopId,
        String(sequence),
        '',
        handling === 'alightOnly' ? NOT_AVAILABLE : '',
        handling === 'boardOnly' ? NOT_AVAILABLE : '',
        '',
      ]);
    }
  }

  return rows;
}

function handlingsOf(pattern: StopPattern): ReadonlyMap<string, string> {
  return new Map(pattern.stopSequence.map((stop) => [stop.stopId, stop.handling]));
}

/** `calendar.txt`（§4.6）。**走る曜日と有効期間。** */
function calendarRows(calendar: ServiceCalendar): CsvRows {
  const runs = (weekday: Weekday): string => (calendar.weekdays.includes(weekday) ? '1' : '0');

  return [
    [
      'service_id',
      'monday',
      'tuesday',
      'wednesday',
      'thursday',
      'friday',
      'saturday',
      'sunday',
      'start_date',
      'end_date',
    ],
    [
      GTFS_SERVICE_ID,
      runs('mon'),
      runs('tue'),
      runs('wed'),
      runs('thu'),
      runs('fri'),
      runs('sat'),
      runs('sun'),
      formatGtfsDate(calendar.startDate),
      formatGtfsDate(calendar.endDate),
    ],
  ];
}

/**
 * `calendar_dates.txt`（§4.6）。
 *
 * **運休の日だけを出す。** `exception_type: 1`（臨時運行）は出さない——この
 * カレンダーは「走る曜日から、運行なしの範囲を引く」形であり、**足す方向の例外を
 * 持たない。**
 *
 * **曜日で既に外れている日は出さない**（`closedDates`）。土曜が運休範囲に入って
 * いても、そもそも走らない日であり、書けば実例の 66 行が何倍にも膨らむ。
 */
function calendarDateRows(calendar: ServiceCalendar): CsvRows {
  return [
    ['service_id', 'date', 'exception_type'],
    ...closedDates(calendar).map((date) => [
      GTFS_SERVICE_ID,
      formatGtfsDate(date),
      EXCEPTION_REMOVED,
    ]),
  ];
}

/**
 * `translations.txt`（§6.5.6）。
 *
 * **`record_id` は使わず `field_value` で引き当てる**（実例と同じ）。同じ名前の
 * 停留所が 2 つあれば両方に効くが、このバスにそれは無い。
 *
 * 回送の系統は**英語名だけ**を持つ（実例によみがなが無い）。
 */
function translationRows(def: NetworkDef): CsvRows {
  const rows: string[][] = [
    ['table_name', 'field_name', 'language', 'translation', 'record_id', 'field_value'],
  ];

  const add = (
    table: string,
    field: string,
    language: string,
    translation: string | undefined,
    value: string,
    recordId = '',
  ): void => {
    if (translation === undefined || translation === '') return;
    rows.push([table, field, language, translation, recordId, value]);
  };

  for (const stop of def.stops) {
    add('stops', 'stop_name', 'ja-Hrkt', stop.nameKana, stop.stopName);
    add('stops', 'stop_name', 'en', stop.nameEn, stop.stopName);
  }

  // **系統は 1 つにつき 1 組。** `route.json` は往復で 2 件持つが、
  // `route_long_name` は 1 つに畳んである（§6.5.3）。
  //
  // **回送はここでは出さない。** `routes.txt` の `route_long_name` はパターン名
  // （`車庫発吹田`）であり、系統名（`回送`）ではない——訳語は下でパターンごとに
  // 付ける。
  const seen = new Set<string>();
  for (const route of def.routes ?? []) {
    if (isDeadheadRoute(def, route.routeName)) continue;
    const longName = route.longName ?? route.routeName;
    if (seen.has(longName)) continue;
    seen.add(longName);
    add('routes', 'route_long_name', 'ja-Hrkt', route.kana, longName);
    add('routes', 'route_long_name', 'en', route.en, longName);
  }

  // 回送のパターン名。**系統名ではなくパターン名に付く**（実例と同じ）。
  // **訳語は自分の系統から引く**（T-100）——回送の系統が 2 つになった。
  for (const pattern of def.patterns) {
    if (!pattern.isDeadhead) continue;
    const info = def.routes?.find((route) => route.routeName === pattern.routeName);
    add('routes', 'route_long_name', 'en', info?.en, pattern.patternName);
  }

  const agency = def.agency;
  if (agency !== undefined) {
    add('agency', 'agency_name', 'ja-Hrkt', agency.nameKana, '', agency.agencyId);
    add('agency', 'agency_name', 'en', agency.nameEn, '', agency.agencyId);
  }

  return rows;
}
