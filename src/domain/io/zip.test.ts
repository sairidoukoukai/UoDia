/**
 * 無圧縮 zip の検証（T-74、仕様書 v2 §5.3）。
 *
 * ## 自分の書いたものを自分で読んで確かめない
 *
 * 受入条件は「**出来た zip が既存の展開ツールで開ける**」である。自前の解析器で
 * 読み返しても、同じ誤解を 2 度するだけで何も確かめたことにならない。ここでは
 * **外の実装**（`unzip` と Python の `zipfile`）に開かせる。どちらも本ソフトとは
 * 無関係に書かれたものであり、**利用者の手元にあるものと同じ種類**である。
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { buildZip, crc32, dosDateTime, ZIP32_LIMIT } from './zip';

const scratch = mkdtempSync(join(tmpdir(), 'uodia-zip-'));

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

/** その道具が使えるか。無い環境で落とさない。 */
function has(command: string): boolean {
  try {
    execFileSync('which', [command], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const HAS_UNZIP = has('unzip');
const HAS_PYTHON = has('python3');

/** 書庫をファイルに落とす。外の道具に渡すため。 */
function writeArchive(name: string, bytes: Uint8Array): string {
  const path = join(scratch, name);
  writeFileSync(path, bytes);
  return path;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

describe('crc32', () => {
  // 既知の値。CRC-32/ISO-HDLC の教科書的な検査ベクタである。
  it('空のバイト列は 0', () => {
    expect(crc32(new Uint8Array(0))).toBe(0);
  });

  it('"123456789" は 0xCBF43926', () => {
    expect(crc32(encoder.encode('123456789'))).toBe(0xcbf4_3926);
  });

  it('"The quick brown fox jumps over the lazy dog" は 0x414FA339', () => {
    expect(crc32(encoder.encode('The quick brown fox jumps over the lazy dog'))).toBe(0x414f_a339);
  });

  it('**符号なしで返す**（負の数を書き込むと展開ツールが壊れていると言う）', () => {
    // 上位ビットが立つ入力を選ぶ。`>>> 0` を忘れると負の数になる。
    expect(crc32(encoder.encode('a'))).toBeGreaterThan(0);
    expect(crc32(encoder.encode('a'))).toBe(0xe8b7_be43);
  });
});

describe('dosDateTime', () => {
  it('日時を DOS の形に詰める', () => {
    const { time, date } = dosDateTime(new Date(2026, 7, 9, 13, 45, 30));
    expect(date).toBe(((2026 - 1980) << 9) | (8 << 5) | 9);
    expect(time).toBe((13 << 11) | (45 << 5) | 15);
  });

  it('**秒は 2 秒刻みに落ちる**（DOS の日時は 5 ビットしか持たない）', () => {
    const odd = dosDateTime(new Date(2026, 0, 1, 0, 0, 3));
    const even = dosDateTime(new Date(2026, 0, 1, 0, 0, 2));
    expect(odd.time).toBe(even.time);
  });

  it('**1980 年より前は 1980-01-01 に丸める**（表せない）', () => {
    const { time, date } = dosDateTime(new Date(1970, 0, 1));
    expect(time).toBe(0);
    expect(date).toBe((1 << 5) | 1);
  });
});

describe('buildZip', () => {
  it('空の書庫でも終端レコードだけは書く', () => {
    const bytes = buildZip([]);
    expect(bytes).toHaveLength(22);
    expect(new DataView(bytes.buffer).getUint32(0, true)).toBe(0x0605_4b50);
  });

  it('**名前が重なっていれば断る**（展開すると片方が消える）', () => {
    expect(() =>
      buildZip([
        { name: '同じ.txt', bytes: encoder.encode('あ') },
        { name: '同じ.txt', bytes: encoder.encode('い') },
      ]),
    ).toThrow(/重なって/);
  });

  it('上限は 4GiB（zip64 は書かない）', () => {
    expect(ZIP32_LIMIT).toBe(0xffff_ffff);
  });
});

describe.runIf(HAS_UNZIP)('unzip で開ける（受入条件）', () => {
  const bytes = buildZip([
    { name: 'ダイヤグラム.txt', bytes: encoder.encode('スジ') },
    { name: '時刻表_豊中方面.csv', bytes: encoder.encode('便番号,1\r\n') },
  ]);
  const path = writeArchive('unzip.zip', bytes);
  const out = join(scratch, 'out');

  it('**壊れていない**（`unzip -t` が CRC を照合する）', () => {
    expect(() => {
      execFileSync('unzip', ['-t', path], { stdio: 'ignore' });
    }).not.toThrow();
  });

  it('**日本語の名前のまま取り出せる**', () => {
    execFileSync('unzip', ['-o', '-q', path, '-d', out]);

    expect(readFileSync(join(out, 'ダイヤグラム.txt'), 'utf8')).toBe('スジ');
    expect(readFileSync(join(out, '時刻表_豊中方面.csv'), 'utf8')).toBe('便番号,1\r\n');
  });

  it('**取り出したファイルが読める**（権限を書かないと `----------` になる）', () => {
    execFileSync('unzip', ['-o', '-q', path, '-d', out]);

    // 所有者の読み取りビット。ここが落ちると、配った zip を展開した先で
    // 「開けないファイル」が並ぶ。
    expect(statSync(join(out, 'ダイヤグラム.txt')).mode & 0o400).toBe(0o400);
  });
});

describe.runIf(HAS_PYTHON)('Python の zipfile で開ける', () => {
  /** 書庫を Python に読ませ、名前と中身を JSON で返させる。 */
  function readWithPython(path: string): Record<string, string> {
    const script = [
      'import json,sys,zipfile',
      'z=zipfile.ZipFile(sys.argv[1])',
      'assert z.testzip() is None',
      'print(json.dumps({n:z.read(n).decode("utf-8") for n in z.namelist()}))',
    ].join('\n');
    const out = execFileSync('python3', ['-c', script, path], { encoding: 'utf8' });
    return JSON.parse(out) as Record<string, string>;
  }

  it('**日本語のファイル名が化けない**（受入条件）', () => {
    const bytes = buildZip([
      { name: 'ダイヤグラム.png', bytes: encoder.encode('画像') },
      { name: '箱ダイヤ.pdf', bytes: encoder.encode('仕業') },
      { name: '時刻表_吹田方面.csv', bytes: encoder.encode('時刻') },
    ]);

    const read = readWithPython(writeArchive('python.zip', bytes));

    expect(Object.keys(read)).toEqual(['ダイヤグラム.png', '箱ダイヤ.pdf', '時刻表_吹田方面.csv']);
    expect(read['箱ダイヤ.pdf']).toBe('仕業');
  });

  it('**入れた順に並ぶ**（一覧の並びが毎回変わらない）', () => {
    const bytes = buildZip([
      { name: 'b.txt', bytes: encoder.encode('B') },
      { name: 'a.txt', bytes: encoder.encode('A') },
    ]);

    expect(Object.keys(readWithPython(writeArchive('order.zip', bytes)))).toEqual([
      'b.txt',
      'a.txt',
    ]);
  });

  it('**バイト列が 1 ビットも変わらない**（PNG と PDF を包む）', () => {
    // 0〜255 をすべて含む列。文字として解釈されると必ず壊れる。
    const raw = new Uint8Array(256);
    for (let index = 0; index < 256; index += 1) raw[index] = index;

    const path = writeArchive('binary.zip', buildZip([{ name: 'raw.bin', bytes: raw }]));
    const script = [
      'import sys,zipfile',
      'z=zipfile.ZipFile(sys.argv[1])',
      'sys.stdout.write(z.read("raw.bin").hex())',
    ].join('\n');
    const hex = execFileSync('python3', ['-c', script, path], { encoding: 'utf8' });

    expect(hex).toBe([...raw].map((b) => b.toString(16).padStart(2, '0')).join(''));
  });

  it('空のファイルも入れられる', () => {
    const read = readWithPython(
      writeArchive('empty-entry.zip', buildZip([{ name: '空.txt', bytes: new Uint8Array(0) }])),
    );
    expect(read).toEqual({ '空.txt': '' });
  });

  it('**大きめのものでも位置がずれない**（中央ディレクトリの offset）', () => {
    const big = new Uint8Array(300_000).fill(65);
    const read = readWithPython(
      writeArchive(
        'big.zip',
        buildZip([
          { name: '前.txt', bytes: big },
          { name: '後.txt', bytes: encoder.encode('しっぽ') },
        ]),
      ),
    );

    expect(read['前.txt']).toHaveLength(300_000);
    expect(read['後.txt']).toBe('しっぽ');
  });

  it('日時を記録する', () => {
    const path = writeArchive(
      'stamp.zip',
      buildZip([{ name: 'a.txt', bytes: encoder.encode('x') }], {
        modifiedAt: new Date(2026, 7, 9, 13, 45, 30),
      }),
    );
    const script = [
      'import sys,zipfile',
      'print(zipfile.ZipFile(sys.argv[1]).getinfo("a.txt").date_time)',
    ].join('\n');

    expect(execFileSync('python3', ['-c', script, path], { encoding: 'utf8' }).trim()).toBe(
      '(2026, 8, 9, 13, 45, 30)',
    );
  });
});

describe('道具が揃っていること', () => {
  /*
   * **確かめる手立てが消えたことに気づけるようにする。** `describe.runIf` は
   * 道具が無ければ黙って飛ばすため、CI から `unzip` が消えても緑のままになる。
   */
  it('unzip と python3 のどちらかは使える', () => {
    expect(HAS_UNZIP || HAS_PYTHON).toBe(true);
  });
});

describe('TextDecoder による確認', () => {
  it('名前は UTF-8 で書かれている', () => {
    const bytes = buildZip([{ name: '箱ダイヤ.pdf', bytes: new Uint8Array(0) }]);
    // ローカルヘッダ（30 バイト）の直後が名前。
    const name = decoder.decode(bytes.slice(30, 30 + encoder.encode('箱ダイヤ.pdf').length));
    expect(name).toBe('箱ダイヤ.pdf');
  });

  it('**汎用ビット 11 が立っている**（立てないと CP437 と読まれて化ける）', () => {
    const bytes = buildZip([{ name: '箱ダイヤ.pdf', bytes: new Uint8Array(0) }]);
    expect(new DataView(bytes.buffer).getUint16(6, true) & 0x0800).toBe(0x0800);
  });
});
