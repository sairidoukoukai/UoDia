/**
 * 実装の注入の検証（T-12）。
 *
 * 描画結果そのものには関心がなく、**上から渡した実装がそのまま降りてくること**と、
 * 渡し忘れが黙って通らないことだけを確かめる。`renderToStaticMarkup` を使うのは、
 * この 2 点にテスト用の描画ライブラリを増やすほどの理由がないためである。
 */

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { usePlatform } from './context';
import { createMemoryPlatform } from './memory';
import { PlatformProvider } from './PlatformProvider';
import type { ReactNode } from 'react';
import type { PlatformAdapter } from './types';

/** 受け取った実装の識別子を書き出すだけの部品。 */
function ShowKind(): ReactNode {
  return <span>{usePlatform().kind}</span>;
}

describe('PlatformProvider / usePlatform', () => {
  it('渡した実装が子に降りてくる', () => {
    const platform = createMemoryPlatform();
    const html = renderToStaticMarkup(
      <PlatformProvider platform={platform}>
        <ShowKind />
      </PlatformProvider>,
    );
    expect(html).toBe('<span>memory</span>');
  });

  it('入れ子にすると内側が優先される（テストで一部だけ差し替えられる）', () => {
    const outer = createMemoryPlatform();
    const inner: PlatformAdapter = { ...createMemoryPlatform(), kind: 'inner' };
    const html = renderToStaticMarkup(
      <PlatformProvider platform={outer}>
        <PlatformProvider platform={inner}>
          <ShowKind />
        </PlatformProvider>
      </PlatformProvider>,
    );
    expect(html).toBe('<span>inner</span>');
  });

  it('**Provider の外で呼ぶと例外を投げる**（渡し忘れを黙って通さない）', () => {
    expect(() => renderToStaticMarkup(<ShowKind />)).toThrow('PlatformProvider の外');
  });
});
