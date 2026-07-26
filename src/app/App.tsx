/**
 * アプリケーションのルート。
 *
 * 実際のレイアウト（上=ダイヤグラム／下=時刻表）は T-32 で実装する。それまでは、
 * **ここまでの層が実際に繋がっていること**を画面で確かめられる状態にしておく。
 * `route.json` の読込・書き込みの往復・ストアへの反映・セレクタによる導出・
 * ファイル操作がすべて通っていれば、この画面が出る。
 */

import { useEffect, useMemo, useState } from 'react';
import { loadNetworkDef } from '@/domain/network';
import {
  FileDialogHost,
  createFileService,
  useFileDialogs,
  watchWindowTitle,
  windowTitleOf,
} from '@/features/file';
import { usePlatform, type PlatformAdapter, type RecentFile } from '@/platform';
import {
  selectBlocks,
  selectCanRedo,
  selectCanUndo,
  selectIsDirty,
  selectValidation,
  selectVisibleStops,
  useAppStore,
} from '@/store';

type LoadState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready' }
  | { readonly status: 'failed'; readonly message: string };

/**
 * 書き込みが通っているかを、自動バックアップの往復で確かめる。
 *
 * 読込だけでは「読めるが書けない」状態を見逃す。バックアップの書き込みは
 * どのみち 5 分ごとに行う操作であり（仕様書 §6.8）、ここで 1 往復しても
 * 余計な副作用にはならない。**痕跡を残さないよう最後に消す。**
 */
async function checkWritable(platform: PlatformAdapter): Promise<boolean> {
  const probe = `書き込み確認 ${new Date().toISOString()}`;
  await platform.writeBackup(probe);
  const readBack = await platform.readBackup();
  await platform.clearBackup();
  return readBack === probe;
}

export function App() {
  const platform = usePlatform();
  const [load, setLoad] = useState<LoadState>({ status: 'loading' });
  const [writable, setWritable] = useState<boolean | null>(null);
  const [recent, setRecent] = useState<readonly RecentFile[]>([]);

  const { dialogs, request, respond } = useFileDialogs();
  const files = useMemo(
    () => createFileService({ platform, store: useAppStore, dialogs }),
    [platform, dialogs],
  );

  const setNetworkDef = useAppStore((state) => state.setNetworkDef);
  const editProject = useAppStore((state) => state.editProject);
  const undo = useAppStore((state) => state.undo);
  const redo = useAppStore((state) => state.redo);
  const stops = useAppStore(selectVisibleStops);
  const blocks = useAppStore(selectBlocks);
  const issues = useAppStore(selectValidation);
  const documentName = useAppStore((state) => state.project?.document.name ?? '');
  const canUndo = useAppStore(selectCanUndo);
  const canRedo = useAppStore(selectCanRedo);
  const dirty = useAppStore(selectIsDirty);
  const title = useAppStore(windowTitleOf);

  /** 履歴を読み直す。ファイル操作のあとに呼ぶ。 */
  const refreshRecent = useMemo(
    () => () => {
      void files.listRecent().then(setRecent, () => {
        setRecent([]);
      });
    },
    [files],
  );

  useEffect(() => {
    // 待ち合わせをすべて済ませてから一度だけ確認する。await のたびに
    // 確認すると、型検査が「2 回目以降は常に false」と判断してしまう。
    const controller = new AbortController();

    void (async () => {
      try {
        const json = await platform.loadNetworkDef();
        const isWritable = await checkWritable(platform);
        if (controller.signal.aborted) return;

        setWritable(isWritable);
        const result = loadNetworkDef(json);
        if (!result.ok) {
          setLoad({ status: 'failed', message: `${result.stage} の段階で失敗しました` });
          return;
        }
        // 索引ではなく定義を渡す。索引はセレクタが組み立てる（`selectNetwork`）。
        setNetworkDef(result.network.def);
        await files.newProject();
        setLoad({ status: 'ready' });
        refreshRecent();
      } catch (error) {
        if (!controller.signal.aborted) {
          setLoad({ status: 'failed', message: String(error) });
        }
      }
    })();

    return () => {
      controller.abort();
    };
  }, [platform, setNetworkDef, files, refreshRecent]);

  // 題名を状態に追従させる（仕様書 §6.8）。
  useEffect(() => watchWindowTitle(useAppStore, platform), [platform]);

  // 閉じる操作に割り込む。
  useEffect(
    () =>
      platform.onCloseRequested({
        canCloseNow: () => !selectIsDirty(useAppStore.getState()),
        confirmClose: () => files.confirmClose(),
      }),
    [platform, files],
  );

  /** ファイル操作を実行し、履歴を読み直す。 */
  const run = (action: () => Promise<boolean>) => (): void => {
    void action().then(refreshRecent, refreshRecent);
  };

  return (
    <div className="app-shell">
      <h1>UoDia</h1>
      <p>大阪大学 学内連絡バス ダイヤグラム設計ソフトウェア</p>
      <p className="app-shell__note">
        実行環境: {platform.kind}
        {' ／ '}
        {load.status === 'loading' && 'route.json を読み込んでいます…'}
        {load.status === 'ready' &&
          `停留所 ${String(stops.length)} 件・運用 ${String(blocks?.blocks.length ?? 0)} 件・指摘 ${String(issues.length)} 件`}
        {load.status === 'failed' && `route.json を読み込めません（${load.message}）`}
      </p>
      <p className="app-shell__note">
        書き込み: {writable === null ? '確認中…' : writable ? '正常' : '失敗'}
      </p>
      <p className="app-shell__note">
        上書き保存: {platform.capabilities.saveInPlace ? '可' : '不可（ダウンロード）'}
        {' ／ '}
        履歴: {platform.capabilities.recentFiles ? '可' : '不可'}
        {' ／ '}
        route.json の書き戻し: {platform.capabilities.networkDefWritable ? '可' : '不可'}
      </p>

      {/*
        T-17 を実機で確かめるための仮の操作列。メニューバーとショートカットは
        T-37、本来のレイアウトは T-32 で置き換える。
      */}
      <p className="app-shell__note">
        題名: {title}
        {' ／ '}
        状態: {dirty ? '未保存' : '保存済み'}
      </p>
      <p className="app-shell__note">
        <button type="button" onClick={run(() => files.newProject())}>
          新規
        </button>{' '}
        <button type="button" onClick={run(() => files.open())}>
          開く
        </button>{' '}
        <button type="button" onClick={run(() => files.save())}>
          上書き保存
        </button>{' '}
        <button type="button" onClick={run(() => files.saveAs())}>
          名前を付けて保存
        </button>
      </p>
      <p className="app-shell__note">
        最近使ったファイル:{' '}
        {recent.length === 0
          ? 'なし'
          : recent.map((entry) => (
              <button
                key={entry.handle.name}
                type="button"
                onClick={run(() => files.openRecent(entry.handle))}
              >
                {entry.handle.name}
              </button>
            ))}
      </p>

      {/*
        Undo/Redo（T-16）を実機で確かめるための仮の入力欄。文書名を打ち替えると
        1 文字ずつ履歴に積まれるが、mergeKey が同じため **1 回の取り消しで
        まとめて戻る**。
      */}
      <p className="app-shell__note">
        <label>
          文書名:{' '}
          <input
            value={documentName}
            onChange={(event) => {
              const name = event.target.value;
              editProject(
                '文書名の変更',
                (project) => {
                  project.document.name = name;
                },
                'document.name',
              );
            }}
          />
        </label>{' '}
        <button
          type="button"
          disabled={!canUndo}
          onClick={() => {
            undo();
          }}
        >
          元に戻す
        </button>{' '}
        <button
          type="button"
          disabled={!canRedo}
          onClick={() => {
            redo();
          }}
        >
          やり直す
        </button>
      </p>
      <p className="app-shell__note">UI は T-19 以降で実装します。</p>

      <FileDialogHost request={request} onRespond={respond} />
    </div>
  );
}
