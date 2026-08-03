// @vitest-environment jsdom

/**
 * ステータスバーの検証（T-32、仕様書 §6.4）。
 *
 * 出しているのは**数え上げた結果**である。便数も運用数もセレクタから来ており、
 * ここが確かめるのは「状態が変われば表示も変わる」ことだけである。
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import routeJson from '../../../data/route.json?raw';
import { createProject } from '@/domain/io';
import type { Project, Trip } from '@/domain/model';
import { loadNetworkDef, type NetworkIndex } from '@/domain/network';
import { fromHM } from '@/domain/time';
import type { DiagramCursor } from '@/features/diagram';
import { useAppStore } from '@/store';
import { StatusBar } from './StatusBar';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const loaded = loadNetworkDef(routeJson);
if (!loaded.ok) throw new Error('route.json を読み込めません');
const network: NetworkIndex = loaded.network;

let counter = 0;

function makeTrip(patternId: string, hours: number, minutes: number, blockId: string): Trip {
  const pattern = network.patternIndex(patternId);
  if (pattern === undefined) throw new Error(`パターン ${patternId} がありません`);
  counter += 1;
  return {
    tripId: `t${String(counter)}`,
    patternId,
    anchor: { stopId: pattern.originStopId, time: fromHM(hours, minutes) },
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

function mount(cursor: DiagramCursor | null = null, message: string | null = null): void {
  root = createRoot(container);
  act(() => {
    root.render(<StatusBar cursor={cursor} message={message} />);
  });
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  useAppStore.getState().setNetworkDef(network.def);
  useAppStore
    .getState()
    .setProject(
      makeProject([
        makeTrip('S1', 8, 0, '1'),
        makeTrip('T1', 9, 0, '2'),
        makeTrip('S1', 10, 0, '2'),
      ]),
    );
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
});

const text = (): string => container.textContent;

/** 作図の道具（#144）。ツールバーを畳んだため、常に見えている場所はここだけ。 */
describe('作図の道具', () => {
  it('**いまどちらの道具を持っているかを出す**（§6.3.3）', () => {
    useAppStore.getState().setTool('select');
    mount();
    expect(text()).toContain('選択');
  });

  it('切り替えると変わる', () => {
    useAppStore.getState().setTool('draw');
    mount();
    expect(text()).toContain('スジ作成');
  });
});

describe('ステータスバー', () => {
  it('便数と運用数を出す（仕様書 §6.4）', () => {
    mount();

    expect(text()).toContain('3 便');
    expect(text()).toContain('2 運用');
  });

  it('編集すれば数え直す', () => {
    mount();

    act(() => {
      useAppStore.getState().editProject('便の削除', (project) => {
        const [service] = project.services;
        if (service !== undefined) service.trips = [];
      });
    });

    expect(text()).toContain('0 便');
    expect(text()).toContain('0 運用');
  });

  it('カーソルの位置を時刻と停留所で出す', () => {
    mount({ time: fromHM(7, 30), stopId: 'toyonaka', shortName: '豊中' });

    expect(text()).toContain('7:30');
    // 縦軸に出ているのと同じ略称で言う（#116）。
    expect(text()).toContain('豊中');
  });

  it('ダイヤグラムの外を指しているときは空欄にする', () => {
    mount(null);

    expect(text()).toContain('—');
  });

  it('保存の状態を出す', () => {
    mount();
    expect(text()).toContain('保存済み');

    act(() => {
      useAppStore.getState().editProject('文書名の変更', (project) => {
        project.document.name = '試作';
      });
    });
    expect(text()).toContain('未保存');
  });

  it('伝えたいことは読み上げにも届ける（§9.4）', () => {
    mount(null, 'route.json を読み込んでいます…');

    const status = container.querySelector('[role="status"]');
    expect(status?.textContent).toBe('route.json を読み込んでいます…');
  });
});
