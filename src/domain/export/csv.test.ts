import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { csvField, encodeCsv, toCsv } from './csv';

const decoder = new TextDecoder();

describe('csvField', () => {
  it('普通の値はそのまま', () => {
    expect(csvField('7:40')).toBe('7:40');
    expect(csvField('豊中学舎')).toBe('豊中学舎');
  });

  it('**囲むのは要るときだけ**（囲みを解かない読み手で引用符が値に混じる）', () => {
    expect(csvField('')).toBe('');
    expect(csvField('S1')).toBe('S1');
  });

  it('`,` を含む値は囲む', () => {
    expect(csvField('A,B')).toBe('"A,B"');
  });

  it('引用符は 2 つ重ねて表す（RFC 4180）', () => {
    expect(csvField('言った"そう"')).toBe('"言った""そう"""');
  });

  it('改行を含む値は囲む', () => {
    expect(csvField('上\n下')).toBe('"上\n下"');
    expect(csvField('上\r下')).toBe('"上\r下"');
  });
});

describe('toCsv', () => {
  it('**改行は CRLF**（RFC 4180）', () => {
    expect(toCsv([['a', 'b'], ['c']])).toBe('a,b\r\nc\r\n');
  });

  it('末尾にも改行を置く', () => {
    expect(toCsv([['a']]).endsWith('\r\n')).toBe(true);
  });

  it('空の行も 1 行として書く', () => {
    expect(toCsv([['a'], ['']])).toBe('a\r\n\r\n');
  });

  it('行が無ければ改行 1 つだけ', () => {
    expect(toCsv([])).toBe('\r\n');
  });
});

describe('encodeCsv', () => {
  it('**先頭に BOM を置く**（付けないと Excel が化けさせる）', () => {
    const bytes = encodeCsv([['豊中学舎']]);
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  });

  it('本体は UTF-8', () => {
    const bytes = encodeCsv([['豊中学舎', '7:40']]);
    expect(decoder.decode(bytes.slice(3))).toBe('豊中学舎,7:40\r\n');
  });

  it('**BOM は 1 度だけ**（行ごとに付けない）', () => {
    const bytes = encodeCsv([['a'], ['b']]);
    expect([...bytes].filter((byte) => byte === 0xef)).toHaveLength(1);
  });
});

describe('置き場所（実装計画書 v2 §3.5）', () => {
  const here = fileURLToPath(new URL('.', import.meta.url));

  /** この下にある実装。**入れ子も辿る**（`gtfs/` が増えた。T-82）。 */
  function sourcesUnder(directory: string): string[] {
    const found: string[] = [];
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        found.push(...sourcesUnder(path));
      } else if (entry.name.endsWith('.ts') && !/\.(test|test-utils)\.ts$/.test(entry.name)) {
        found.push(path);
      }
    }
    return found;
  }

  const sources = sourcesUnder(here);

  it('**React を import していない**（受入条件）', () => {
    // 「px も canvas も出てこない」から `domain` に置いた（§3.5）。画面のものを
    // 1 つでも引き込んだ時点で、その理由が崩れる。
    const offenders = sources.filter((path) => {
      const source = readFileSync(path, 'utf8');
      return source.includes("from 'react") || source.includes("from '@/features");
    });

    expect(offenders).toEqual([]);
  });

  it('中身を数え間違えていない（走査が空振りしていない）', () => {
    const names = sources.map((path) => path.slice(here.length));
    expect(names).toContain('csv.ts');
    expect(names).toContain('gtfs/build.ts');
  });
});
