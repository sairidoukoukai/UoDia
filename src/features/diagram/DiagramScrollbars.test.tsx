// @vitest-environment jsdom

/**
 * 送りのつまみの検証（#143、仕様書 §6.2.3）。
 *
 * 確かめるのは 2 つ。**動かせるときにだけ出ること**と、**動かした先が視野に
 * そのまま入ること**である。範囲そのものは `interaction.test.ts` が見る。
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import routeJson from '../../../data/route.json?raw';
import { createProject } from '@/domain/io';
import { loadNetworkDef, type NetworkIndex } from '@/domain/network';
import { fromHM } from '@/domain/time';
import { useAppStore } from '@/store';
import { DiagramScrollbars } from './DiagramScrollbars';
import { DEFAULT_DIAGRAM_VIEW } from './interaction';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const loaded = loadNetworkDef(routeJson);
if (!loaded.ok) throw new Error('route.json を読み込めません');
const network: NetworkIndex = loaded.network;

let container: HTMLDivElement;
let root: Root;

/** 窓の大きさを与えて描く。既定の拡大率では、この大きさに 1 日は入らない。 */
function mount(width = 800, height = 300): void {
  root = createRoot(container);
  act(() => {
    root.render(<DiagramScrollbars width={width} height={height} />);
  });
}

function slider(label: string): HTMLInputElement | null {
  return container.querySelector<HTMLInputElement>(`[aria-label="${label}"]`);
}

/** React の管理下にあるつまみを動かす。 */
function drag(field: HTMLInputElement, value: string): void {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.bind(
      field,
    );
    setter?.(value);
    field.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

const view = (): typeof DEFAULT_DIAGRAM_VIEW | undefined =>
  useAppStore.getState().project?.view.diagram;

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);

  useAppStore.getState().setNetworkDef(network.def);
  useAppStore
    .getState()
    .setProject(createProject(network, { now: new Date('2026-01-01T00:00:00Z') }));
  useAppStore.getState().setDiagramView(DEFAULT_DIAGRAM_VIEW);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
});

describe('出す場合', () => {
  it('**時間には送る先がある**（1 日は画面に入らない）', () => {
    mount();
    expect(slider('時間の送り')).not.toBeNull();
  });

  it('縦に入りきらなければ縦のつまみも出す', () => {
    mount(800, 120);
    expect(slider('縦の送り')).not.toBeNull();
  });
});

describe('出さない場合', () => {
  it('**全体が見えているなら出さない**（動かない操作は壊れて見える）', () => {
    // 縦軸（0〜40）が丸ごと入る高さ。
    mount(800, 40 * DEFAULT_DIAGRAM_VIEW.pxPerAxisUnit + 200);
    expect(slider('縦の送り')).toBeNull();
  });

  it('大きさが分からないうちは出さない', () => {
    mount(0, 0);
    expect(container.textContent).toBe('');
    expect(container.querySelector('input')).toBeNull();
  });
});

describe('動かす', () => {
  it('**動かした先がそのまま視野になる**', () => {
    mount();
    const field = slider('時間の送り');
    if (field === null) throw new Error('時間のつまみがありません');

    drag(field, String(fromHM(12, 0)));

    expect(view()?.scrollTime).toBe(fromHM(12, 0));
  });

  it('縦も同じ', () => {
    mount(800, 120);
    const field = slider('縦の送り');
    if (field === null) throw new Error('縦のつまみがありません');

    drag(field, '20');

    expect(view()?.scrollAxis).toBe(20);
  });

  it('**拡大率には触らない**（送るだけである）', () => {
    mount();
    const field = slider('時間の送り');
    if (field === null) throw new Error('時間のつまみがありません');

    drag(field, String(fromHM(12, 0)));

    expect(view()?.pxPerMinute).toBe(DEFAULT_DIAGRAM_VIEW.pxPerMinute);
    expect(view()?.pxPerAxisUnit).toBe(DEFAULT_DIAGRAM_VIEW.pxPerAxisUnit);
  });

  it('**送っても履歴には載らない**（どこを見ているかは編集ではない。§6.2.3）', () => {
    mount();
    const steps = useAppStore.getState().history.past.length;
    const field = slider('時間の送り');
    if (field === null) throw new Error('時間のつまみがありません');

    drag(field, String(fromHM(12, 0)));

    expect(useAppStore.getState().history.past).toHaveLength(steps);
  });
});

describe('読み上げ', () => {
  it('**時刻として読ませる**（秒数のままでは分からない）', () => {
    mount();
    expect(slider('時間の送り')?.getAttribute('aria-valuetext')).toBe('7:00');
  });

  it('縦は停留所の名前で読ませる', () => {
    mount(800, 120);
    expect(slider('縦の送り')?.getAttribute('aria-valuetext')).toBe('豊中のあたり');
  });
});
