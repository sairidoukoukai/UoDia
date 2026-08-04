/**
 * ファイル操作（仕様書 §6.8）。
 *
 * 新規・開く・保存・名前を付けて保存・最近使ったファイル、および未保存の
 * 変更を破棄してよいかの確認をまとめる。
 *
 * ## ダイアログを注入する
 *
 * 確認も警告もエラーも、**尋ねる相手**を外から渡す（`prompts.ts`）。手順その
 * もの（未保存なら尋ね、保存を選ばれたら保存し、取り消されたら何もしない）は
 * どの画面でも同じであり、React を立ち上げずに確かめられる形にしておきたい。
 *
 * ## 取り消しと失敗を区別する
 *
 * どの操作も「行えたか」を真偽値で返す。取り消しは `false` であって例外では
 * ない。利用者がダイアログを閉じるのは正常な操作であり、呼び出し側に
 * try/catch を書かせない（仕様書 §10.4）。本当の失敗は `dialogs.showError` で
 * 伝えたうえで `false` を返す。
 */

import { createProject, loadProject, serializeProject, touchProject } from '@/domain/io';
import type { Project } from '@/domain/model';
import { formatIssues } from '@/domain/model';
import type { FileHandle, PlatformAdapter, RecentFile } from '@/platform';
import { selectIsDirty, selectNetwork, type AppStoreHook } from '@/store';
import { DISCARD_QUESTIONS, type FileDialogs } from './prompts';
import { suggestFileName } from './title';

export interface FileServiceOptions {
  readonly platform: PlatformAdapter;
  readonly store: AppStoreHook;
  readonly dialogs: FileDialogs;
  /** 新規作成時に記録するアプリの版数。 */
  readonly appVersion?: string;
  /** 現在時刻。テストを決定的にするために差し替えられる。 */
  readonly now?: () => Date;
}

export interface FileService {
  /** 新規作成。行えたら `true`。 */
  newProject(): Promise<boolean>;
  /** ファイルを選ばせて開く。 */
  open(): Promise<boolean>;
  /** 最近使ったファイルを開く。 */
  openRecent(handle: FileHandle): Promise<boolean>;
  /** 上書き保存。保存先が未定なら「名前を付けて保存」に回す。 */
  save(): Promise<boolean>;
  saveAs(): Promise<boolean>;
  /** 閉じてよいか。未保存なら確認する（仕様書 §6.8）。 */
  confirmClose(): Promise<boolean>;
  listRecent(): Promise<readonly RecentFile[]>;
}

export function createFileService(options: FileServiceOptions): FileService {
  const { platform, store, dialogs } = options;
  const now = options.now ?? ((): Date => new Date());

  /** 保存した内容を状態と履歴に反映する。 */
  function commitSaved(project: Project, handle: FileHandle | null): void {
    store.getState().markSaved(project, handle);
  }

  /**
   * 最近使ったファイルに加える。**失敗しても伝えない。**
   *
   * 履歴は次に開くときの近道でしかない。ここで失敗を投げると、保存も読込も
   * 済んでいるのに「保存できませんでした」と出ることになる。利用者から見れば
   * 嘘であり、しかも本当に保存されたのかを確かめる手立てが無い。
   */
  async function remember(handle: FileHandle): Promise<void> {
    if (!platform.capabilities.recentFiles) return;
    try {
      await platform.addRecentFile(handle);
    } catch {
      // 履歴に残らないだけで、ファイルそのものは書けている。
    }
  }

  /** 読み込んだ内容を状態に載せる。 */
  async function acceptContent(content: string, handle: FileHandle): Promise<boolean> {
    const network = selectNetwork(store.getState());
    if (network === null) {
      await dialogs.showError('ネットワーク定義が読み込まれていないため、ファイルを開けません');
      return false;
    }

    const result = loadProject(content, network);
    if (!result.ok) {
      await dialogs.showError(describeLoadFailure(result));
      return false;
    }
    // 警告は開いてから伝える。開けているのに開けなかったように見せない。
    store.getState().setProject(result.project, handle);
    await remember(handle);
    if (result.warnings.length > 0) await dialogs.showWarnings(result.warnings);
    return true;
  }

  /**
   * 続けてよいかを確かめる。未保存なら尋ね、保存を選ばれたら保存する。
   *
   * 保存に失敗したときは続けない。「保存する」を選んだ利用者にとって、保存
   * できていないまま進むのは最も避けたい結果である。
   *
   * **`question` を受け取るのは文言のためだけである**（T-58）。ここから先の
   * 手順は 4 つの入口すべてで同じであり、分岐は 1 つも増えない。
   *
   * @param question このあと何が起きるかを伝える一文（`DISCARD_QUESTIONS`）
   */
  async function ensureSaved(question: string): Promise<boolean> {
    const state = store.getState();
    if (!selectIsDirty(state)) return true;

    const choice = await dialogs.confirmDiscard(state.file.handle?.name ?? '', question);
    if (choice === 'save') return service.save();
    if (choice === 'discard') return true;
    // 想定していない答えは「やめる」として扱う。黙って保存や破棄へ倒れるより、
    // 何も起きないほうが取り返しがつく。
    return false;
  }

  /** 保存の本体。書き出したバイト列と状態の中身を一致させる。 */
  async function writeTo(handle: FileHandle | null): Promise<boolean> {
    const { project } = store.getState();
    if (project === null) return false;

    const stamped = touchProject(project, now());
    const content = serializeProject(stamped);

    try {
      if (handle === null) {
        const created = await platform.saveProjectAs(
          content,
          suggestFileName(null, project.document.name),
        );
        if (created === null) return false;
        commitSaved(stamped, created);
        await remember(created);
        return true;
      }

      await platform.saveProject(handle, content);
      commitSaved(stamped, handle);
      await remember(handle);
      return true;
    } catch (error) {
      await dialogs.showError(`保存できませんでした: ${String(error)}`);
      return false;
    }
  }

  const service: FileService = {
    async newProject(): Promise<boolean> {
      if (!(await ensureSaved(DISCARD_QUESTIONS.new))) return false;

      const network = selectNetwork(store.getState());
      if (network === null) {
        await dialogs.showError('ネットワーク定義が読み込まれていないため、新規作成できません');
        return false;
      }

      const created = createProject(network, {
        ...(options.appVersion === undefined ? {} : { appVersion: options.appVersion }),
        now: now(),
      });
      store.getState().setProject(created, null);
      return true;
    },

    async open(): Promise<boolean> {
      if (!(await ensureSaved(DISCARD_QUESTIONS.open))) return false;

      let opened;
      try {
        opened = await platform.openProject();
      } catch (error) {
        await dialogs.showError(`ファイルを開けませんでした: ${String(error)}`);
        return false;
      }
      if (opened === null) return false;

      return acceptContent(opened.content, opened.handle);
    },

    async openRecent(handle: FileHandle): Promise<boolean> {
      if (!(await ensureSaved(DISCARD_QUESTIONS.open))) return false;

      let content: string;
      try {
        content = await platform.readProject(handle);
      } catch (error) {
        await dialogs.showError(`${handle.name} を開けませんでした: ${String(error)}`);
        return false;
      }
      return acceptContent(content, handle);
    },

    save(): Promise<boolean> {
      return writeTo(store.getState().file.handle);
    },

    saveAs(): Promise<boolean> {
      return writeTo(null);
    },

    confirmClose(): Promise<boolean> {
      return ensureSaved(DISCARD_QUESTIONS.close);
    },

    async listRecent(): Promise<readonly RecentFile[]> {
      if (!platform.capabilities.recentFiles) return [];
      return platform.listRecentFiles();
    },
  };

  return service;
}

/** 読込の失敗を、利用者が次に何をすればよいか分かる文にする。 */
function describeLoadFailure(
  result: Extract<ReturnType<typeof loadProject>, { ok: false }>,
): string {
  switch (result.stage) {
    case 'json':
      return `ファイルが壊れているようです（${result.message}）`;
    case 'version':
      return result.message;
    case 'schema':
      return `ファイルの内容が想定と違います。\n${formatIssues(result.issues)}`;
  }
}
