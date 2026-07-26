/** 題名の追従の検証（T-17、仕様書 §6.8）。 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import { createProject } from '@/domain/io';
import { loadNetworkDef, type NetworkIndex } from '@/domain/network';
import { createMemoryPlatform, type MemoryPlatform } from '@/platform';
import { createAppStore, type AppStoreHook } from '@/store';
import { watchWindowTitle } from './windowTitle';

const routeJsonPath = fileURLToPath(new URL('../../../data/route.json', import.meta.url));
const loaded = loadNetworkDef(readFileSync(routeJsonPath, 'utf8'));
if (!loaded.ok) throw new Error('route.json を読み込めません');
const network: NetworkIndex = loaded.network;

let store: AppStoreHook;
let platform: MemoryPlatform;

beforeEach(() => {
  store = createAppStore();
  store.getState().setNetworkDef(network.def);
  platform = createMemoryPlatform();
});

describe('題名の追従', () => {
  it('始めた時点の題名をすぐ反映する', () => {
    watchWindowTitle(store, platform);
    expect(platform.windowTitle).toBe('無題 — UoDia');
  });

  it('**1 文字打つだけで未保存の印が付く**', () => {
    watchWindowTitle(store, platform);
    store.getState().setProject(createProject(network));
    store.getState().editProject('文書名の変更', (project) => {
      project.document.name = 'あ';
    });
    expect(platform.windowTitle).toBe('無題 [*] — UoDia');
  });

  it('保存すると印が消え、名前が出る', () => {
    watchWindowTitle(store, platform);
    const project = createProject(network);
    store.getState().setProject(project);
    store.getState().editProject('文書名の変更', (p) => {
      p.document.name = 'あ';
    });

    const edited = store.getState().project;
    if (edited === null) throw new Error('プロジェクトがありません');
    store.getState().markSaved(edited, { kind: 'memory', name: 'a.uodia', ref: 'a.uodia' });

    expect(platform.windowTitle).toBe('a.uodia — UoDia');
  });

  it('題名が変わらない変更では書き換えない', () => {
    watchWindowTitle(store, platform);
    platform.windowTitle = '横から書き換えた';

    // 選択は題名に関わらない。
    store.getState().selectTrips(['t1']);
    expect(platform.windowTitle).toBe('横から書き換えた');
  });

  it('やめると追従しなくなる', () => {
    const stop = watchWindowTitle(store, platform);
    stop();

    store.getState().setProject(createProject(network));
    store.getState().editProject('文書名の変更', (project) => {
      project.document.name = 'あ';
    });
    expect(platform.windowTitle).toBe('無題 — UoDia');
  });

  it('題名を変えられなくても編集は続けられる', () => {
    const failing = {
      ...platform,
      setWindowTitle: (): Promise<void> => Promise.reject(new Error('変えられません')),
    };
    expect(() => {
      watchWindowTitle(store, failing);
    }).not.toThrow();
  });
});
