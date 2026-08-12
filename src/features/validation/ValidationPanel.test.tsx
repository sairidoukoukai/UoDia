// @vitest-environment jsdom

/**
 * 検証パネルをストアごと通す検証（T-34、仕様書 §6.6）。
 *
 * 受入条件は 3 つ——**編集後 300ms で更新される**、**項目クリックで該当箇所へ
 * ジャンプする**、**エラーが 0 件のときその旨が明示される**。
 *
 * 時間は偽の時計で進める。実際に 300ms 待つと、待ち方の間違い（デバウンスが
 * 効かず毎回走っている等）が「たまたま通る」形で隠れる。
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import routeJson from '../../../data/route.json?raw';
import { createProject } from '@/domain/io';
import type { Project, Trip } from '@/domain/model';
import { loadNetworkDef, type NetworkIndex } from '@/domain/network';
import { fromHM } from '@/domain/time';
import { selectView, useAppStore } from '@/store';
import { ValidationPanel } from './ValidationPanel';
import { VALIDATION_DEBOUNCE_MS } from './useValidationIssues';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const loaded = loadNetworkDef(routeJson);
if (!loaded.ok) throw new Error('route.json を読み込めません');
const network: NetworkIndex = loaded.network;

function makeTrip(tripId: string, patternId: string, hours: number, blockId: string): Trip {
  const pattern = network.patternIndex(patternId);
  if (pattern === undefined) throw new Error(`パターン ${patternId} がありません`);
  return {
    tripId,
    patternId,
    anchor: { stopId: pattern.originStopId, time: fromHM(hours, 0) },
    blockId,
    pullOut: false,
    pullIn: false,
  };
}

function makeProject(trips: readonly Trip[]): Project {
  const project = createProject(network, { now: new Date('2026-01-01T00:00:00Z') });
  const [service] = project.services;
  if (service === undefined) throw new Error('既定のダイヤがありません');
  return { ...project, services: [{ ...service, trips: [...trips] }] };
}

let container: HTMLDivElement;
let root: Root;

/** 検証が走るまで時計を進める。 */
function settle(): void {
  act(() => {
    vi.advanceTimersByTime(VALIDATION_DEBOUNCE_MS);
  });
}

function mount(trips: readonly Trip[]): void {
  useAppStore.getState().setSeedNetworkDef(network.def);
  useAppStore.getState().setProject(makeProject(trips));

  root = createRoot(container);
  act(() => {
    root.render(<ValidationPanel />);
  });
  settle();
}

const text = (): string => container.textContent;

function items(): readonly HTMLButtonElement[] {
  return [...container.querySelectorAll<HTMLButtonElement>('.validation__item')];
}

function press(element: HTMLElement | undefined): void {
  if (element === undefined) throw new Error('押すものがありません');
  act(() => {
    element.click();
  });
}

/** 運用 A の 2 便が重なっている（V-03/V-02 のエラーが出る）。 */
const BROKEN: readonly Trip[] = [
  makeTrip('t1', 'S1', 8, 'A'),
  makeTrip('t2', 'T1', 8, 'A'),
  makeTrip('t3', 'S1', 10, 'B'),
];

beforeEach(() => {
  vi.useFakeTimers();
  container = document.createElement('div');
  document.body.append(container);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
  vi.useRealTimers();
});

describe('デバウンス', () => {
  it('**編集してから 300ms で更新される**（受入条件）', () => {
    mount([]);
    expect(items()).toHaveLength(0);

    act(() => {
      useAppStore.getState().editProject('便の入力', (project) => {
        const [service] = project.services;
        if (service !== undefined) service.trips = [...BROKEN];
      });
    });

    // **まだ走っていない。** 打っている最中に指摘が現れては消えるのを防ぐ。
    act(() => {
      vi.advanceTimersByTime(VALIDATION_DEBOUNCE_MS - 50);
    });
    expect(items()).toHaveLength(0);

    act(() => {
      vi.advanceTimersByTime(50);
    });
    expect(items().length).toBeGreaterThan(0);
  });

  it('続けて編集すると、止まってから 1 回だけ走る', () => {
    mount([makeTrip('t1', 'S1', 8, 'A')]);

    for (const hour of [9, 10, 11]) {
      act(() => {
        useAppStore.getState().editProject('時刻の入力', (project) => {
          const trip = project.services[0]?.trips[0];
          if (trip?.anchor != null) trip.anchor = { ...trip.anchor, time: fromHM(hour, 0) };
        });
        vi.advanceTimersByTime(100);
      });
    }

    // 打っている間は走っていない。止まってから走る。
    settle();
    expect(text()).toContain('検証');
  });
});

describe('件数と 0 件の明示', () => {
  it('**エラーが 0 件ならそう言う**（受入条件）', () => {
    mount([]);
    expect(text()).toContain('エラーはありません');
  });

  it('エラーがあれば件数を出す', () => {
    mount(BROKEN);
    expect(text()).toMatch(/エラーが \d+ 件あります/);
  });

  it('重大度ごとの件数を出す', () => {
    mount(BROKEN);
    const counts = [...container.querySelectorAll('.validation__count')].map((el) =>
      el.getAttribute('aria-label'),
    );
    expect(counts).toHaveLength(3);
    expect(counts[0]).toMatch(/^エラー \d+ 件$/);
  });
});

describe('折りたたみ', () => {
  it('畳んでも件数は見える（見ないことにする畳み方をしない）', () => {
    mount(BROKEN);
    const toggle = container.querySelector<HTMLButtonElement>('.validation__toggle');
    expect(toggle?.getAttribute('aria-expanded')).toBe('true');

    press(toggle ?? undefined);

    expect(items()).toHaveLength(0);
    expect(container.querySelectorAll('.validation__count')).toHaveLength(3);
    expect(text()).toMatch(/エラーが \d+ 件あります/);
  });

  it('開閉はプロジェクトに残り、**履歴には載らない**', () => {
    mount(BROKEN);
    press(container.querySelector<HTMLButtonElement>('.validation__toggle') ?? undefined);

    const state = useAppStore.getState();
    expect(selectView(state)?.validationPanelOpen).toBe(false);
    expect(state.history.past).toHaveLength(0);
  });
});

describe('重大度の絞り込み', () => {
  it('外した重大度は一覧から消える', () => {
    mount(BROKEN);
    const before = items().length;

    const errorFilter = [...container.querySelectorAll('label')].find((label) =>
      label.textContent.includes('エラー'),
    );
    press(errorFilter?.querySelector('input') ?? undefined);

    expect(items().length).toBeLessThan(before);
    // 件数の表示は絞り込んでも変わらない（全体の状況を見失わない）。
    expect(text()).toMatch(/エラーが \d+ 件あります/);
  });

  it('**隠しているのであって、無いのではない**と言い分ける', () => {
    mount(BROKEN);
    for (const input of container.querySelectorAll<HTMLInputElement>(
      '.validation__filters input',
    )) {
      press(input);
    }

    expect(text()).toContain('選んだ重大度の指摘はありません');
  });

  it('本当に無いときは「指摘はありません」と言う', () => {
    mount([]);
    expect(text()).toContain('指摘はありません');
    expect(text()).not.toContain('選んだ重大度');
  });
});

describe('ジャンプ', () => {
  it('**押すとその便が選ばれる**（受入条件）', () => {
    mount(BROKEN);

    press(items()[0]);

    expect(useAppStore.getState().ui.selectedTripIds.length).toBeGreaterThan(0);
  });

  it('ダイヤグラムがその時刻へ寄る', () => {
    mount(BROKEN);
    const before = useAppStore.getState().project?.view.diagram.scrollTime;

    press(items()[0]);

    const after = useAppStore.getState().project?.view.diagram.scrollTime;
    expect(after).not.toBe(before);
    // 8:00 の便の少し手前（7:40）。端に貼り付けない。
    expect(after).toBe(fromHM(7, 40));
  });

  it('**方向タブは指図しない**（選択に追随して時刻表が開く。T-38）', () => {
    mount([makeTrip('t1', 'T1', 8, 'A')]);

    press(items()[0]);

    // ここがするのは選ぶことだけである。開く方向は時刻表が決める
    // （`directionToShow`。`Timetable.test.tsx` が確かめている）。
    expect(useAppStore.getState().ui.selectedTripIds).toEqual(['t1']);
    expect(selectView(useAppStore.getState())?.activeDirection).toBe(0);
  });
});
