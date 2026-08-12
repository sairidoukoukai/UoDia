/**
 * デスクトップ版実装の検証（T-13）。
 *
 * Rust 側との受け渡し（コマンド名・引数の名前・戻り値の解釈）を確かめる。
 * ここが食い違うと、型は通るのに実行時に静かに失敗する。**引数名は Rust の
 * 関数の仮引数名と一致していなければならない**ため、名前まで検査している。
 *
 * ファイル I/O そのものは Rust 側のテストが受け持つ（`src-tauri/src/atomic.rs`）。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.fn<(...args: unknown[]) => Promise<unknown>>();
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]): Promise<unknown> => invoke(...args),
}));

/** 登録された購読。Rust からのイベントを手で起こせるようにする。 */
const listeners: ((event: unknown) => void)[] = [];
const unlisten = vi.fn();
vi.mock('@tauri-apps/api/event', () => ({
  listen: (_name: string, handler: (event: unknown) => void): Promise<() => void> => {
    listeners.push(handler);
    return Promise.resolve(() => {
      unlisten();
    });
  },
}));

const { basename, createTauriPlatform, toHandle, toPath } = await import('./tauri');

beforeEach(() => {
  invoke.mockReset();
  unlisten.mockReset();
  listeners.length = 0;
});

describe('basename', () => {
  it.each([
    ['/home/a/b.uodia', 'b.uodia'],
    ['C:\\Users\\a\\b.uodia', 'b.uodia'],
    ['b.uodia', 'b.uodia'],
    ['/a/b/', ''],
  ])('%s → %s', (path, expected) => {
    expect(basename(path)).toBe(expected);
  });
});

describe('toHandle / toPath', () => {
  it('パスからハンドルを作り、取り出せる', () => {
    const handle = toHandle('/home/a/b.uodia');
    expect(handle).toEqual({ kind: 'tauri', name: 'b.uodia', ref: '/home/a/b.uodia' });
    expect(toPath(handle)).toBe('/home/a/b.uodia');
  });

  it('他の実装が作ったハンドルは解釈しない', () => {
    expect(toPath({ kind: 'web', name: 'b.uodia', ref: {} })).toBeNull();
  });

  it('ref がパスでなければ解釈しない', () => {
    expect(toPath({ kind: 'tauri', name: 'b.uodia', ref: 42 })).toBeNull();
  });
});

describe('openProject', () => {
  it('ダイアログで選ばれたファイルを読む', async () => {
    invoke.mockResolvedValueOnce('/home/a/b.uodia').mockResolvedValueOnce('{"meta":{}}');
    const opened = await createTauriPlatform().openProject();

    expect(invoke).toHaveBeenNthCalledWith(1, 'open_project_dialog');
    expect(invoke).toHaveBeenNthCalledWith(2, 'read_project_file', { path: '/home/a/b.uodia' });
    expect(opened).toEqual({
      handle: { kind: 'tauri', name: 'b.uodia', ref: '/home/a/b.uodia' },
      content: '{"meta":{}}',
    });
  });

  it('**取り消されたらファイルを読みに行かない**', async () => {
    invoke.mockResolvedValueOnce(null);
    expect(await createTauriPlatform().openProject()).toBeNull();
    expect(invoke).toHaveBeenCalledTimes(1);
  });
});

describe('saveProject / saveProjectAs', () => {
  it('ハンドルの指すパスへ保存する', async () => {
    invoke.mockResolvedValue(undefined);
    await createTauriPlatform().saveProject(toHandle('/home/a/b.uodia'), '中身');

    expect(invoke).toHaveBeenCalledWith('save_project_file', {
      path: '/home/a/b.uodia',
      content: '中身',
    });
  });

  it('他の実装のハンドルでは保存しない', async () => {
    await expect(
      createTauriPlatform().saveProject({ kind: 'web', name: 'b', ref: {} }, '中身'),
    ).rejects.toThrow(TypeError);
    expect(invoke).not.toHaveBeenCalled();
  });

  it('名前を付けて保存すると、選ばれた先へ書いてハンドルを返す', async () => {
    invoke.mockResolvedValueOnce('/home/a/c.uodia').mockResolvedValueOnce(undefined);
    const handle = await createTauriPlatform().saveProjectAs('中身', 'なまえ.uodia');

    expect(invoke).toHaveBeenNthCalledWith(1, 'save_project_dialog', {
      suggestedName: 'なまえ.uodia',
    });
    expect(invoke).toHaveBeenNthCalledWith(2, 'save_project_file', {
      path: '/home/a/c.uodia',
      content: '中身',
    });
    expect(handle?.name).toBe('c.uodia');
  });

  it('**取り消されたら書き込まない**', async () => {
    invoke.mockResolvedValueOnce(null);
    expect(await createTauriPlatform().saveProjectAs('中身', 'なまえ.uodia')).toBeNull();
    expect(invoke).toHaveBeenCalledTimes(1);
  });
});

describe('route.json', () => {
  it('読める', async () => {
    invoke.mockResolvedValue('{"version":1}');
    expect(await createTauriPlatform().loadNetworkDef()).toBe('{"version":1}');
    expect(invoke).toHaveBeenCalledWith('read_route_def');
  });

  it('デスクトップ版はすべての機能を備える', () => {
    expect(createTauriPlatform().capabilities).toEqual({
      saveInPlace: true,
      recentFiles: true,
    });
  });
});

describe('バックアップ', () => {
  it('書ける', async () => {
    invoke.mockResolvedValue(undefined);
    await createTauriPlatform().writeBackup('中身');
    expect(invoke).toHaveBeenCalledWith('write_backup', { content: '中身' });
  });

  it('読める', async () => {
    invoke.mockResolvedValue('中身');
    expect(await createTauriPlatform().readBackup()).toBe('中身');
  });

  it('無ければ null', async () => {
    invoke.mockResolvedValue(null);
    expect(await createTauriPlatform().readBackup()).toBeNull();
  });

  it('消せる', async () => {
    invoke.mockResolvedValue(undefined);
    await createTauriPlatform().clearBackup();
    expect(invoke).toHaveBeenCalledWith('clear_backup');
  });
});

describe('最近使ったファイル', () => {
  it('パスをハンドルに変換して返す', async () => {
    invoke.mockResolvedValue([{ path: '/home/a/b.uodia', openedAt: '2026-07-26T09:00:00.000Z' }]);
    const recent = await createTauriPlatform().listRecentFiles();

    expect(recent).toEqual([
      {
        handle: { kind: 'tauri', name: 'b.uodia', ref: '/home/a/b.uodia' },
        openedAt: '2026-07-26T09:00:00.000Z',
      },
    ]);
  });

  it('古い履歴ファイルが上限を超えていても切り詰める', async () => {
    invoke.mockResolvedValue(
      Array.from({ length: 20 }, (_, i) => ({ path: `/f${String(i)}`, openedAt: 't' })),
    );
    expect(await createTauriPlatform().listRecentFiles()).toHaveLength(10);
  });

  it('履歴が空でも壊れない', async () => {
    invoke.mockResolvedValue([]);
    expect(await createTauriPlatform().listRecentFiles()).toEqual([]);
  });

  it('開いた時刻を添えて追加する', async () => {
    invoke.mockResolvedValue(undefined);
    await createTauriPlatform().addRecentFile(toHandle('/home/a/b.uodia'));

    const call = invoke.mock.calls[0];
    expect(call?.[0]).toBe('add_recent_file');
    const args = call?.[1] as { path: string; openedAt: string };
    expect(args.path).toBe('/home/a/b.uodia');
    expect(Date.parse(args.openedAt)).toBeGreaterThan(0);
  });

  it('他の実装のハンドルは追加しない', async () => {
    await expect(
      createTauriPlatform().addRecentFile({ kind: 'web', name: 'b', ref: {} }),
    ).rejects.toThrow(TypeError);
    expect(invoke).not.toHaveBeenCalled();
  });
});

describe('T-17 で足した口', () => {
  it('ハンドルから読み直す', async () => {
    invoke.mockResolvedValue('中身');
    expect(await createTauriPlatform().readProject(toHandle('/a/b.uodia'))).toBe('中身');
    expect(invoke.mock.calls[0]).toEqual(['read_project_file', { path: '/a/b.uodia' }]);
  });

  it('他の実装が作ったハンドルは解釈しない', async () => {
    await expect(
      createTauriPlatform().readProject({ kind: 'web', name: 'b.uodia', ref: {} }),
    ).rejects.toThrow(TypeError);
    expect(invoke).not.toHaveBeenCalled();
  });

  it('題名を Rust 側へ渡す', async () => {
    invoke.mockResolvedValue(null);
    await createTauriPlatform().setWindowTitle('a.uodia — UoDia');
    expect(invoke.mock.calls[0]).toEqual(['set_window_title', { title: 'a.uodia — UoDia' }]);
  });

  it('**閉じてよいと答えたときだけ閉じる**', async () => {
    invoke.mockResolvedValue(null);
    createTauriPlatform().onCloseRequested({
      canCloseNow: () => false,
      confirmClose: () => Promise.resolve(true),
    });

    listeners[0]?.({});
    await vi.waitFor(() => {
      expect(invoke.mock.calls[0]).toEqual(['close_window']);
    });
  });

  it('閉じてはいけないと答えたら閉じない', async () => {
    createTauriPlatform().onCloseRequested({
      canCloseNow: () => false,
      confirmClose: () => Promise.resolve(false),
    });

    listeners[0]?.({});
    await Promise.resolve();
    expect(invoke).not.toHaveBeenCalled();
  });

  it('割り込みをやめられる', async () => {
    const stop = createTauriPlatform().onCloseRequested({
      canCloseNow: () => true,
      confirmClose: () => Promise.resolve(true),
    });
    stop();
    await vi.waitFor(() => {
      expect(unlisten).toHaveBeenCalled();
    });
  });
});
