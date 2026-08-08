/**
 * 事業者の入力（#198、仕様書 v2 §3.3）。**純関数のみ。**
 *
 * **画面は打った値を持つだけ**にし、「何が変わったか」「入れてよい形か」の判断は
 * ここに集める。設定ダイアログの `segments.ts` と同じ作りである。
 */

import type { Agency } from '@/domain/model';

/** 打ち直せる項目。`agencyId` は含まない（[§3.3](#) の「外と突き合わせる ID」）。 */
export type AgencyField =
  'agencyName' | 'agencyUrl' | 'agencyTimezone' | 'agencyLang' | 'agencyPhone';

/** 画面に出す欄の並び。**この順に上から並ぶ。** */
export const AGENCY_FIELDS: readonly {
  readonly field: AgencyField;
  readonly label: string;
  /** GTFS で必須の項目か。空のままにできないものに印を出す。 */
  readonly required: boolean;
  readonly hint?: string;
}[] = [
  { field: 'agencyName', label: '事業者名', required: true, hint: 'バスを走らせている主体' },
  { field: 'agencyUrl', label: 'URL', required: true },
  { field: 'agencyTimezone', label: 'タイムゾーン', required: true },
  { field: 'agencyLang', label: '言語', required: true },
  { field: 'agencyPhone', label: '電話番号', required: false },
];

/**
 * まだ何も無いときに出す値（仕様書 v2 §3.3）。
 *
 * **タイムゾーンと言語は既定値を入れておく。** 欄としては出す——隠すと、GTFS を
 * 読む側が「なぜこの値なのか」を確かめる手立てが無くなる。既定が入っていれば、
 * 打つ手間は発生しない。
 */
export const AGENCY_DEFAULTS: Readonly<Record<AgencyField, string>> = {
  agencyName: '',
  agencyUrl: '',
  agencyTimezone: 'Asia/Tokyo',
  agencyLang: 'ja',
  agencyPhone: '',
};

/** 打った値の入れ物。**キーは {@link AgencyField}。** */
export type AgencyEdits = Readonly<Record<AgencyField, string>>;

/** いまの定義から、画面の初期値を作る。 */
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

/** いまの定義と違うか。**同じなら書き戻さない。** */
export function agencyChanged(agency: Agency | undefined, edits: AgencyEdits): boolean {
  const current = agencyEditsOf(agency);
  return AGENCY_FIELDS.some((entry) => current[entry.field] !== edits[entry.field]);
}

/**
 * 打った値を `Agency` にする。空の必須項目があれば `null`。
 *
 * **`agencyId` は既存の値を引き継ぐ。** 法人番号であり、こちらで採番し直さない
 * （仕様書 v2 §6.6）。まだ無ければ呼び出し側が決める。
 */
export function toAgency(edits: AgencyEdits, agencyId: string, existing?: Agency): Agency | null {
  if (missingRequired(edits).length > 0) return null;

  const phone = edits.agencyPhone.trim();

  return {
    ...existing,
    agencyId,
    agencyName: edits.agencyName.trim(),
    agencyUrl: edits.agencyUrl.trim(),
    agencyTimezone: edits.agencyTimezone.trim(),
    agencyLang: edits.agencyLang.trim(),
    // **空文字は項目ごと落とす。** 任意の項目に空文字を書くと、GTFS には
    // 「空の欄がある」として出るが、それは値が無いことと同じである。
    ...(phone === '' ? { agencyPhone: undefined } : { agencyPhone: phone }),
  };
}
