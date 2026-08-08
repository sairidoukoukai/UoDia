import { describe, expect, it } from 'vitest';
import { UNTITLED_EXPORT, exportFileName } from './exportName';

const AT = new Date(2026, 7, 9);

describe('exportFileName', () => {
  it('文書名と日付をつなぐ（仕様書 v2 §5.3）', () => {
    expect(exportFileName('2026年度授業期間ダイヤ', null, AT)).toBe(
      '2026年度授業期間ダイヤ_20260809.zip',
    );
  });

  it('**月日は 2 桁に揃える**（名前の長さが揃い、並べたときに読みやすい）', () => {
    expect(exportFileName('ダイヤ', null, new Date(2026, 0, 5))).toBe('ダイヤ_20260105.zip');
  });

  it('文書名が無ければファイル名を使う', () => {
    expect(exportFileName('', '春ダイヤ.uodia', AT)).toBe('春ダイヤ_20260809.zip');
  });

  it('**`.uodia` を落とす**（拡張子を 2 つ並べない）', () => {
    expect(exportFileName('', 'a.uodia', AT)).toBe('a_20260809.zip');
  });

  it('先頭の点は拡張子ではない', () => {
    expect(exportFileName('', '.隠し', AT)).toBe('.隠し_20260809.zip');
  });

  it('どちらも無ければ無題', () => {
    expect(exportFileName('   ', null, AT)).toBe(`${UNTITLED_EXPORT}_20260809.zip`);
  });

  it('**ファイル名に使えない文字を落とす**（環境によって保存できたりできなかったりしない）', () => {
    expect(exportFileName('4/1<改正>: "春"?|\\*', null, AT)).toBe('41改正 春_20260809.zip');
  });

  it('途中の空白は残す', () => {
    expect(exportFileName('春 ダイヤ', null, AT)).toBe('春 ダイヤ_20260809.zip');
  });

  it('**落とした結果が空になったら無題に倒す**', () => {
    expect(exportFileName('///', '???.uodia', AT)).toBe(`${UNTITLED_EXPORT}_20260809.zip`);
  });
});
