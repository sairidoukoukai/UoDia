/**
 * `fontkit` 2.x の型（T-77）。
 *
 * **公式の型定義が無い。** `@types/fontkit` は 1.x 向けであり、2.x の入口
 * （`create`）と噛み合わない。使うのは 1 つの関数だけであり、その 1 つを書く。
 *
 * ここで名乗る形は `features/export/pdf/fontkitAdapter.ts` が要求するものと
 * 揃えてある。**広く書かない**——使っていない口の型を推測で書くと、間違って
 * いても誰も気づけない。
 */
declare module 'fontkit' {
  /** 埋め込むぶんだけを取り出したフォント。 */
  export interface Subset {
    /** サブセット化したフォントのバイト列。 */
    encode(): Uint8Array;
  }

  export interface Font {
    createSubset(): Subset;
  }

  /** バイト列からフォントを読む。 */
  export function create(bytes: Uint8Array, postscriptName?: string): Font;
}
