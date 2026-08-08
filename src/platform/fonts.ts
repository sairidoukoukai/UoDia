/**
 * PDF に埋めるフォントを読む（仕様書 v2 §5.4.2・§5.4.3、T-77）。
 *
 * ## デスクトップ版と Web 版で作りを分けない
 *
 * フォントは**画面の資産として同梱する**。Vite が別のチャンクに切り出し、
 * デスクトップ版はその `dist/` をそのまま抱えて配られる。**どちらも同じ道を
 * 通る**——`route.json` のように設定ディレクトリへ複製する必要は無い。
 * `route.json` を特別扱いしているのは**利用者が書き換えるから**であり、
 * フォントは読むだけである。
 *
 * ## 書き出しが押されるまで読まない
 *
 * `import()` の中に閉じ込めてある。**初回ロードには 1 バイトも乗らない**
 * （仕様書 §9.1 が言っているのは初回ロードである）。
 *
 * ## ここに置く理由
 *
 * `fetch` は `src/features/` では使えない（`eslint.config.js`）。ブラウザ API を
 * 触ってよいのはこの層だけである。
 */

/** 読んだフォント。**2 度目からは落としてこない。** */
let cached: Uint8Array | null = null;

/**
 * 同梱の Noto Sans JP Regular を読む。
 *
 * @throws 取得に失敗したとき
 */
export async function loadBundledFont(): Promise<Uint8Array> {
  if (cached !== null) return cached;

  const url = (await import('../../assets/fonts/NotoSansJP-Regular.otf?url')).default;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`フォントを取得できません: ${String(response.status)}`);
  }

  cached = new Uint8Array(await response.arrayBuffer());
  return cached;
}
