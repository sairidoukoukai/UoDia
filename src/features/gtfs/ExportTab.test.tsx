// @vitest-environment jsdom

/**
 * 書き出しタブの検証（T-81・T-85、仕様書 v2 §3.2）。
 *
 * 何が足りないかの判断は `readiness.test.ts` が見る。ここで確かめるのは**画面の
 * 振る舞い**である——**押せないこと**、**移れる先へ移れること**、そして
 * **移れない先は名前で伝えること**（T-85）。
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import routeJson from '../../../data/route.json?raw';
import { createProject } from '@/domain/io';
import { loadNetworkDef, type NetworkIndex } from '@/domain/network';
import { createTrip } from '@/domain/service';
import { fromHM } from '@/domain/time';
import { useAppStore } from '@/store';
import { ExportTab } from './ExportTab';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const loadedDef = loadNetworkDef(routeJson);
if (!loadedDef.ok) throw new Error('route.json を読み込めません');
const network: NetworkIndex = loadedDef.network;

let container: HTMLDivElement;
let root: Root;

/** 便を 1 つ持ち、運行日も入った状態にする。 */
function boot(options: { readonly calendar?: boolean } = {}): void {
  useAppStore.getState().setNetworkDef(network.def);
  useAppStore
    .getState()
    .setProject(createProject(network, { now: new Date('2026-08-09T00:00:00Z') }));

  useAppStore.getState().editProject('用意する', (project) => {
    const [service] = project.services;
    if (service === undefined) return;
    const inserted = createTrip([], 'S3', '1_0', fromHM(9, 0), network);
    if (inserted === null) throw new Error('便を作れません');
    service.trips = [...inserted.trips];
    if (options.calendar !== false) {
      service.calendar = {
        startDate: '2026-04-01',
        endDate: '2027-03-31',
        weekdays: ['mon', 'tue', 'wed', 'thu', 'fri'],
        closedRanges: [],
      };
    }
  });
}

function render(props: Parameters<typeof ExportTab>[0]): void {
  root = createRoot(container);
  act(() => {
    root.render(<ExportTab {...props} />);
  });
}

/** 文字で押しボタンを引く。 */
function button(text: string): HTMLButtonElement {
  const found = [...container.querySelectorAll('button')].find((item) =>
    item.textContent.includes(text),
  );
  if (found === undefined) throw new Error(`「${text}」がありません`);
  return found;
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
  vi.restoreAllMocks();
});

describe('揃っていないとき（受入条件）', () => {
  it('**「運行日がありません」と出て、押せない**', () => {
    boot({ calendar: false });
    render({ onGoTo: () => undefined, onExport: () => Promise.resolve() });

    expect(container.textContent).toContain('運行日がありません');
    expect(button('GTFS を書き出す').disabled).toBe(true);
  });

  it('**直す先へ移れる**', () => {
    boot({ calendar: false });
    const visited: string[] = [];
    render({ onGoTo: (tab) => visited.push(tab), onExport: () => Promise.resolve() });

    act(() => {
      button('直す').click();
    });

    expect(visited).toEqual(['calendar']);
  });

  it('タブの無いものには「直す」を出さない', () => {
    boot({ calendar: false });
    useAppStore.getState().editProject('便を消す', (project) => {
      const [service] = project.services;
      if (service !== undefined) service.trips = [];
    });
    render({ onGoTo: () => undefined });

    // 便が無いことにも「直す」が付いていれば、押しボタンが 2 つになる。
    expect(
      [...container.querySelectorAll('button')].filter((b) => b.textContent === '直す'),
    ).toHaveLength(1);
  });

  it('**route.json を直すものには「直す」を出さない**（移る先が無い。T-85）', () => {
    boot({ calendar: false });
    useAppStore.getState().setNetworkDef({ ...network.def, agency: undefined });
    render({ onGoTo: () => undefined });

    // 事業者の必須 2 項目が欠けても、押せるのはカレンダーの 1 つだけである。
    expect(
      [...container.querySelectorAll('button')].filter((b) => b.textContent === '直す'),
    ).toHaveLength(1);
  });

  it('**それでも直す先は書く**（route.json だと分かる。T-85 受入条件）', () => {
    boot();
    useAppStore.getState().setNetworkDef({ ...network.def, agency: undefined });
    render({ onGoTo: () => undefined });

    expect(container.textContent).toContain('事業者の「事業者名」が空です（route.json');
  });
});

describe('揃っているとき', () => {
  it('押せる', () => {
    boot();
    render({ onGoTo: () => undefined, onExport: () => Promise.resolve() });

    expect(container.textContent).toContain('書き出せます');
    expect(button('GTFS を書き出す').disabled).toBe(false);
  });

  it('押すと書き出しが走る', () => {
    boot();
    let called = 0;
    render({
      onGoTo: () => undefined,
      onExport: () => {
        called += 1;
        return Promise.resolve();
      },
    });

    act(() => {
      button('GTFS を書き出す').click();
    });

    expect(called).toBe(1);
  });

  it('**書き出しが繋がっていなければ押せない**（T-82 が入るまで）', () => {
    boot();
    render({ onGoTo: () => undefined });

    expect(button('GTFS を書き出す').disabled).toBe(true);
  });
});

describe('実例と違えるところ（§6.7）', () => {
  it('**画面に置いてある**（比べる人が読める場所）', () => {
    boot();
    render({ onGoTo: () => undefined });

    expect(container.textContent).toContain('stop_sequence');
    expect(container.textContent).toContain('route_text_color');
  });

  it('**畳んである**（普段の書き出しでは読まない）', () => {
    boot();
    render({ onGoTo: () => undefined });

    const details = container.querySelector('details');
    expect(details?.open).toBe(false);
  });
});
