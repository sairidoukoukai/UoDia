/**
 * ファイル操作の検証（T-17、仕様書 §6.8）。
 *
 * 受入条件は 2 つ。
 *
 * 1. 未保存の変更がある状態で閉じようとすると確認が出る
 * 2. 保存後に未保存フラグが解除され、題名の `[*]` が消える
 *
 * ダイアログは口を差し替えて確かめる。**何を尋ねたか**と**どう答えたときに
 * どうなるか**が要点であり、見た目は関わらない。
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import { serializeProject, type ProjectWarning } from '@/domain/io';
import { loadNetworkDef, type NetworkIndex } from '@/domain/network';
import { createMemoryPlatform, type MemoryPlatform } from '@/platform';
import { createAppStore, selectIsDirty, type AppStoreHook } from '@/store';
import { createFileService, type FileService } from './fileService';
import { DISCARD_QUESTIONS, type DialogAnswer, type DiscardQuestion } from './prompts';
import { windowTitleOf } from './windowTitle';

const routeJsonPath = fileURLToPath(new URL('../../../data/route.json', import.meta.url));
const routeJson = readFileSync(routeJsonPath, 'utf8');
const loaded = loadNetworkDef(routeJson);
if (!loaded.ok) throw new Error('route.json を読み込めません');
const network: NetworkIndex = loaded.network;

/** 尋ねられた内容を記録し、あらかじめ決めた答えを返す口。 */
function createFakeDialogs() {
  const record = {
    /** 破棄してよいか尋ねられた回数と、そのときのファイル名。 */
    discardAsks: [] as string[],
    /** そのとき出した本文（T-58）。**入口ごとに違う。** */
    discardQuestions: [] as DiscardQuestion[],
    warnings: [] as (readonly ProjectWarning[])[],
    errors: [] as string[],
    /** 次に返す答え。 */
    answer: 'cancel' as DialogAnswer,
  };

  return {
    record,
    dialogs: {
      confirmDiscard(fileName: string, question: DiscardQuestion): Promise<DialogAnswer> {
        record.discardAsks.push(fileName);
        record.discardQuestions.push(question);
        return Promise.resolve(record.answer);
      },
      showWarnings(warnings: readonly ProjectWarning[]): Promise<void> {
        record.warnings.push(warnings);
        return Promise.resolve();
      },
      showError(message: string): Promise<void> {
        record.errors.push(message);
        return Promise.resolve();
      },
    },
  };
}

let store: AppStoreHook;
let platform: MemoryPlatform;
let files: FileService;
let fake: ReturnType<typeof createFakeDialogs>;

/** 新規プロジェクトを 1 つ作った直後の状態にする。 */
async function startFresh(): Promise<void> {
  await files.newProject();
}

/** 未保存の変更を 1 つ作る。 */
function edit(name = '編集'): void {
  store.getState().editProject('文書名の変更', (project) => {
    project.document.name = name;
  });
}

beforeEach(() => {
  store = createAppStore();
  store.getState().setNetworkDef(network.def);
  platform = createMemoryPlatform({ networkDef: routeJson });
  fake = createFakeDialogs();
  files = createFileService({
    platform,
    store,
    dialogs: fake.dialogs,
    appVersion: '1.0.0',
    now: () => new Date('2026-07-26T12:00:00.000Z'),
  });
});

describe('新規作成', () => {
  it('空のプロジェクトを作る', async () => {
    expect(await files.newProject()).toBe(true);
    expect(store.getState().project?.services).toHaveLength(1);
    expect(store.getState().file.handle).toBeNull();
  });

  it('作った直後は保存済みとして扱う', async () => {
    await files.newProject();
    expect(selectIsDirty(store.getState())).toBe(false);
    expect(windowTitleOf(store.getState())).toBe('無題 — UoDia');
  });

  it('ネットワーク定義が無ければ作れない', async () => {
    const empty = createAppStore();
    const service = createFileService({ platform, store: empty, dialogs: fake.dialogs });
    expect(await service.newProject()).toBe(false);
    expect(fake.record.errors[0]).toContain('ネットワーク定義');
  });
});

describe('保存（受入条件）', () => {
  beforeEach(startFresh);

  it('保存先が未定なら「名前を付けて保存」に回す', async () => {
    platform.saveAsTarget = '2026年度.uodia';
    expect(await files.save()).toBe(true);
    expect([...platform.files.keys()]).toEqual(['2026年度.uodia']);
  });

  it('**保存すると未保存が解け、題名から `[*]` が消える**', async () => {
    edit();
    expect(selectIsDirty(store.getState())).toBe(true);
    expect(windowTitleOf(store.getState())).toBe('無題 [*] — UoDia');

    platform.saveAsTarget = '2026年度.uodia';
    await files.save();

    expect(selectIsDirty(store.getState())).toBe(false);
    expect(windowTitleOf(store.getState())).toBe('2026年度.uodia — UoDia');
  });

  it('2 回目からは同じ場所へ上書きする', async () => {
    platform.saveAsTarget = 'a.uodia';
    await files.save();
    platform.saveAsTarget = null; // ダイアログが出れば取り消しになる

    edit('2回目');
    expect(await files.save()).toBe(true);
    expect(platform.files.get('a.uodia')).toContain('2回目');
  });

  it('書き出した内容と状態の中身が一致する（保存直後に未保存にならない）', async () => {
    platform.saveAsTarget = 'a.uodia';
    await files.save();

    const saved = store.getState().project;
    if (saved === null) throw new Error('プロジェクトがありません');
    expect(platform.files.get('a.uodia')).toBe(serializeProject(saved));
  });

  it('保存時刻を打ち直す', async () => {
    platform.saveAsTarget = 'a.uodia';
    await files.save();
    expect(store.getState().project?.meta.updatedAt).toBe('2026-07-26T12:00:00.000Z');
  });

  it('**保存しても取り消しはできる**（保存は編集ではない）', async () => {
    edit('あ');
    platform.saveAsTarget = 'a.uodia';
    await files.save();

    expect(store.getState().undo()).toBe(true);
    expect(store.getState().project?.document.name).toBe('');
  });

  it('取り消されたら保存しない', async () => {
    platform.saveAsTarget = null;
    expect(await files.saveAs()).toBe(false);
    expect(platform.files.size).toBe(0);
    expect(fake.record.errors).toEqual([]);
  });

  it('保存に失敗したら伝える', async () => {
    platform.saveAsTarget = 'a.uodia';
    await files.save();
    // 別の環境のハンドルを掴ませて失敗させる。
    store.getState().markSaved(store.getState().project ?? never(), {
      kind: 'よその実装',
      name: 'a.uodia',
      ref: 'a.uodia',
    });
    edit();

    expect(await files.save()).toBe(false);
    expect(fake.record.errors[0]).toContain('保存できませんでした');
  });

  it('プロジェクトが無ければ何もしない', async () => {
    store.getState().setProject(null);
    expect(await files.save()).toBe(false);
  });

  it('**履歴に残せなくても保存は成功として扱う**', async () => {
    const brittle = {
      ...platform,
      addRecentFile: (): Promise<void> => Promise.reject(new Error('履歴を書けません')),
    };
    const service = createFileService({ platform: brittle, store, dialogs: fake.dialogs });
    platform.saveAsTarget = 'a.uodia';

    expect(await service.save()).toBe(true);
    expect(fake.record.errors).toEqual([]);
    expect(selectIsDirty(store.getState())).toBe(false);
  });

  it('保存したファイルを履歴に残す', async () => {
    platform.saveAsTarget = 'a.uodia';
    await files.save();
    expect((await files.listRecent()).map((r) => r.handle.name)).toEqual(['a.uodia']);
  });
});

describe('開く', () => {
  beforeEach(startFresh);

  /** 保存済みのファイルを 1 つ用意する。 */
  async function makeSavedFile(name: string, documentName: string): Promise<void> {
    edit(documentName);
    platform.saveAsTarget = name;
    await files.save();
    await files.newProject();
  }

  it('選んだファイルを開く', async () => {
    await makeSavedFile('a.uodia', '既存の文書');
    platform.openTarget = 'a.uodia';

    expect(await files.open()).toBe(true);
    expect(store.getState().project?.document.name).toBe('既存の文書');
    expect(store.getState().file.handle?.name).toBe('a.uodia');
  });

  it('開いた直後は保存済みとして扱う', async () => {
    await makeSavedFile('a.uodia', '既存の文書');
    platform.openTarget = 'a.uodia';
    await files.open();
    expect(selectIsDirty(store.getState())).toBe(false);
  });

  it('開くと履歴が消える（別の文書の取り消しを持ち越さない）', async () => {
    await makeSavedFile('a.uodia', '既存の文書');
    platform.openTarget = 'a.uodia';
    await files.open();
    expect(store.getState().undo()).toBe(false);
  });

  it('履歴に残せなくても開けたことにする', async () => {
    await makeSavedFile('a.uodia', '既存の文書');
    const brittle = {
      ...platform,
      addRecentFile: (): Promise<void> => Promise.reject(new Error('履歴を書けません')),
    };
    const service = createFileService({ platform: brittle, store, dialogs: fake.dialogs });
    platform.openTarget = 'a.uodia';

    expect(await service.open()).toBe(true);
    expect(fake.record.errors).toEqual([]);
  });

  it('取り消されたら何もしない', async () => {
    platform.openTarget = null;
    expect(await files.open()).toBe(false);
    expect(fake.record.errors).toEqual([]);
  });

  it('壊れたファイルは開かず、何が起きたか伝える', async () => {
    platform.files.set('壊れた.uodia', '{ これは JSON ではない');
    platform.openTarget = '壊れた.uodia';

    expect(await files.open()).toBe(false);
    expect(fake.record.errors[0]).toContain('壊れている');
  });

  it('UoDia のファイルでなければ版数の段階で断る', async () => {
    platform.files.set('よそ.uodia', '{"hello":"world"}');
    platform.openTarget = 'よそ.uodia';

    expect(await files.open()).toBe(false);
    expect(fake.record.errors[0]).toContain('formatVersion');
  });

  it('形が違えばどこが違うかを示す', async () => {
    platform.files.set('変.uodia', JSON.stringify({ meta: { formatVersion: 1 } }));
    platform.openTarget = '変.uodia';

    expect(await files.open()).toBe(false);
    expect(fake.record.errors[0]).toContain('想定と違います');
  });

  it('読み出しに失敗したら伝える', async () => {
    platform.openTarget = '無い.uodia';
    expect(await files.open()).toBe(false);
    expect(fake.record.errors[0]).toContain('開けませんでした');
  });

  it('ネットワーク定義が無ければ開けない', async () => {
    await makeSavedFile('a.uodia', '既存の文書');
    const empty = createAppStore();
    const service = createFileService({ platform, store: empty, dialogs: fake.dialogs });
    platform.openTarget = 'a.uodia';

    expect(await service.open()).toBe(false);
    expect(fake.record.errors.at(-1)).toContain('ネットワーク定義');
  });

  it('**route.json の版数が違えば警告する**（W-01）', async () => {
    await makeSavedFile('a.uodia', '既存の文書');
    // 版数だけを上げた定義に差し替える。**食い違っていることだけが要る。**
    store.getState().editNetwork('版数の更新', (def) => {
      def.version += 1;
    });
    platform.openTarget = 'a.uodia';

    expect(await files.open()).toBe(true);
    expect(fake.record.warnings[0]?.map((w) => w.id)).toContain('W-01');
  });

  it('警告があっても開く（開けなかったように見せない）', async () => {
    await makeSavedFile('a.uodia', '既存の文書');
    store.getState().editNetwork('版数の更新', (def) => {
      def.version = 2;
    });
    platform.openTarget = 'a.uodia';

    await files.open();
    expect(store.getState().project?.document.name).toBe('既存の文書');
  });
});

describe('最近使ったファイル', () => {
  beforeEach(startFresh);

  it('開いたファイルを履歴に残す', async () => {
    platform.saveAsTarget = 'a.uodia';
    await files.save();
    await files.newProject();
    platform.openTarget = 'a.uodia';
    await files.open();

    expect((await files.listRecent()).map((r) => r.handle.name)).toEqual(['a.uodia']);
  });

  it('履歴から開ける', async () => {
    edit('履歴から開く文書');
    platform.saveAsTarget = 'a.uodia';
    await files.save();
    await files.newProject();

    const [entry] = await files.listRecent();
    if (entry === undefined) throw new Error('履歴がありません');
    expect(await files.openRecent(entry.handle)).toBe(true);
    expect(store.getState().project?.document.name).toBe('履歴から開く文書');
  });

  it('消えたファイルを開こうとしたら伝える', async () => {
    expect(await files.openRecent({ kind: 'memory', name: '無い.uodia', ref: '無い.uodia' })).toBe(
      false,
    );
    expect(fake.record.errors[0]).toContain('開けませんでした');
  });

  it('履歴を持てない環境では空を返す', async () => {
    const limited = { ...platform, capabilities: { ...platform.capabilities, recentFiles: false } };
    const service = createFileService({ platform: limited, store, dialogs: fake.dialogs });
    platform.saveAsTarget = 'a.uodia';
    await service.save();

    expect(await service.listRecent()).toEqual([]);
  });
});

describe('未保存の確認（受入条件）', () => {
  beforeEach(startFresh);

  it('変更が無ければ尋ねずに続ける', async () => {
    expect(await files.confirmClose()).toBe(true);
    expect(fake.record.discardAsks).toEqual([]);
  });

  it('**未保存の変更があれば尋ねる**', async () => {
    edit();
    fake.record.answer = 'discard';

    expect(await files.confirmClose()).toBe(true);
    expect(fake.record.discardAsks).toHaveLength(1);
  });

  it('「やめる」を選べば閉じない', async () => {
    edit();
    fake.record.answer = 'cancel';
    expect(await files.confirmClose()).toBe(false);
  });

  it('「保存して続ける」を選べば保存してから続ける', async () => {
    edit('保存してから閉じる');
    fake.record.answer = 'save';
    platform.saveAsTarget = 'a.uodia';

    expect(await files.confirmClose()).toBe(true);
    expect(platform.files.get('a.uodia')).toContain('保存してから閉じる');
    expect(selectIsDirty(store.getState())).toBe(false);
  });

  it('**保存に失敗したら続けない**', async () => {
    edit();
    fake.record.answer = 'save';
    platform.saveAsTarget = null; // 保存先を選ばずに取り消す

    expect(await files.confirmClose()).toBe(false);
    expect(selectIsDirty(store.getState())).toBe(true);
  });

  it('新規作成の前にも尋ねる', async () => {
    edit();
    fake.record.answer = 'cancel';

    expect(await files.newProject()).toBe(false);
    expect(store.getState().project?.document.name).toBe('編集');
  });

  it('開く前にも尋ねる', async () => {
    edit();
    fake.record.answer = 'cancel';
    platform.openTarget = 'a.uodia';

    expect(await files.open()).toBe(false);
    expect(fake.record.discardAsks).toHaveLength(1);
  });

  it('履歴から開く前にも尋ねる', async () => {
    edit();
    fake.record.answer = 'cancel';

    expect(await files.openRecent({ kind: 'memory', name: 'a.uodia', ref: 'a.uodia' })).toBe(false);
    expect(fake.record.discardAsks).toHaveLength(1);
  });

  it('保存先の名前を添えて尋ねる', async () => {
    platform.saveAsTarget = 'a.uodia';
    await files.save();
    edit();
    fake.record.answer = 'discard';

    await files.confirmClose();
    expect(fake.record.discardAsks).toEqual(['a.uodia']);
  });

  /*
   * **本文がこのあと起きることを言う**（T-58、仕様書 v1.1 §3.3）。
   *
   * 選択肢は 4 つの入口すべてで同じ（「保存する」「保存しない」「キャンセル」）で
   * あり、**このあと何が起きるかは本文だけが言う。** 入口と本文の対応が崩れると、
   * 「開く」を押して「終了しますか」と出る類の嘘になる。
   */
  it.each([
    ['終了', () => files.confirmClose(), DISCARD_QUESTIONS.close],
    ['新規作成', () => files.newProject(), DISCARD_QUESTIONS.new],
    ['開く', () => files.open(), DISCARD_QUESTIONS.open],
    [
      '最近使ったファイル',
      () => files.openRecent({ kind: 'memory', name: 'a.uodia', ref: 'a.uodia' }),
      // 利用者から見て起きることが同じであるため、「開く」と言い方を分けない。
      DISCARD_QUESTIONS.open,
    ],
  ] as const)('%s から尋ねたときの本文', async (_name, run, question) => {
    edit();
    fake.record.answer = 'cancel';

    await run();
    expect(fake.record.discardQuestions).toEqual([question]);
  });

  it('**決めた 3 つ以外の本文は渡せない**', () => {
    /*
     * 型で止める。`string` のままだと、入口と文言の対応がずれても誰も止めない
     * ——「開く」から「終了しますか」を渡す類であり、**#168 が直そうとしたのと
     * 同じ種類の間違いである。** 上の it.each は入れ替わりを見つけるが、
     * 見つけるのと**起こせないようにするのは違う。**
     *
     * @ts-expect-error は誤りが消えたときに落ちる。`DiscardQuestion` が
     * `string` へ広がったら、このテストが気づく。
     */
    // @ts-expect-error 決めていない文言は渡せない
    const invalid: DiscardQuestion = '保存しますか。';
    expect(invalid).toBe('保存しますか。');
  });
});

/** 到達しない分岐でテストを止めるための補助。 */
function never(): never {
  throw new Error('プロジェクトがありません');
}
