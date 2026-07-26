/**
 * インメモリ実装の検証（T-12）。
 *
 * ここで確かめているのは `PlatformAdapter` の**約束事**である。取り消しを `null`
 * で表すこと、履歴が新しい順に並ぶこと、他の環境のハンドルを拒むこと。実装が
 * 増えたときは、同じ期待を各実装に当てるところから始める。
 */

import { describe, expect, it } from 'vitest';
import { createMemoryPlatform } from './memory';
import { MAX_RECENT_FILES, type FileHandle } from './types';

const FIXED_NOW = (): Date => new Date('2026-07-26T09:00:00.000Z');

describe('openProject', () => {
  it('選ばれたファイルの内容とハンドルを返す', async () => {
    const platform = createMemoryPlatform({ files: { 'a.uodia': '{"a":1}' } });
    platform.openTarget = 'a.uodia';
    const opened = await platform.openProject();
    expect(opened?.content).toBe('{"a":1}');
    expect(opened?.handle.name).toBe('a.uodia');
  });

  it('**取り消しは例外ではなく null**（利用者が閉じるのは正常な操作）', async () => {
    const platform = createMemoryPlatform();
    expect(await platform.openProject()).toBeNull();
  });

  it('存在しないファイルは失敗として扱う', async () => {
    const platform = createMemoryPlatform();
    platform.openTarget = 'ない.uodia';
    await expect(platform.openProject()).rejects.toThrow('ファイルがありません');
  });
});

describe('saveProject / saveProjectAs', () => {
  it('ハンドルの指すファイルへ上書きする', async () => {
    const platform = createMemoryPlatform({ files: { 'a.uodia': '古い' } });
    platform.openTarget = 'a.uodia';
    const opened = await platform.openProject();
    if (opened === null) throw new Error('開けません');

    await platform.saveProject(opened.handle, '新しい');
    expect(platform.files.get('a.uodia')).toBe('新しい');
  });

  it('名前を付けて保存すると新しいファイルとハンドルができる', async () => {
    const platform = createMemoryPlatform();
    platform.saveAsTarget = 'b.uodia';
    const handle = await platform.saveProjectAs('中身', 'なまえ.uodia');
    expect(handle?.name).toBe('b.uodia');
    expect(platform.files.get('b.uodia')).toBe('中身');
  });

  it('名前を付けて保存の取り消しは null で、ファイルもできない', async () => {
    const platform = createMemoryPlatform();
    expect(await platform.saveProjectAs('中身', 'なまえ.uodia')).toBeNull();
    expect(platform.files.size).toBe(0);
  });

  it('**他の環境が作ったハンドルは拒む**（別のファイルを上書きしないため）', async () => {
    const platform = createMemoryPlatform();
    const foreign: FileHandle = { kind: 'tauri', name: 'a.uodia', ref: '/tmp/a.uodia' };
    await expect(platform.saveProject(foreign, '中身')).rejects.toThrow(TypeError);
  });
});

describe('loadNetworkDef / saveNetworkDef', () => {
  it('route.json を読める', async () => {
    const platform = createMemoryPlatform({ networkDef: '{"version":1}' });
    expect(await platform.loadNetworkDef()).toBe('{"version":1}');
  });

  it('書き戻すと次の読込に反映される', async () => {
    const platform = createMemoryPlatform({ networkDef: '古い' });
    await platform.saveNetworkDef('新しい');
    expect(await platform.loadNetworkDef()).toBe('新しい');
    expect(platform.savedNetworkDef).toBe('新しい');
  });

  it('**書き戻せない環境では失敗する**（Web 版。仕様書 §6.5.5）', async () => {
    const platform = createMemoryPlatform({ canSaveNetworkDef: false });
    expect(platform.capabilities.networkDefWritable).toBe(false);
    await expect(platform.saveNetworkDef('中身')).rejects.toThrow('書き戻せません');
  });
});

describe('バックアップ（仕様書 §6.8）', () => {
  it('書いて読める', async () => {
    const platform = createMemoryPlatform();
    await platform.writeBackup('中身');
    expect(await platform.readBackup()).toBe('中身');
  });

  it('無ければ null', async () => {
    expect(await createMemoryPlatform().readBackup()).toBeNull();
  });

  it('消せる（正常終了時に呼ぶ）', async () => {
    const platform = createMemoryPlatform();
    await platform.writeBackup('中身');
    await platform.clearBackup();
    expect(await platform.readBackup()).toBeNull();
  });
});

describe('最近使ったファイル（仕様書 §6.8）', () => {
  function handle(name: string): FileHandle {
    return { kind: 'memory', name, ref: name };
  }

  it('新しい順に並ぶ', async () => {
    const platform = createMemoryPlatform({ now: FIXED_NOW });
    await platform.addRecentFile(handle('a'));
    await platform.addRecentFile(handle('b'));
    expect((await platform.listRecentFiles()).map((r) => r.handle.name)).toEqual(['b', 'a']);
  });

  it('同じファイルを開き直すと先頭へ移り、重複しない', async () => {
    const platform = createMemoryPlatform({ now: FIXED_NOW });
    await platform.addRecentFile(handle('a'));
    await platform.addRecentFile(handle('b'));
    await platform.addRecentFile(handle('a'));
    expect((await platform.listRecentFiles()).map((r) => r.handle.name)).toEqual(['a', 'b']);
  });

  it(`${String(MAX_RECENT_FILES)} 件を超えると古いものから落ちる`, async () => {
    const platform = createMemoryPlatform({ now: FIXED_NOW });
    for (let i = 0; i < MAX_RECENT_FILES + 5; i++) {
      await platform.addRecentFile(handle(`f${String(i)}`));
    }
    const recent = await platform.listRecentFiles();
    expect(recent).toHaveLength(MAX_RECENT_FILES);
    expect(recent.at(-1)?.handle.name).toBe('f5');
  });

  it('開いた時刻を記録する', async () => {
    const platform = createMemoryPlatform({ now: FIXED_NOW });
    await platform.addRecentFile(handle('a'));
    expect((await platform.listRecentFiles())[0]?.openedAt).toBe('2026-07-26T09:00:00.000Z');
  });

  it('時刻を渡さなければ現在時刻を使う', async () => {
    const platform = createMemoryPlatform();
    await platform.addRecentFile(handle('a'));
    const openedAt = (await platform.listRecentFiles())[0]?.openedAt ?? '';
    expect(Date.parse(openedAt)).toBeGreaterThan(0);
  });

  it('一覧は複製を返す（外から書き換えられない）', async () => {
    const platform = createMemoryPlatform({ now: FIXED_NOW });
    await platform.addRecentFile(handle('a'));
    const first = await platform.listRecentFiles();
    (first as { length: number }).length = 0;
    expect(await platform.listRecentFiles()).toHaveLength(1);
  });
});
