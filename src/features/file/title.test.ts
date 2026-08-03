/** ウィンドウ題名の検証（T-17、仕様書 §6.8）。 */

import { describe, expect, it } from 'vitest';
import { formatWindowTitle, suggestFileName } from './title';

describe('題名の形式（受入条件）', () => {
  it('保存済みなら `ファイル名 — UoDia`', () => {
    expect(formatWindowTitle('2026年度.uodia', false)).toBe('2026年度.uodia — UoDia');
  });

  it('**未保存なら `[*]` が付く**', () => {
    expect(formatWindowTitle('2026年度.uodia', true)).toBe('2026年度.uodia [*] — UoDia');
  });

  it('保存先が未定なら「無題」', () => {
    expect(formatWindowTitle(null, false)).toBe('無題 — UoDia');
    expect(formatWindowTitle(null, true)).toBe('無題 [*] — UoDia');
  });
});

describe('保存時に出す名前', () => {
  it('既に保存先があればその名前を使う', () => {
    expect(suggestFileName('既存.uodia', '文書名')).toBe('既存.uodia');
  });

  it('無ければ文書名から作る', () => {
    expect(suggestFileName(null, '2026年度')).toBe('2026年度.uodia');
  });

  it('文書名も空なら「無題」', () => {
    expect(suggestFileName(null, '')).toBe('無題.uodia');
    expect(suggestFileName(null, '   ')).toBe('無題.uodia');
  });
});
