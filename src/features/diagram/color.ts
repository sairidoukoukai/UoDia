/**
 * 地色に対して読める色にする（仕様書 §9.4、T-39）。
 *
 * **スジの色は路線の持ち物である**（`route.json` の `color`）。暗い配色に切り替え
 * たからといって、その値を書き換えるわけにはいかない——同じ便が環境によって
 * 違う色のデータになる。ここでするのは**出すときだけ明るさを調える**ことで
 * あり、持っている色は 1 つのままにする。
 *
 * ## なぜ要るか
 *
 * 直行吹田（`#1a4f8a`）は白地では十分濃いが、暗い地色（`#1a1a1a`）に対しては
 * 明暗の比が 2.1 しかない。**線は 1.5px しかなく、色の差がそのまま見えるかどうか
 * になる。** 文字ではないため WCAG の 4.5 は求めないが、図形の下限とされる 3 は
 * 満たしておく。
 */

/** 図形として見分けるための明暗比の下限（WCAG 1.4.11）。 */
export const MIN_CONTRAST = 3;

interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

/** `#rrggbb` を 0〜255 に開く。読めない綴りは黒として扱う。 */
function parse(color: string): Rgb {
  const match = /^#([0-9a-f]{6})$/i.exec(color.trim());
  if (match?.[1] === undefined) return { r: 0, g: 0, b: 0 };

  const value = Number.parseInt(match[1], 16);
  return { r: (value >> 16) & 0xff, g: (value >> 8) & 0xff, b: value & 0xff };
}

function format({ r, g, b }: Rgb): string {
  const hex = (value: number): string =>
    Math.round(Math.min(255, Math.max(0, value)))
      .toString(16)
      .padStart(2, '0');
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

/** 相対輝度（WCAG 2.x の定義）。 */
export function luminance(color: string): number {
  const { r, g, b } = parse(color);
  const channel = (value: number): number => {
    const c = value / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** 明暗の比（1〜21）。 */
export function contrastRatio(a: string, b: string): number {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((high ?? 0) + 0.05) / ((low ?? 0) + 0.05);
}

/** 2 色を混ぜる（`ratio` は `to` の割合）。 */
function mix(from: Rgb, to: Rgb, ratio: number): Rgb {
  return {
    r: from.r + (to.r - from.r) * ratio,
    g: from.g + (to.g - from.g) * ratio,
    b: from.b + (to.b - from.b) * ratio,
  };
}

/**
 * 地色に対して読める色を返す。足りていればそのまま返す。
 *
 * **明るい地色なら黒へ、暗い地色なら白へ寄せる。** 色相は動かさない（混ぜる
 * 相手が無彩色であるため、見分けの手がかりは保たれる）。
 */
export function readableOn(color: string, background: string, minRatio = MIN_CONTRAST): string {
  if (contrastRatio(color, background) >= minRatio) return color;

  const source = parse(color);
  const toward = luminance(background) > 0.5 ? { r: 0, g: 0, b: 0 } : { r: 255, g: 255, b: 255 };

  // 20 段階で寄せ、条件を満たした最初の色を採る。**寄せすぎない**——白に近い
  // 8 本の線は、それはそれで見分けがつかない。
  for (let step = 1; step <= 20; step += 1) {
    const candidate = format(mix(source, toward, step / 20));
    if (contrastRatio(candidate, background) >= minRatio) return candidate;
  }
  return format(toward);
}
