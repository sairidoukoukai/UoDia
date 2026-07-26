/**
 * JSON の解釈。
 *
 * `JSON.parse` は失敗を例外で伝え、成功した値を `any` として返す。ドメイン層は
 * どちらも受け取らない方針であり（失敗は戻り値で表す・`any` を持ち込まない）、
 * 読込を書くたびに同じ包み直しが要る。**`any` に触れる場所を 1 つに閉じる**ため
 * にも、ここへ寄せる。
 */

export type ParseJsonResult =
  /** 解釈できた値。**形は検査していない。** それはスキーマの仕事である。 */
  | { readonly ok: true; readonly value: unknown }
  /** 読めなかった理由。 */
  | { readonly ok: false; readonly message: string };

/**
 * JSON として解釈する。失敗しても例外は投げない。
 *
 * 失敗の文は `String(error)` そのままとする。読めない理由（位置・想定した字）は
 * ブラウザが付けてくれるものが最も詳しく、書き換えると情報が減る。前置きが必要な
 * 呼び出し側は、受け取った文の前に足す。
 */
export function parseJson(json: string): ParseJsonResult {
  try {
    return { ok: true, value: JSON.parse(json) };
  } catch (error) {
    // String() は Error でも非 Error でも読める文字列を返すため、型で分岐しない。
    return { ok: false, message: String(error) };
  }
}
