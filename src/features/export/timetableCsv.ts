/**
 * 時刻表を CSV にする（仕様書 v2 §5.6、#196、T-76）。
 *
 * ## 画面の写しである
 *
 * 行も列も並びも、時刻表タブで見えているものと同じにする。**別の並びを発明
 * すると、画面と突き合わせられなくなる**——CSV を開いた人が確かめたいのは、
 * たいてい「画面と同じか」である。
 *
 * ## 表そのものは画面と同じものを組む
 *
 * 実装計画書 v2 §3.5 は「時刻表の画面（`features/timetable/model.ts`）とは別に
 * 書く」としていたが、**同じ `buildTimetable` を通す形に変えた。**
 *
 * | | 別に書く | 同じものを通す |
 * | --- | --- | --- |
 * | 受入条件「画面と 1 対 1 で対応している」 | **確かめ続けるもの** | **成り立っているもの** |
 * | 経由しない停留所・参照の壊れた便・出入区の畳み込み | 2 か所に書く | 1 か所 |
 *
 * `model.ts` は React を 1 つも import していない純関数の集まりであり、`domain`
 * にしか依存していない。**画面の側に置いてあるだけで、画面の道具ではない。**
 *
 * **CSV の書式は `domain/export/csv.ts` が持つ**（§3.5 の意図はこちらである）。
 * この層が組むのは「何をどの順に並べるか」だけであり、引用符も BOM も出てこない。
 */

import { encodeCsv, type CsvRows } from '@/domain/export';
import type { DirectionId } from '@/domain/model';
import { formatTime } from '@/domain/time';
import {
  DIRECTION_LABEL,
  buildTimetable,
  buildTripLinks,
  stopsForDirection,
  type LinkCell,
  type TimetableCell,
  type TimetableModel,
} from '@/features/timetable';
import { selectAllTripTimes, selectTripNumbers, selectTripsByDirection } from '@/store';
import type { ExportProducer, ExportSource } from './artifacts';

/** 1 列目に並ぶ行の名前（仕様書 v2 §5.6.1）。画面の左端の列と同じ。 */
export const ROW_LABELS = {
  tripNumber: '便番号',
  pattern: 'パターン',
  block: '運用',
  previous: '前運用',
  next: '次運用',
} as const;

/** 出区・入区に出す文字（画面の押しボタンと同じ言葉）。 */
export const DEPOT_LABEL = { previous: '出区', next: '入区' } as const;

/** その方向のファイル名（仕様書 v2 §5.3）。 */
export function timetableCsvName(directionId: DirectionId): string {
  return `時刻表_${DIRECTION_LABEL[directionId]}.csv`;
}

/**
 * その方向の表を組む。**画面が組むものと同じである。**
 *
 * 空の列は入れない（`emptyColumns` を 0 にする）。空の列は「ここに打てば便に
 * なる」という画面の仕掛けであって（§6.1.1）、**便ではない。** 配る表に空の列を
 * 24 本並べても、受け取った側には何も伝わらない。
 */
export function exportTimetable(source: ExportSource, directionId: DirectionId): TimetableModel {
  const { state, network } = source;
  const trips = selectTripsByDirection(state, directionId);

  return buildTimetable(
    trips,
    stopsForDirection(network, directionId),
    network,
    selectAllTripTimes(state),
    // 繋がりはダイヤの**全便**から求める。運用は方向をまたぐため、片方向だけを
    // 見ると繋がりの半分を見失う（`buildTripLinks`）。
    buildTripLinks(source.service.trips, network, selectTripNumbers(state)),
    0,
  );
}

/**
 * 表を CSV の行にする（仕様書 v2 §5.6.1）。
 *
 * **1 列目は行の名前**である。画面の左端の列がそのまま 1 列目になる。
 */
export function timetableRows(
  timetable: TimetableModel,
  numbers: ReadonlyMap<string, string>,
): CsvRows {
  const columns = timetable.columns;
  const row = (label: string, of: (index: number) => string): readonly string[] => [
    label,
    ...columns.map((_, index) => of(index)),
  ];

  return [
    row(ROW_LABELS.tripNumber, (i) => numbers.get(columns[i]?.trip.tripId ?? '') ?? ''),
    // **記号だけを出す。** 画面もそうしている（行先はパターンと 1 対 1 であり、
    // 併記すると同じことを 2 度言うことになる。仕様書 §6.1.1）。
    row(ROW_LABELS.pattern, (i) => columns[i]?.trip.patternId ?? ''),
    row(ROW_LABELS.block, (i) => columns[i]?.trip.blockId ?? ''),
    row(ROW_LABELS.previous, (i) => linkText(columns[i]?.links.previous, 'previous')),
    ...timetable.stops.map((stop, stopIndex) =>
      row(stop.shortName, (i) => cellText(columns[i]?.cells[stopIndex])),
    ),
    row(ROW_LABELS.next, (i) => linkText(columns[i]?.links.next, 'next')),
  ];
}

/**
 * 升目に出す文字（仕様書 v2 §5.6.2）。
 *
 * **経由しないことと未入力を区別しない。** どちらも「その便のその停留所に時刻が
 * 無い」であり、受け取る側にとって違いが無い。区別する記号を置くと、その記号の
 * 意味を説明する必要が生まれる。
 *
 * **画面はここだけ違う**（経由しない升目に `−` を出す）。画面では隣の升目と
 * 見比べて直行便を見分けるのに要るが、CSV には見比べる相手がいない。
 */
function cellText(cell: TimetableCell | undefined): string {
  // 24 時を超える表記もそのまま（`25:30`。仕様書 §2.1）。
  return cell?.kind === 'time' ? formatTime(cell.time) : '';
}

/**
 * 前運用・次運用の欄（仕様書 v2 §5.6.1）。
 *
 * **回送便は列にならない。** ここに畳んであるためであり（仕様書 §6.1.7）、
 * 画面がそうしている以上、写しもそうなる。
 */
function linkText(cell: LinkCell | undefined, side: 'previous' | 'next'): string {
  if (cell === undefined) return '';
  switch (cell.kind) {
    case 'depot':
      // 画面は車庫側の時刻を出すが、CSV では**出区・入区と書く。** 時刻だけが
      // 並んでいると、それが便番号なのか時刻なのかを読む側が決められない。
      return `${DEPOT_LABEL[side]} ${formatTime(cell.time)}`;
    case 'depotUnresolvable':
      return DEPOT_LABEL[side];
    case 'trip':
      return cell.label;
    case 'none':
      return '';
  }
}

/** その方向の CSV を作る。 */
export function renderTimetableCsv(source: ExportSource, directionId: DirectionId): Uint8Array {
  return encodeCsv(
    timetableRows(exportTimetable(source, directionId), selectTripNumbers(source.state)),
  );
}

/** 一斉出力に入る時刻表 CSV（方向ごとに 1 つ）。 */
export function timetableCsvProducer(directionId: DirectionId): ExportProducer {
  return {
    label: `時刻表（${DIRECTION_LABEL[directionId]}）`,
    fileName: timetableCsvName(directionId),
    build: (source) => renderTimetableCsv(source, directionId),
  };
}
