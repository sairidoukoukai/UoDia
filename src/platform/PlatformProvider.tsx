/**
 * プラットフォーム実装をアプリ全体へ渡す（実装計画書 T-12）。
 *
 * コンテキストとフックは `context.ts` に置いている。1 つのファイルがコンポーネントと
 * それ以外を同時に export すると Fast Refresh が働かなくなるため。
 */

import type { ReactNode } from 'react';
import { PlatformContext } from './context';
import type { PlatformAdapter } from './types';

export interface PlatformProviderProps {
  readonly platform: PlatformAdapter;
  readonly children: ReactNode;
}

export function PlatformProvider({ platform, children }: PlatformProviderProps): ReactNode {
  return <PlatformContext.Provider value={platform}>{children}</PlatformContext.Provider>;
}
