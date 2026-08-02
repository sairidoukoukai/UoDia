/**
 * テーマ（仕様書 §6.5.3、§9.4、T-39）。
 *
 * **配色は CSS が持つ。** ここがするのは「どの配色を使うか」を根の要素に立てる
 * ことだけであり、色の値は 1 つも持たない（`styles.css`）。色を JS 側にも書くと、
 * 片方だけ直した配色が生まれる。
 *
 * ## `system` を既定にする
 *
 * 起動した瞬間に、その人が普段見ている明るさで出るのが驚きが少ない。選び直した
 * ときだけ、その選択が OS より優先される。
 */

import { useEffect, useState } from 'react';
import type { ThemeMode } from '@/store';

/** 実際に使う配色。 */
export type ResolvedTheme = 'light' | 'dark';

/** OS の設定を問い合わせる条件。 */
export const DARK_QUERY = '(prefers-color-scheme: dark)';

/** 選ばれたテーマと OS の設定から、実際に使う配色を決める。 */
export function resolveTheme(mode: ThemeMode, prefersDark: boolean): ResolvedTheme {
  if (mode === 'system') return prefersDark ? 'dark' : 'light';
  return mode;
}

/**
 * 根の要素にテーマを立てる。
 *
 * `system` のときは**属性を外す**。付けたままにすると、OS の設定が変わっても
 * 追随しない（CSS の媒体問い合わせが効かなくなる）。
 */
export function applyTheme(mode: ThemeMode, root: HTMLElement): void {
  if (mode === 'system') {
    root.removeAttribute('data-theme');
    return;
  }
  root.dataset.theme = mode;
}

/** OS が暗い配色を求めているか。**変わったら追随する。** */
export function usePrefersDark(): boolean {
  const [prefersDark, setPrefersDark] = useState(() => globalThis.matchMedia(DARK_QUERY).matches);

  useEffect(() => {
    const media = globalThis.matchMedia(DARK_QUERY);
    const onChange = (event: MediaQueryListEvent): void => {
      setPrefersDark(event.matches);
    };

    media.addEventListener('change', onChange);
    return () => {
      media.removeEventListener('change', onChange);
    };
  }, []);

  return prefersDark;
}

/**
 * 画面のテーマから色を 1 つ読む（T-39）。
 *
 * **色の値は CSS にしか無い。** 一覧の色見本（サイドパネル）も、ダイヤグラムと
 * 同じ調え方をするために地色を要る（`readableOn`）。ここで読めば、JS 側に色を
 * 書き写さずに済む。
 */
export function useThemeColor(name: string, fallback: string): string {
  const prefersDark = usePrefersDark();
  const [color, setColor] = useState(fallback);

  useEffect(() => {
    const read = (): void => {
      const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
      setColor(value === '' ? fallback : value);
    };
    read();

    // テーマを選び直すと根の属性が変わる（`applyTheme`）。**属性を見張る**
    // ——CSS の値そのものは購読できない。
    const observer = new MutationObserver(read);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
    return () => {
      observer.disconnect();
    };
    // OS の設定が変わったときも読み直す。
  }, [name, fallback, prefersDark]);

  return color;
}
