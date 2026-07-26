/**
 * Web 版実装の検証（T-14）。
 *
 * File System Access API がある環境と無い環境の**両方**を通す。片方だけを
 * 確かめると、もう片方は利用者が触るまで誰も動かさないことになる。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FallbackIo, FileSystemAccess, KeyValueStore, WebEnvironment } from './environment';
import { createWebPlatform } from './adapter';
import type { FileHandle } from '../types';

/** メモリ上の鍵と値の保存。 */
function createMemoryStore(): KeyValueStore & { readonly data: Map<string, unknown> } {
  const data = new Map<string, unknown>();
  return {
    data,
    get<T>(key: string): Promise<T | null> {
      return Promise.resolve((data.get(key) ?? null) as T | null);
    },
    set(key: string, value: unknown): Promise<void> {
      data.set(key, value);
      return Promise.resolve();
    },
    remove(key: string): Promise<void> {
      data.delete(key);
      return Promise.resolve();
    },
  };
}

/** File System Access API の代役。取り消しや権限拒否を仕込める。 */
function createFakeFileSystem() {
  const files = new Map<string, string>();
  const state = {
    openTarget: null as string | null,
    saveAsTarget: null as string | null,
    /** 権限を拒否する参照。 */
    denied: new Set<string>(),
    /** 権限を失った参照。 */
    unusable: new Set<string>(),
  };

  const api: FileSystemAccess = {
    open() {
      const name = state.openTarget;
      if (name === null) return Promise.resolve(null);
      return Promise.resolve({ ref: name, name, content: files.get(name) ?? '' });
    },
    save(ref, content) {
      const name = ref as string;
      if (state.denied.has(name)) {
        return Promise.reject(new Error('ファイルへの書き込みが許可されませんでした'));
      }
      files.set(name, content);
      return Promise.resolve();
    },
    saveAs(content) {
      const name = state.saveAsTarget;
      if (name === null) return Promise.resolve(null);
      files.set(name, content);
      return Promise.resolve({ ref: name, name });
    },
    isUsable(ref) {
      return Promise.resolve(!state.unusable.has(ref as string));
    },
  };

  return { api, files, state };
}

function createFakeFallback(): FallbackIo & {
  readonly downloads: { content: string; name: string }[];
  opened: { name: string; content: string } | null;
} {
  const fallback = {
    downloads: [] as { content: string; name: string }[],
    opened: null as { name: string; content: string } | null,
    open(): Promise<{ name: string; content: string } | null> {
      return Promise.resolve(fallback.opened);
    },
    download(content: string, name: string): void {
      fallback.downloads.push({ content, name });
    },
  };
  return fallback;
}

const BUNDLED = '{"version":1,"name":"同梱"}';

function makeEnvironment(withFileSystem: boolean) {
  const store = createMemoryStore();
  const fileSystem = createFakeFileSystem();
  const fallback = createFakeFallback();
  const environment: WebEnvironment = {
    store,
    fileSystem: withFileSystem ? fileSystem.api : null,
    fallback,
    loadBundledNetworkDef: () => Promise.resolve(BUNDLED),
  };
  return { environment, store, fileSystem, fallback, platform: createWebPlatform(environment) };
}

describe('capabilities — 何ができるかを事前に伝える', () => {
  it('File System Access API があれば上書き保存と履歴が使える', () => {
    expect(makeEnvironment(true).platform.capabilities).toEqual({
      saveInPlace: true,
      recentFiles: true,
      networkDefWritable: false,
    });
  });

  it('**無ければ上書き保存も履歴も使えない**', () => {
    expect(makeEnvironment(false).platform.capabilities).toEqual({
      saveInPlace: false,
      recentFiles: false,
      networkDefWritable: false,
    });
  });

  it('route.json はどちらの環境でも書き戻せない（仕様書 §6.5.5）', () => {
    expect(makeEnvironment(true).platform.capabilities.networkDefWritable).toBe(false);
  });
});

describe('openProject — File System Access API がある場合', () => {
  it('選ばれたファイルを開く', async () => {
    const { platform, fileSystem } = makeEnvironment(true);
    fileSystem.files.set('a.uodia', '{"meta":{}}');
    fileSystem.state.openTarget = 'a.uodia';

    const opened = await platform.openProject();
    expect(opened?.content).toBe('{"meta":{}}');
    expect(opened?.handle.name).toBe('a.uodia');
  });

  it('取り消しは null', async () => {
    const { platform } = makeEnvironment(true);
    expect(await platform.openProject()).toBeNull();
  });
});

describe('openProject — フォールバック', () => {
  it('`<input type="file">` で読み込む', async () => {
    const { platform, fallback } = makeEnvironment(false);
    fallback.opened = { name: 'b.uodia', content: '{"meta":{}}' };

    const opened = await platform.openProject();
    expect(opened?.content).toBe('{"meta":{}}');
    expect(opened?.handle.name).toBe('b.uodia');
  });

  it('取り消しは null', async () => {
    expect(await makeEnvironment(false).platform.openProject()).toBeNull();
  });
});

describe('saveProject', () => {
  it('開いたファイルへ上書きする', async () => {
    const { platform, fileSystem } = makeEnvironment(true);
    fileSystem.files.set('a.uodia', '古い');
    fileSystem.state.openTarget = 'a.uodia';
    const opened = await platform.openProject();
    if (opened === null) throw new Error('開けません');

    await platform.saveProject(opened.handle, '新しい');
    expect(fileSystem.files.get('a.uodia')).toBe('新しい');
  });

  it('**フォールバックではダウンロードになる**（上書きできないため）', async () => {
    const { platform, fallback } = makeEnvironment(false);
    fallback.opened = { name: 'b.uodia', content: '古い' };
    const opened = await platform.openProject();
    if (opened === null) throw new Error('開けません');

    await platform.saveProject(opened.handle, '新しい');
    expect(fallback.downloads).toEqual([{ content: '新しい', name: 'b.uodia' }]);
  });

  it('**権限を拒否されてもクラッシュせずエラーになる**', async () => {
    const { platform, fileSystem } = makeEnvironment(true);
    fileSystem.files.set('a.uodia', '古い');
    fileSystem.state.openTarget = 'a.uodia';
    fileSystem.state.denied.add('a.uodia');
    const opened = await platform.openProject();
    if (opened === null) throw new Error('開けません');

    await expect(platform.saveProject(opened.handle, '新しい')).rejects.toThrow('許可されません');
    expect(fileSystem.files.get('a.uodia')).toBe('古い');
  });

  it('他の実装のハンドルは拒む', async () => {
    const foreign: FileHandle = { kind: 'tauri', name: 'a.uodia', ref: '/tmp/a.uodia' };
    await expect(makeEnvironment(true).platform.saveProject(foreign, '中身')).rejects.toThrow(
      TypeError,
    );
  });
});

describe('saveProjectAs', () => {
  it('保存先を選んで書き、ハンドルを返す', async () => {
    const { platform, fileSystem } = makeEnvironment(true);
    fileSystem.state.saveAsTarget = 'c.uodia';

    const handle = await platform.saveProjectAs('中身', 'なまえ.uodia');
    expect(handle?.name).toBe('c.uodia');
    expect(fileSystem.files.get('c.uodia')).toBe('中身');
  });

  it('取り消しは null で、書き込まない', async () => {
    const { platform, fileSystem } = makeEnvironment(true);
    expect(await platform.saveProjectAs('中身', 'なまえ.uodia')).toBeNull();
    expect(fileSystem.files.size).toBe(0);
  });

  it('フォールバックではダウンロードし、名前だけのハンドルを返す', async () => {
    const { platform, fallback } = makeEnvironment(false);

    const handle = await platform.saveProjectAs('中身', 'なまえ.uodia');
    expect(fallback.downloads).toEqual([{ content: '中身', name: 'なまえ.uodia' }]);
    expect(handle?.name).toBe('なまえ.uodia');
  });

  it('フォールバックで返したハンドルは、次も上書きにならない', async () => {
    // ダウンロードした先をブラウザは教えてくれない。
    const { platform, fallback } = makeEnvironment(false);
    const handle = await platform.saveProjectAs('1 回目', 'なまえ.uodia');
    if (handle === null) throw new Error('ハンドルがありません');

    await platform.saveProject(handle, '2 回目');
    expect(fallback.downloads.map((d) => d.content)).toEqual(['1 回目', '2 回目']);
  });
});

describe('route.json', () => {
  it('編集分が無ければ同梱のものを読む', async () => {
    expect(await makeEnvironment(true).platform.loadNetworkDef()).toBe(BUNDLED);
  });

  it('編集分があればそちらを読む', async () => {
    const { platform, store } = makeEnvironment(true);
    await store.set('networkDef', '{"version":2,"name":"編集済み"}');
    expect(await platform.loadNetworkDef()).toBe('{"version":2,"name":"編集済み"}');
  });

  it('**書き戻そうとすると理由を添えて失敗する**', async () => {
    await expect(makeEnvironment(true).platform.saveNetworkDef('中身')).rejects.toThrow(
      '書き戻せません',
    );
  });
});

describe('バックアップ（仕様書 §6.8）', () => {
  it('書いて読める', async () => {
    const { platform } = makeEnvironment(true);
    await platform.writeBackup('中身');
    expect(await platform.readBackup()).toBe('中身');
  });

  it('無ければ null', async () => {
    expect(await makeEnvironment(true).platform.readBackup()).toBeNull();
  });

  it('消せる', async () => {
    const { platform } = makeEnvironment(true);
    await platform.writeBackup('中身');
    await platform.clearBackup();
    expect(await platform.readBackup()).toBeNull();
  });

  it('フォールバック環境でも使える（保存先はブラウザ内であるため）', async () => {
    const { platform } = makeEnvironment(false);
    await platform.writeBackup('中身');
    expect(await platform.readBackup()).toBe('中身');
  });
});

describe('最近使ったファイル（仕様書 §6.8）', () => {
  async function openAndRemember(
    platform: ReturnType<typeof makeEnvironment>['platform'],
    fileSystem: ReturnType<typeof makeEnvironment>['fileSystem'],
    name: string,
  ): Promise<void> {
    fileSystem.files.set(name, '中身');
    fileSystem.state.openTarget = name;
    const opened = await platform.openProject();
    if (opened === null) throw new Error('開けません');
    await platform.addRecentFile(opened.handle);
  }

  it('新しい順に並ぶ', async () => {
    const { platform, fileSystem } = makeEnvironment(true);
    await openAndRemember(platform, fileSystem, 'a.uodia');
    await openAndRemember(platform, fileSystem, 'b.uodia');

    expect((await platform.listRecentFiles()).map((r) => r.handle.name)).toEqual([
      'b.uodia',
      'a.uodia',
    ]);
  });

  it('同じファイルは重複しない', async () => {
    const { platform, fileSystem } = makeEnvironment(true);
    await openAndRemember(platform, fileSystem, 'a.uodia');
    await openAndRemember(platform, fileSystem, 'b.uodia');
    await openAndRemember(platform, fileSystem, 'a.uodia');

    expect((await platform.listRecentFiles()).map((r) => r.handle.name)).toEqual([
      'a.uodia',
      'b.uodia',
    ]);
  });

  it('10 件を超えると古いものから落ちる', async () => {
    const { platform, fileSystem } = makeEnvironment(true);
    for (let i = 0; i < 15; i++) {
      await openAndRemember(platform, fileSystem, `f${String(i)}.uodia`);
    }
    expect(await platform.listRecentFiles()).toHaveLength(10);
  });

  it('**権限を失った参照は一覧から落とす**（開けないものを出さない）', async () => {
    const { platform, fileSystem } = makeEnvironment(true);
    await openAndRemember(platform, fileSystem, 'a.uodia');
    await openAndRemember(platform, fileSystem, 'b.uodia');
    fileSystem.state.unusable.add('a.uodia');

    expect((await platform.listRecentFiles()).map((r) => r.handle.name)).toEqual(['b.uodia']);
  });

  it('**フォールバック環境では常に空**（参照を覚えられないため）', async () => {
    const { platform, fallback } = makeEnvironment(false);
    fallback.opened = { name: 'b.uodia', content: '中身' };
    const opened = await platform.openProject();
    if (opened === null) throw new Error('開けません');

    await platform.addRecentFile(opened.handle);
    expect(await platform.listRecentFiles()).toEqual([]);
  });

  it('フォールバック環境で追加しても例外にはしない', async () => {
    // 呼び出し側に環境ごとの分岐を書かせないため。
    const { platform } = makeEnvironment(false);
    const handle = await platform.saveProjectAs('中身', 'a.uodia');
    if (handle === null) throw new Error('ハンドルがありません');
    await expect(platform.addRecentFile(handle)).resolves.toBeUndefined();
  });

  it('他の実装のハンドルは拒む', async () => {
    const foreign: FileHandle = { kind: 'tauri', name: 'a.uodia', ref: '/tmp/a.uodia' };
    await expect(makeEnvironment(true).platform.addRecentFile(foreign)).rejects.toThrow(TypeError);
  });

  it('壊れた形のハンドルも拒む', async () => {
    const broken: FileHandle = { kind: 'web', name: 'a.uodia', ref: { mode: 'なにこれ' } };
    await expect(makeEnvironment(true).platform.addRecentFile(broken)).rejects.toThrow(TypeError);
  });
});

describe('ブラウザ API の検出', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it('showOpenFilePicker があれば File System Access API を使える', async () => {
    vi.stubGlobal('window', { showOpenFilePicker: () => Promise.resolve([]) });
    const { hasFileSystemAccess } = await import('./browser');
    expect(hasFileSystemAccess()).toBe(true);
  });

  it('無ければ使えない', async () => {
    vi.stubGlobal('window', {});
    const { hasFileSystemAccess, createFileSystemAccess } = await import('./browser');
    expect(hasFileSystemAccess()).toBe(false);
    expect(createFileSystemAccess()).toBeNull();
  });
});
