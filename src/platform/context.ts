/**
 * プラットフォーム実装の注入（実装計画書 T-12）。
 *
 * アダプタをモジュールの副作用として選ぶ（import した時点で環境を判定する）方式は
 * 採らない。それだと**テストが本物の環境を掴んでしまい**、差し替えるには
 * モジュールのモックが要る。React のコンテキストで上から渡せば、差し替えは
 * 「別の値を渡す」だけで済む。
 */

import { createContext, useContext } from 'react';
import type { PlatformAdapter } from './types';

/** 実装を運ぶコンテキスト。直接使わず {@link usePlatform} を通す。 */
export const PlatformContext = createContext<PlatformAdapter | null>(null);

/**
 * プラットフォーム実装を得る。
 *
 * Provider の外で呼ぶと例外を投げる。`null` を返して呼び出し側に判定させると、
 * 「まだ無いかもしれない」場合の処理が画面のあちこちに散らばる。アダプタは
 * アプリの起動時に必ず用意されるものであり、無いのは組み立ての誤りである。
 */
export function usePlatform(): PlatformAdapter {
  const platform = useContext(PlatformContext);
  if (platform === null) {
    throw new Error('PlatformProvider の外で usePlatform を呼びました');
  }
  return platform;
}
