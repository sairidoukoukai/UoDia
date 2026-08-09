/**
 * 事業者の項目（#198・#221、仕様書 v2 §3.3）。**純関数のみ。**
 *
 * **打つ場所はもう無い**（T-85）。`route.json` に書いてあるものを読み、**欠けて
 * いれば書き出しタブが名指しする**ためにだけ使う（`readiness.ts`）。項目の並びと
 * 呼び名をここに置いておくのは、**「事業者の何が空か」を欄の名前で言える**ように
 * するためである——`agencyUrl` が空です、では読めない。
 */

import type { Agency } from '@/domain/model';

/** 事業者の項目。`agencyId` は含まない（法人番号であり、こちらで採番しない）。 */
export type AgencyField =
  'agencyName' | 'agencyUrl' | 'agencyTimezone' | 'agencyLang' | 'agencyPhone';

/** 項目の並びと呼び名。**足りないものはこの順に並ぶ。** */
export const AGENCY_FIELDS: readonly {
  readonly field: AgencyField;
  readonly label: string;
  /** GTFS で必須の項目か。空のままにできないもの。 */
  readonly required: boolean;
}[] = [
  { field: 'agencyName', label: '事業者名', required: true },
  { field: 'agencyUrl', label: 'URL', required: true },
  { field: 'agencyTimezone', label: 'タイムゾーン', required: true },
  { field: 'agencyLang', label: '言語', required: true },
  { field: 'agencyPhone', label: '電話番号', required: false },
];

/**
 * まだ何も無いときの値（仕様書 v2 §3.3）。
 *
 * **タイムゾーンと言語は既定値を持つ。** どちらも `route.json` に書いていなくても
 * 決まっており、「空です」と言う筋合いのものではない。
 */
export const AGENCY_DEFAULTS: Readonly<Record<AgencyField, string>> = {
  agencyName: '',
  agencyUrl: '',
  agencyTimezone: 'Asia/Tokyo',
  agencyLang: 'ja',
  agencyPhone: '',
};

/** 項目ごとの値。**キーは {@link AgencyField}。** */
export type AgencyEdits = Readonly<Record<AgencyField, string>>;

/** いまの定義から、項目ごとの値を取り出す。 */
export function agencyEditsOf(agency: Agency | undefined): AgencyEdits {
  if (agency === undefined) return AGENCY_DEFAULTS;

  return {
    agencyName: agency.agencyName,
    agencyUrl: agency.agencyUrl,
    agencyTimezone: agency.agencyTimezone,
    agencyLang: agency.agencyLang,
    agencyPhone: agency.agencyPhone ?? '',
  };
}

/** 空のままにできない項目のうち、空のもの。 */
export function missingRequired(edits: AgencyEdits): AgencyField[] {
  return AGENCY_FIELDS.filter((entry) => entry.required && edits[entry.field].trim() === '').map(
    (entry) => entry.field,
  );
}
