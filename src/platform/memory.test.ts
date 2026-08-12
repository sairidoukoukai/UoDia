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

describe('saveExport（T-74）', () => {
  const ZIP = new Uint8Array([0x50, 0x4b, 0x05, 0x06]);

  it('名前とバイト列を覚える', async () => {
    const platform = createMemoryPlatform();

    expect(await platform.saveExport(ZIP, 'a.zip')).toBe(true);
    expect(platform.exports.get('a.zip')).toEqual(ZIP);
  });

  it('**取り消されたら何も残らない**', async () => {
    const platform = createMemoryPlatform();
    platform.exportAccepted = false;

    expect(await platform.saveExport(ZIP, 'a.zip')).toBe(false);
    expect(platform.exports.size).toBe(0);
  });
});

describe('loadNetworkDef / saveNetworkDef', () => {
  it('route.json を読める', async () => {
    const platform = createMemoryPlatform({ networkDef: '{"version":1}' });
    expect(await platform.loadNetworkDef()).toBe('{"version":1}');
  });

  /*
    書き戻しの検証は落とした（T-92、#235）。**口そのものが無くなった**——路線は
    文書の中にあり、`loadNetworkDef` が返すのは新しい文書を始めるための種である。
  */
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

describe('T-17 で足した口', () => {
  function handle(name: string): FileHandle {
    return { kind: 'memory', name, ref: name };
  }

  it('ハンドルから読み直せる', async () => {
    const platform = createMemoryPlatform({ files: { 'a.uodia': '中身' } });
    expect(await platform.readProject(handle('a.uodia'))).toBe('中身');
  });

  it('無いファイルは読めない', async () => {
    const platform = createMemoryPlatform();
    await expect(platform.readProject(handle('無い'))).rejects.toThrow('ファイルがありません');
  });

  it('他の実装が作ったハンドルは解釈しない', async () => {
    const platform = createMemoryPlatform();
    await expect(platform.readProject({ kind: 'web', name: 'a', ref: {} })).rejects.toThrow(
      TypeError,
    );
  });

  it('題名を記録する', async () => {
    const platform = createMemoryPlatform();
    await platform.setWindowTitle('a.uodia — UoDia');
    expect(platform.windowTitle).toBe('a.uodia — UoDia');
  });

  it('閉じる操作への割り込みを覚え、やめれば外れる', () => {
    const platform = createMemoryPlatform();
    const handler = { canCloseNow: () => true, confirmClose: () => Promise.resolve(true) };

    const stop = platform.onCloseRequested(handler);
    expect(platform.closeHandler).toBe(handler);
    stop();
    expect(platform.closeHandler).toBeNull();
  });
});
