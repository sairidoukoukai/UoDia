/**
 * GTFS を出せる状態か（仕様書 v2 §3.2、#163、T-81）。**純関数のみ。**
 *
 * ## 足りないものと、直せる場所を一緒に出す
 *
 * 「書き出せません」だけでは、利用者は**どこを直せばよいか分からない。** この
 * 画面はタブが 4 つあり、直す先はそのいずれかである。**足りないものごとに、
 * どのタブへ行けばよいかを添える。**
 *
 * ```
 * ✗ 緯度経度が入っていない停留所が 2 つあります   → 停留所タブ
 * ✗ 運行日がありません                            → カレンダータブ
 * ```
 *
 * ## ここでは直さない
 *
 * 見るだけである。**足りないものを勝手に埋めない**——緯度経度も運行日も、
 * 当てずっぽうで入れたものが配信に乗るほうが、出せないことより悪い。
 */

import type { NetworkDef, Service } from '@/domain/model';
import { agencyEditsOf, missingRequired, AGENCY_FIELDS } from './agency';
import { stopsWithoutCoordinates } from './coordinates';

/** 直す先のタブ。 */
export type ReadinessTab = 'agency' | 'stops' | 'calendar';

/** 直す先の呼び名（画面のタブと同じ言葉）。 */
export const TAB_LABEL: Readonly<Record<ReadinessTab, string>> = {
  agency: '事業者',
  stops: '停留所',
  calendar: 'カレンダー',
};

/** 足りないもの 1 つ。 */
export interface MissingItem {
  /** 何が足りないか。 */
  readonly message: string;
  /** どこで直すか。**タブが無いもの（便）は `null`。** */
  readonly tab: ReadinessTab | null;
}

export interface ReadinessInput {
  readonly network: NetworkDef | null;
  /** 書き出す対象のダイヤ。無ければ `null`。 */
  readonly service: Service | null;
}

/**
 * 足りないものを並べる。**空なら出せる。**
 *
 * 並びは**直す順**である——事業者・停留所は `route.json`、運行日はプロジェクト
 * であり、前者を直すと後者も出し直しになる、ということは無い。それでも順を
 * 決めておくのは、**毎回同じ並びで出れば、直したものが消えていくのが見える**
 * ためである。
 */
export function missingForGtfs(input: ReadinessInput): readonly MissingItem[] {
  const missing: MissingItem[] = [];
  const { network, service } = input;

  if (network === null) {
    return [{ message: '路線図を読み込んでいません', tab: null }];
  }

  for (const field of missingRequired(agencyEditsOf(network.agency))) {
    const label = AGENCY_FIELDS.find((entry) => entry.field === field)?.label ?? field;
    missing.push({ message: `事業者の「${label}」が空です`, tab: 'agency' });
  }

  const withoutCoordinates = stopsWithoutCoordinates(network.stops);
  if (withoutCoordinates.length > 0) {
    const names = withoutCoordinates.map((stop) => stop.shortName).join('・');
    missing.push({
      message: `緯度経度が入っていない停留所があります（${names}）`,
      tab: 'stops',
    });
  }

  if (service === null) {
    missing.push({ message: '書き出すダイヤがありません', tab: null });
    return missing;
  }

  if (service.calendar === undefined) {
    missing.push({ message: '運行日がありません', tab: 'calendar' });
  }

  // **便が無ければ出す意味が無い。** 空の `trips.txt` を配っても、受け取った
  // 側には「バスが 1 本も走らない路線」としか読めない。
  if (service.trips.length === 0) {
    missing.push({ message: '便が 1 つもありません', tab: null });
  }

  return missing;
}

/** 出せるか。 */
export function canExportGtfs(input: ReadinessInput): boolean {
  return missingForGtfs(input).length === 0;
}

/** 足りないもの 1 つを、直せる場所とあわせた一文にする。 */
export function describeMissing(item: MissingItem): string {
  return item.tab === null ? item.message : `${item.message}（${TAB_LABEL[item.tab]}タブ）`;
}

/**
 * 実例と違える 5 点（仕様書 v2 §6.7）。
 *
 * **出したものが実例と 1 バイト単位では一致しない。** なぜ違うのかを、**比べる
 * 人が読める場所に置く**（§6.7）。
 */
export interface Deviation {
  readonly what: string;
  readonly example: string;
  readonly ours: string;
  readonly why: string;
}

export const DEVIATIONS: readonly Deviation[] = [
  {
    what: 'stop_sequence',
    example: '全行 1',
    ours: '1 から順に振る',
    why: '行の並びは仕様が保証していない。順序はほかのどこにも書いていない',
  },
  {
    what: 'pickup_type / drop_off_type',
    example: '空',
    ours: '取扱区分から出す',
    why: '空にすると、乗れない停留所が乗れるものとして配信される',
  },
  {
    what: '微生物研究所前',
    example: 'stop_times に 1 行も無い',
    ours: '出す',
    why: '実際には通る。通る停留所を落とすと、そこで降りる人に届かない',
  },
  {
    what: 'agency_id',
    example: '末尾に空白が付いている',
    ours: '空白なし',
    why: '打ち間違いである（routes.txt の 13 行すべてに付いている）',
  },
  {
    what: 'route_text_color',
    example: '0',
    ours: '000000',
    why: 'GTFS は 6 桁の 16 進数を求めている。読む側の実装次第で色が決まってしまう',
  },
];
