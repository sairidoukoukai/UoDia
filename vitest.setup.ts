/**
 * テストの下ごしらえ。
 *
 * **jsdom に無いものだけを補う。** 実際のブラウザには必ずある機能であり、
 * 本体のコードに「無いかもしれない」分岐を書くと、その分岐は**どの環境でも
 * 通らない道**として残る（T-39）。
 */

// `matchMedia` は jsdom が実装していない。テーマの追随（§9.4）が使う。
if (typeof globalThis.matchMedia !== 'function') {
  Object.defineProperty(globalThis, 'matchMedia', {
    writable: true,
    value: (query: string): MediaQueryList =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        addListener: () => undefined,
        removeListener: () => undefined,
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList,
  });
}
