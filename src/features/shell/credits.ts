/**
 * 借りているものの表示（仕様書 v2 §5.4.3、T-77）。
 *
 * **本ソフト自体を再配布禁止とすること（仕様書 §12）と両立する。** 自分の
 * 著作物をどう配るかは自分の権利、**同梱した他人の著作物の条件を守るのは他人への
 * 義務**であり、別のことである。
 *
 * ## フォントだけ扱いが違う
 *
 * 依存パッケージ（MIT）は表示だけでよいが、**OFL はライセンス本文を一緒に配る
 * ことを求める。** 本文は画面から読めるようにし（`HelpDialog`）、デスクトップ版は
 * 配布物にも同梱する（`tauri.conf.json` の `bundle.resources`）。
 */

export interface Credit {
  readonly name: string;
  /** 何に使っているか。 */
  readonly use: string;
  readonly license: string;
}

/** 配布物に載る他人の著作物。 */
export const CREDITS: readonly Credit[] = [
  { name: 'React', use: '画面', license: 'MIT' },
  { name: 'Zod', use: 'データの検証', license: 'MIT' },
  { name: 'Immer', use: '編集の記録', license: 'MIT' },
  { name: 'Zustand', use: '状態の保持', license: 'MIT' },
  { name: 'Tauri', use: 'デスクトップ版の器', license: 'MIT / Apache-2.0' },
  { name: 'pdf-lib', use: 'PDF の組み立て', license: 'MIT' },
  { name: 'fontkit', use: 'フォントのサブセット化', license: 'MIT' },
  { name: 'Noto Sans JP', use: 'PDF に埋める書体', license: 'SIL Open Font License 1.1' },
];

/** 本文を一緒に配る必要があるもの。 */
export const OFL_FONT = 'Noto Sans JP';
