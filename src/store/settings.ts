import { z } from 'zod';
import { dashKindSchema, diagramViewSchema, gridStyleSchema, type GridStyle } from '@/domain/model';

/**
 * 設定の既定値と範囲（仕様書 §6.5.2、§6.5.3、T-35）。
 *
 * **範囲は型ではなく関数で守る。** 設定は利用者が数字を打つ場所であり、
 * 「1000 段」と打たれた履歴段数をそのまま持つと、取り消しのたびに何万件もの
 * パッチを抱えることになる。受け取ってから収める（`clamp`）ほうが、拒んで
 * 打ち直させるより手数が少ない。
 *
 * 履歴段数の既定と範囲は `history.ts` が持つ（履歴そのものの持ち物である）。
 */

/**
 * テーマ（仕様書 §6.5.3、§9.4）。
 *
 * `system` は OS の設定に従う。**既定はこれである**——起動した瞬間に、その人が
 * 普段見ている明るさで出るのが驚きが少ない。
 */
export const themeModeSchema = z.enum(['system', 'light', 'dark']);
export type ThemeMode = z.infer<typeof themeModeSchema>;

export const DEFAULT_THEME: ThemeMode = 'system';

/** 自動バックアップの間隔（既定 5 分。仕様書 §6.8）。 */
export const DEFAULT_BACKUP_INTERVAL_MS = 5 * 60 * 1000;

/**
 * 自動バックアップの間隔の範囲。
 *
 * 下限を 1 分に置くのは、**書き込みが編集の邪魔になる**手前で止めるためである。
 * 上限の 60 分は「異常終了で失う編集」がそれ以上に広がらないところに置く。
 * 仕様書は既定しか定めていない（§6.5.2）。
 */
export const BACKUP_INTERVAL_LIMITS = { min: 60 * 1000, max: 60 * 60 * 1000 } as const;

/** 間隔を範囲に収める。数でない値は既定に倒す。 */
export function clampBackupInterval(ms: number): number {
  if (!Number.isFinite(ms)) return DEFAULT_BACKUP_INTERVAL_MS;
  return Math.min(BACKUP_INTERVAL_LIMITS.max, Math.max(BACKUP_INTERVAL_LIMITS.min, Math.round(ms)));
}

/** パターンごとの上書き（#147）。**色と線種は独立に選ぶ。** */
export const patternStyleChoiceSchema = z.object({
  color: z.string().optional(),
  dash: dashKindSchema.optional(),
});
export type PatternStyleChoice = z.infer<typeof patternStyleChoiceSchema>;

/**
 * 保存する設定（T-39）。
 *
 * **隠し設定を有効にしたことは保存しない**（`patternsUnlocked`）。起動のたびに
 * 閉じることがその機能の一部である（仕様書 §6.5.4）。保存するのは「この道具を
 * どう使うか」だけで、**開いているファイルには一切依存しない。**
 */
export const persistedSettingsSchema = z.object({
  theme: themeModeSchema.default(DEFAULT_THEME),
  backupIntervalMs: z.number().default(DEFAULT_BACKUP_INTERVAL_MS),
  defaultDiagramView: diagramViewSchema.default({}),
  /**
   * 停留所の線種の上書き（§6.5.3、#133）。
   *
   * **知らない停留所 ID が残っていても構わない。** `route.json` の改訂で
   * 停留所が消えることはあり、そのたびに設定が読めなくなるのでは代償が
   * 大きい。当てるときに引き当たらないだけである。
   */
  stopGridStyles: z.record(z.string(), gridStyleSchema).default({}),
  /**
   * 停車パターンの色と線種の上書き（§6.5.3、#147）。
   *
   * **色と線種は独立に持つ。** 片方だけ選んだときに、もう片方まで
   * `route.json` から離れてしまわないようにする。
   */
  patternStyles: z.record(z.string(), patternStyleChoiceSchema).default({}),
});
export type PersistedSettings = z.infer<typeof persistedSettingsSchema>;

/** 上書きが 1 つも無い状態。**同じ参照を返す**——記憶化の鍵になる。 */
export const NO_GRID_STYLE_OVERRIDES: Readonly<Record<string, GridStyle>> = Object.freeze({});

/** パターンの上書きが 1 つも無い状態。 */
export const NO_PATTERN_STYLES: Readonly<Record<string, PatternStyleChoice>> = Object.freeze({});

/**
 * 保存されている設定を読む。**読めなければ既定に倒す。**
 *
 * 壊れた設定ファイルで起動できなくなるのは、失うものに対して代償が大きい。
 * 設定は作り直せる。
 */
export function parseSettings(json: string | null): PersistedSettings {
  if (json === null) return persistedSettingsSchema.parse({});
  try {
    const parsed: unknown = JSON.parse(json);
    const result = persistedSettingsSchema.safeParse(parsed);
    return result.success ? result.data : persistedSettingsSchema.parse({});
  } catch {
    return persistedSettingsSchema.parse({});
  }
}

/** 設定を書き出す。並びを固定して、同じ内容からは同じバイト列が出るようにする。 */
export function serializeSettings(settings: PersistedSettings): string {
  return `${JSON.stringify(
    {
      backupIntervalMs: settings.backupIntervalMs,
      defaultDiagramView: settings.defaultDiagramView,
      // 停留所の並びも固定する。上書きを足した順で書くと、同じ内容から違う
      // バイト列が出て、**中身が変わっていないのに書き込みが走る**。
      patternStyles: sortedByKey(settings.patternStyles),
      stopGridStyles: sortedByKey(settings.stopGridStyles),
      theme: settings.theme,
    },
    null,
    2,
  )}\n`;
}

function sortedByKey<T>(styles: Readonly<Record<string, T>>): Record<string, T> {
  return Object.fromEntries(Object.entries(styles).sort(([a], [b]) => a.localeCompare(b)));
}
