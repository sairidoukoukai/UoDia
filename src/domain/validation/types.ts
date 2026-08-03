/**
 * ダイヤ検証の型と閾値（仕様書 §6.6）。
 *
 * **便内の時刻矛盾を検査する項目は存在しない。** 便が持つのはアンカー 1 点だけで
 * あり、各停留所の時刻はそこからの純関数として求まるため、便の中で時刻が食い違う
 * 状態が表現できない（仕様書 §5.6）。検証は運用の整合性と便同士の関係に絞られる。
 */

/**
 * 検証項目の識別子。仕様書 §6.6 の表に対応する。
 *
 * **追い越しを検査する項目は存在しない。** 同一パターンの便は所要時間も同じで
 * あり追い越し得ず、経路の違う便どうしの追い越しは正常な運行である（直行便は
 * 箕面学舎を経由しないため、箕面学舎経由の便を追い抜いてよい）。検査すべき
 * 条件が残らないため、仕様書 v4.3 で項目ごと削除した。
 */
export type ValidationId =
  'V-01' | 'V-02' | 'V-03' | 'V-04' | 'V-05' | 'V-06' | 'V-07' | 'V-08' | 'V-09';

/**
 * 重大度。
 *
 * - `error` — ダイヤとして成立していない。実運行できない。
 * - `warning` — 成立はするが、意図しない可能性が高い。
 * - `info` — 未入力や改善の余地の指摘。放置しても構わない。
 */
export type Severity = 'error' | 'warning' | 'info';

/** 問題のある箇所への参照。検証パネルからのジャンプに使う。 */
export interface ValidationTarget {
  readonly tripId?: string;
  readonly blockId?: string;
}

export interface ValidationIssue {
  readonly id: ValidationId;
  readonly severity: Severity;
  readonly message: string;
  readonly target: ValidationTarget;
}

/**
 * 検証の閾値（仕様書 §6.6）。
 *
 * 値を検証ロジックに直接書かないのは、設定ダイアログから変更できるようにする
 * ためである（実装計画書 T-10）。既定値は仕様書の「既定」欄に従う。
 */
export interface ValidationThresholds {
  /** V-06: 同方向の便間隔がこれ未満なら警告。 */
  readonly minHeadwayMinutes: number;
  /** V-06: 同方向の便間隔がこれを超えたら警告。 */
  readonly maxHeadwayMinutes: number;
  /** V-09: 営業所待機がこれ未満なら情報。 */
  readonly minStandbyMinutes: number;
}

export const DEFAULT_THRESHOLDS: ValidationThresholds = {
  minHeadwayMinutes: 5,
  maxHeadwayMinutes: 120,
  minStandbyMinutes: 30,
};

/** 各検証項目の重大度。 */
export const SEVERITY_OF: Readonly<Record<ValidationId, Severity>> = {
  'V-01': 'error',
  'V-02': 'error',
  'V-03': 'error',
  'V-04': 'error',
  'V-05': 'warning',
  'V-06': 'warning',
  'V-07': 'info',
  'V-08': 'info',
  'V-09': 'info',
};
