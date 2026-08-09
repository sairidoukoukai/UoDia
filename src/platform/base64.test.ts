import { describe, expect, it } from 'vitest';
import { toBase64 } from './base64';

/** base64 を戻す。**確かめる側は別の実装を使う**（Node の Buffer）。 */
function fromBase64(text: string): Uint8Array {
  return new Uint8Array(Buffer.from(text, 'base64'));
}

describe('toBase64', () => {
  it('空のバイト列は空文字', () => {
    expect(toBase64(new Uint8Array(0))).toBe('');
  });

  it('既知の値', () => {
    expect(toBase64(new TextEncoder().encode('UoDia'))).toBe('VW9EaWE=');
  });

  it('**0〜255 のすべてを往復できる**（文字として解釈されない）', () => {
    const raw = new Uint8Array(256);
    for (let index = 0; index < 256; index += 1) raw[index] = index;

    expect(fromBase64(toBase64(raw))).toEqual(raw);
  });

  it('**区切りの境目でずれない**（1 区切りは 0x8000 バイト）', () => {
    // 区切りの前後 1 バイトを含む長さで確かめる。区切り方を誤ると、ここで
    // 詰め文字（`=`）が途中に入り、戻したときに長さが変わる。
    for (const length of [0x7fff, 0x8000, 0x8001, 0x8000 * 2 + 3]) {
      const raw = new Uint8Array(length);
      for (let index = 0; index < length; index += 1) raw[index] = index % 256;

      expect(fromBase64(toBase64(raw))).toEqual(raw);
    }
  });

  it('**数 MB でも落ちない**（引数の個数の上限を超えない）', () => {
    const raw = new Uint8Array(5_000_000).fill(200);

    expect(fromBase64(toBase64(raw))).toHaveLength(5_000_000);
  });
});
