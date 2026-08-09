/**
 * GTFS を出せる状態か（仕様書 v2 §3.2、#163、T-81）。**純関数のみ。**
 *
 * ## 足りないものと、直せる場所を一緒に出す
 *
 * 「書き出せません」だけでは、利用者は**どこを直せばよいか分からない。**
 * **足りないものごとに、直す先を添える**（{@link FixLocation}）。
 *
 * ```
 * ✗ 運行日がありません                            → カレンダータブ
 * ✗ 緯度経度が入っていない停留所があります         → route.json
 * ✗ 便が 1 つもありません                          → （直す先を 1 つに決められない）
 * ```
 *
 * **直す先は画面の中だけとは限らない**（T-85）。事業者と緯度経度の欄は外した
 * ——変わらない値であり、打てる場所に置くと打ち間違いの入口になる（#221）。
 * 欄が無くなっても**どこを直すかは言える**ので、`route.json` だと書く。
 *
 * ## ここでは直さない
 *
 * 見るだけである。**足りないものを勝手に埋めない**——緯度経度も運行日も、
 * 当てずっぽうで入れたものが配信に乗るほうが、出せないことより悪い。
 */

import type { NetworkDef, Service } from '@/domain/model';
import { agencyEditsOf, missingRequired, AGENCY_FIELDS } from './agency';
import { stopsWithoutCoordinates } from './coordinates';

/** 直す先のタブ。**画面から直せるのはカレンダーだけである**（T-85）。 */
export type ReadinessTab = 'calendar';

/** 直す先の呼び名（画面のタブと同じ言葉）。 */
export const TAB_LABEL: Readonly<Record<ReadinessTab, string>> = {
  calendar: 'カレンダー',
};

/** 手で直すファイル。**画面に欄が無いものはここへ送る**（T-85）。 */
export const NETWORK_DEF_NAME = 'route.json';

/**
 * 直す先。
 *
 * **移れる先と、移れないが名指しできる先を分ける。** 一緒くたにすると、押しても
 * 何も起きない「直す」ボタンが出るか、直す先を黙ったまま断ることになる。
 */
export type FixLocation =
  /** この画面のタブ。**押しボタンで移れる。** */
  | { readonly kind: 'tab'; readonly tab: ReadinessTab }
  /** 手で直すファイル。**移る先が無い。** */
  | { readonly kind: 'file'; readonly file: string }
  /** 直す先が 1 つに決まらない（便を引く、ダイヤを作る）。 */
  | null;

/** 足りないもの 1 つ。 */
export interface MissingItem {
  /** 何が足りないか。 */
  readonly message: string;
  /** どこで直すか。 */
  readonly fix: FixLocation;
}

/** タブへ送る。 */
const inTab = (tab: ReadinessTab): FixLocation => ({ kind: 'tab', tab });
/** `route.json` へ送る。 */
const inNetworkDef: FixLocation = { kind: 'file', file: NETWORK_DEF_NAME };

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
    return [{ message: '路線図を読み込んでいません', fix: null }];
  }

  for (const field of missingRequired(agencyEditsOf(network.agency))) {
    const label = AGENCY_FIELDS.find((entry) => entry.field === field)?.label ?? field;
    missing.push({ message: `事業者の「${label}」が空です`, fix: inNetworkDef });
  }

  const withoutCoordinates = stopsWithoutCoordinates(network.stops);
  if (withoutCoordinates.length > 0) {
    const names = withoutCoordinates.map((stop) => stop.shortName).join('・');
    missing.push({
      message: `緯度経度が入っていない停留所があります（${names}）`,
      fix: inNetworkDef,
    });
  }

  if (service === null) {
    missing.push({ message: '書き出すダイヤがありません', fix: null });
    return missing;
  }

  if (service.calendar === undefined) {
    missing.push({ message: '運行日がありません', fix: inTab('calendar') });
  }

  // **便が無ければ出す意味が無い。** 空の `trips.txt` を配っても、受け取った
  // 側には「バスが 1 本も走らない路線」としか読めない。
  if (service.trips.length === 0) {
    missing.push({ message: '便が 1 つもありません', fix: null });
  }

  return missing;
}

/** 出せるか。 */
export function canExportGtfs(input: ReadinessInput): boolean {
  return missingForGtfs(input).length === 0;
}

/** 足りないもの 1 つを、直せる場所とあわせた一文にする。 */
export function describeMissing(item: MissingItem): string {
  if (item.fix === null) return item.message;
  return item.fix.kind === 'tab'
    ? `${item.message}（${TAB_LABEL[item.fix.tab]}タブ）`
    : `${item.message}（${item.fix.file} を直してください）`;
}

/**
 * 実例と違えるところ（仕様書 v2 §6.7）。
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
  /*
    **6 つめは実装して初めて分かった**（T-82）。仕様書 §6.7 は 5 点としているが、
    実例を 1 バイトずつ読んで見つけた。
  */
  {
    what: '改行',
    example: 'ファイルによって CRLF と LF が混ざっている',
    ours: 'LF に揃える（shapes.txt は素通しのためそのまま）',
    why: '同じ書庫の中で改行が揃っていないのは、作った道具が違うためと思われる',
  },
  {
    what: '車庫の location_type',
    example: '1（駅）',
    ours: '0（停留所）',
    why: '1 のままだと stop_times から参照できず、公式の検証器がエラーを出す。車庫はバスが実際に停まる場所であって駅ではない',
  },
];
