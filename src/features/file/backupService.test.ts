/**
 * 自動バックアップと復元の検証（T-18、仕様書 §9.2）。
 *
 * 受入条件は 2 つ。
 *
 * 1. アプリを強制終了した後に起動すると復元が提案される
 * 2. 復元を拒否した場合、バックアップが破棄される
 *
 * **強制終了は「バックアップが残ったまま次が始まる」ことで表す。** 実際に
 * プロセスを殺す代わりに、書き出したバックアップをそのままに新しいストアを
 * 立ち上げる。異常終了したときに残るものは、まさにそれだけである。
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProject, parseBackup } from '@/domain/io';
import { loadNetworkDef, type NetworkIndex } from '@/domain/network';
import { createMemoryPlatform, type MemoryPlatform } from '@/platform';
import { createAppStore, selectIsDirty, type AppStoreHook } from '@/store';
import { createBackupService, DEFAULT_BACKUP_INTERVAL_MS } from './backupService';
import type { BackupDialogs } from './prompts';

const routeJsonPath = fileURLToPath(new URL('../../../data/route.json', import.meta.url));
const loaded = loadNetworkDef(readFileSync(routeJsonPath, 'utf8'));
if (!loaded.ok) throw new Error('route.json を読み込めません');
const network: NetworkIndex = loaded.network;

const NOW = new Date('2026-07-26T12:00:00.000Z');

/** 尋ねられた内容を記録し、あらかじめ決めた答えを返す口。 */
function createFakeDialogs(answer: boolean) {
  const asked: { fileName: string; savedAt: string }[] = [];
  const dialogs: BackupDialogs = {
    confirmRecover(fileName, savedAt) {
      asked.push({ fileName, savedAt });
      return Promise.resolve(answer);
    },
  };
  return { asked, dialogs };
}

let platform: MemoryPlatform;

/** ネットワーク定義まで読み込んだストアと、そこに繋いだバックアップ係。 */
function boot(store = createAppStore()) {
  store.getState().setNetworkDef(network.def);
  const backups = createBackupService({ platform, store, now: () => NOW });
  return { store, backups };
}

/** 未保存の編集を 1 つ持つ状態にする。 */
function edit(store: AppStoreHook, name: string): void {
  store.getState().setProject(createProject(network, { now: NOW }));
  store.getState().editProject('文書名の変更', (project) => {
    project.document.name = name;
  });
}

beforeEach(() => {
  platform = createMemoryPlatform();
});

describe('書き出し', () => {
  it('未保存の変更が無ければ書かない', async () => {
    const { store, backups } = boot();
    store.getState().setProject(createProject(network, { now: NOW }));

    expect(await backups.backupNow()).toBe(false);
    expect(platform.backup).toBeNull();
  });

  it('プロジェクトが無ければ書かない', async () => {
    const { backups } = boot();
    expect(await backups.backupNow()).toBe(false);
  });

  it('**未保存の変更があれば書く**', async () => {
    const { store, backups } = boot();
    edit(store, '書きかけ');

    expect(await backups.backupNow()).toBe(true);
    const parsed = parseBackup(platform.backup ?? '');
    expect(parsed.ok && parsed.envelope.savedAt).toBe(NOW.toISOString());
  });

  it('元のファイル名を添える', async () => {
    const { store, backups } = boot();
    edit(store, '書きかけ');
    const project = store.getState().project;
    if (project === null) throw new Error('プロジェクトがありません');
    store.getState().markSaved(project, { kind: 'memory', name: 'a.uodia', ref: 'a.uodia' });
    store.getState().editProject('文書名の変更', (p) => {
      p.document.name = '保存後の編集';
    });

    await backups.backupNow();
    const parsed = parseBackup(platform.backup ?? '');
    expect(parsed.ok && parsed.envelope.fileName).toBe('a.uodia');
  });

  it('保存していなければファイル名は空', async () => {
    const { store, backups } = boot();
    edit(store, '書きかけ');

    await backups.backupNow();
    const parsed = parseBackup(platform.backup ?? '');
    expect(parsed.ok && parsed.envelope.fileName).toBeNull();
  });

  it('**書けなくても編集は続けられる**', async () => {
    const brittle = {
      ...platform,
      writeBackup: (): Promise<void> => Promise.reject(new Error('書けません')),
    };
    const store = createAppStore();
    store.getState().setNetworkDef(network.def);
    const backups = createBackupService({ platform: brittle, store, now: () => NOW });
    edit(store, '書きかけ');

    expect(await backups.backupNow()).toBe(false);
  });
});

describe('定期的な書き出し', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('**既定は 5 分ごと**', async () => {
    const { store, backups } = boot();
    const stop = backups.start();
    edit(store, '書きかけ');

    expect(platform.backup).toBeNull();
    await vi.advanceTimersByTimeAsync(DEFAULT_BACKUP_INTERVAL_MS);
    expect(platform.backup).not.toBeNull();
    stop();
  });

  it('間隔を変えられる（設定欄は T-35）', async () => {
    const store = createAppStore();
    store.getState().setNetworkDef(network.def);
    const backups = createBackupService({ platform, store, intervalMs: 1000, now: () => NOW });
    const stop = backups.start();
    edit(store, '書きかけ');

    await vi.advanceTimersByTimeAsync(1000);
    expect(platform.backup).not.toBeNull();
    stop();
  });

  it('止めると書かなくなる', async () => {
    const { store, backups } = boot();
    backups.start()();
    edit(store, '書きかけ');

    await vi.advanceTimersByTimeAsync(DEFAULT_BACKUP_INTERVAL_MS * 3);
    expect(platform.backup).toBeNull();
  });

  it('**未保存でなくなったら消す**（保存・新規・開くのいずれでも）', async () => {
    const { store, backups } = boot();
    const stop = backups.start();
    edit(store, '書きかけ');
    await backups.backupNow();
    expect(platform.backup).not.toBeNull();

    const project = store.getState().project;
    if (project === null) throw new Error('プロジェクトがありません');
    store.getState().markSaved(project, null);

    await vi.waitFor(() => {
      expect(platform.backup).toBeNull();
    });
    stop();
  });

  it('未保存のままなら消さない', async () => {
    const { store, backups } = boot();
    const stop = backups.start();
    edit(store, '書きかけ');
    await backups.backupNow();

    store.getState().editProject('文書名の変更', (project) => {
      project.document.name = 'まだ書きかけ';
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(platform.backup).not.toBeNull();
    stop();
  });

  it('消せなくても編集は続けられる', () => {
    const brittle = {
      ...platform,
      clearBackup: (): Promise<void> => Promise.reject(new Error('消せません')),
    };
    const store = createAppStore();
    store.getState().setNetworkDef(network.def);
    const backups = createBackupService({ platform: brittle, store, now: () => NOW });
    const stop = backups.start();

    edit(store, '書きかけ');
    const project = store.getState().project;
    if (project === null) throw new Error('プロジェクトがありません');
    expect(() => {
      store.getState().markSaved(project, null);
    }).not.toThrow();
    stop();
  });
});

describe('復元の提案（受入条件）', () => {
  /** 前回の起動で編集し、保存せずに落ちた状態を作る。 */
  async function crashWith(name: string, fileName: string | null = null): Promise<void> {
    const { store, backups } = boot();
    edit(store, name);
    if (fileName !== null) {
      const project = store.getState().project;
      if (project === null) throw new Error('プロジェクトがありません');
      store.getState().markSaved(project, { kind: 'memory', name: fileName, ref: fileName });
      // 保存した後にもう一度書き換える。同じ値では変化が無く、未保存に
      // ならない（`execute` は内容が変わったときだけ履歴に載せる）。
      store.getState().editProject('文書名の変更', (p) => {
        p.document.name = `${name}（保存後）`;
      });
    }
    await backups.backupNow();
    // ここでプロセスが落ちたとみなす。バックアップだけが残る。
  }

  it('**強制終了の後に起動すると復元が提案される**', async () => {
    await crashWith('落ちる前の編集');

    const { store, backups } = boot();
    const fake = createFakeDialogs(true);
    expect(await backups.offerRecovery(fake.dialogs)).toBe(true);
    expect(fake.asked).toHaveLength(1);
    expect(store.getState().project?.document.name).toBe('落ちる前の編集');
  });

  it('元のファイル名と時刻を添えて尋ねる', async () => {
    await crashWith('落ちる前の編集', 'a.uodia');

    const { backups } = boot();
    const fake = createFakeDialogs(false);
    await backups.offerRecovery(fake.dialogs);
    expect(fake.asked[0]).toEqual({ fileName: 'a.uodia', savedAt: NOW.toISOString() });
  });

  it('**復元した内容は未保存として扱う**（そのまま閉じて失わせない）', async () => {
    await crashWith('落ちる前の編集');

    const { store, backups } = boot();
    await backups.offerRecovery(createFakeDialogs(true).dialogs);

    expect(selectIsDirty(store.getState())).toBe(true);
    expect(store.getState().file.handle).toBeNull();
  });

  it('復元しても取り消せる履歴は持ち越さない', async () => {
    await crashWith('落ちる前の編集');

    const { store, backups } = boot();
    await backups.offerRecovery(createFakeDialogs(true).dialogs);
    expect(store.getState().undo()).toBe(false);
  });

  it('**復元を断るとバックアップを捨てる**', async () => {
    await crashWith('落ちる前の編集');

    const { backups } = boot();
    expect(await backups.offerRecovery(createFakeDialogs(false).dialogs)).toBe(false);
    expect(platform.backup).toBeNull();
  });

  it('正常に終わった後の起動では尋ねない', async () => {
    const { backups } = boot();
    const fake = createFakeDialogs(true);

    expect(await backups.offerRecovery(fake.dialogs)).toBe(false);
    expect(fake.asked).toEqual([]);
  });

  it('読めないバックアップは尋ねずに捨てる', async () => {
    platform.backup = '{ 壊れている';

    const { backups } = boot();
    const fake = createFakeDialogs(true);
    expect(await backups.offerRecovery(fake.dialogs)).toBe(false);
    expect(fake.asked).toEqual([]);
    expect(platform.backup).toBeNull();
  });

  it('中身がプロジェクトとして読めなければ捨てる', async () => {
    platform.backup = JSON.stringify({
      format: 'uodia-backup',
      savedAt: NOW.toISOString(),
      fileName: null,
      project: { でたらめ: true },
    });

    const { backups } = boot();
    expect(await backups.offerRecovery(createFakeDialogs(true).dialogs)).toBe(false);
    expect(platform.backup).toBeNull();
  });

  it('ネットワーク定義が読めていなければ復元しない', async () => {
    await crashWith('落ちる前の編集');

    const store = createAppStore();
    const backups = createBackupService({ platform, store, now: () => NOW });
    expect(await backups.findRecoverable()).toBeNull();
  });

  it('バックアップを読めなくても起動は止めない', async () => {
    const brittle = {
      ...platform,
      readBackup: (): Promise<string | null> => Promise.reject(new Error('読めません')),
    };
    const store = createAppStore();
    store.getState().setNetworkDef(network.def);
    const backups = createBackupService({ platform: brittle, store, now: () => NOW });

    expect(await backups.findRecoverable()).toBeNull();
  });

  it('閉じるときに捨てられる', async () => {
    await crashWith('落ちる前の編集');
    const { backups } = boot();

    await backups.discard();
    expect(platform.backup).toBeNull();
  });
});
