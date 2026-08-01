/**
 * アプリケーションのルート（仕様書 §6.4、T-32）。
 *
 * 画面は**ツールバー・上下 2 分割・ステータスバー**の 3 段でできている。ここが
 * 持つのは、どこに何を置くかと、起動時の段取り（route.json の読込・バックアップ
 * からの復元・閉じる操作への割り込み）だけである。**中身の理屈は各機能が持つ。**
 *
 * サイドパネル（T-33）・検証パネル（T-34）・メニューバー（T-37）はまだ無い。
 * 3 段の間に挟まる形になるため、この構成のまま足せる。
 *
 * **起動時に書き込みを試す確認は置かない。** 以前は自動バックアップの往復で
 * 「読めるが書けない」状態を検出していたが、T-18 で本物のバックアップが同じ
 * 場所を使うようになった。確認の後始末（`clearBackup`）が、復元すべき編集
 * 内容をそのまま消してしまう。
 */

import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react';
import { loadNetworkDef } from '@/domain/network';
import { DiagramCanvas, type DiagramCursor } from '@/features/diagram';
import {
  FileDialogHost,
  createBackupService,
  createFileService,
  useFileDialogs,
  watchWindowTitle,
} from '@/features/file';
import { SplitLayout, StatusBar, Toolbar, attachShortcuts } from '@/features/shell';
import { SidePanel } from '@/features/sidebar';
import { Timetable } from '@/features/timetable';
import { usePlatform, type RecentFile } from '@/platform';
import { selectIsDirty, useAppStore } from '@/store';

type LoadState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready' }
  | { readonly status: 'failed'; readonly message: string };

export function App(): ReactElement {
  const platform = usePlatform();
  const [load, setLoad] = useState<LoadState>({ status: 'loading' });
  const [recent, setRecent] = useState<readonly RecentFile[]>([]);
  const [cursor, setCursor] = useState<DiagramCursor | null>(null);

  const { dialogs, request, respond } = useFileDialogs();
  const files = useMemo(
    () => createFileService({ platform, store: useAppStore, dialogs }),
    [platform, dialogs],
  );
  const backups = useMemo(() => createBackupService({ platform, store: useAppStore }), [platform]);

  const setNetworkDef = useAppStore((state) => state.setNetworkDef);
  const editProject = useAppStore((state) => state.editProject);
  const documentName = useAppStore((state) => state.project?.document.name ?? '');

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
        if (controller.signal.aborted) return;

        const result = loadNetworkDef(json);
        if (!result.ok) {
          setLoad({ status: 'failed', message: `${result.stage} の段階で失敗しました` });
          return;
        }
        // 索引ではなく定義を渡す。索引はセレクタが組み立てる（`selectNetwork`）。
        setNetworkDef(result.network.def);
        setLoad({ status: 'ready' });

        // 前回の編集内容が残っていれば先に尋ねる。新規作成してから尋ねると、
        // 復元しなかったときに空のプロジェクトが 2 回作られる。
        if (!(await backups.offerRecovery(dialogs))) {
          await files.newProject();
        }
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
  }, [platform, setNetworkDef, files, backups, dialogs, refreshRecent]);

  // 自動バックアップ（仕様書 §9.2）。未保存でなくなれば消える。
  useEffect(() => backups.start(), [backups]);

  // 題名を状態に追従させる（仕様書 §6.8）。
  useEffect(() => watchWindowTitle(useAppStore, platform), [platform]);

  // 最大化のショートカット（Ctrl+1 / Ctrl+2、仕様書 §6.4）。
  useEffect(() => attachShortcuts({ store: useAppStore }), []);

  // 閉じる操作に割り込む。
  useEffect(
    () =>
      platform.onCloseRequested({
        canCloseNow: () => !selectIsDirty(useAppStore.getState()),
        confirmClose: async () => {
          const ok = await files.confirmClose();
          // 正常に閉じるならバックアップは要らない。残すと、次の起動で
          // 「異常終了した」と誤って判断される。
          if (ok) await backups.discard();
          return ok;
        },
      }),
    [platform, files, backups],
  );

  /** ファイル操作を実行し、履歴を読み直す。 */
  const run = (action: () => Promise<boolean>) => (): void => {
    void action().then(refreshRecent, refreshRecent);
  };

  // 参照を変えない。変えると、ダイヤグラムが繋ぎ直しはしないまでも（`useRef`）、
  // 指を動かすたびに App ごと描き直される道ができてしまう。
  const handleCursor = useCallback((next: DiagramCursor | null) => {
    setCursor(next);
  }, []);

  const statusMessage =
    load.status === 'loading'
      ? 'route.json を読み込んでいます…'
      : load.status === 'failed'
        ? `route.json を読み込めません（${load.message}）`
        : null;

  return (
    <div className="app-shell">
      <Toolbar
        onNew={run(() => files.newProject())}
        onOpen={run(() => files.open())}
        onSave={run(() => files.save())}
        onSaveAs={run(() => files.saveAs())}
        extra={
          /*
            本来の置き場所ができるまでの仮の操作。文書名は文書情報のダイアログ
            （T-35）、最近使ったファイルはメニュー（T-37）、バックアップは
            5 分ごとに走るもの（T-18）であり、実機で確かめるためにここへ出して
            いる。
          */
          <div className="toolbar__group toolbar__group--temporary">
            <label>
              文書名{' '}
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
            </label>
            <button type="button" onClick={run(() => backups.backupNow())}>
              今すぐバックアップ
            </button>
            {recent.map((entry) => (
              <button
                key={entry.handle.name}
                type="button"
                onClick={run(() => files.openRecent(entry.handle))}
              >
                {entry.handle.name}
              </button>
            ))}
            {/*
              どの実行環境で何ができるか（§10.4）。Web 版では上書き保存が
              ダウンロードになるなど、**同じ押しボタンが違う振る舞いをする**。
              確かめる手立てが要る。
            */}
            <span className="toolbar__note">
              {platform.kind}
              {platform.capabilities.saveInPlace ? '' : '（上書き保存はダウンロード）'}
            </span>
          </div>
        }
      />

      {/*
        サイドパネルは上下 2 分割の**外**に置く。ダイヤ・パターン・運用・表示は
        どちらの画面にも同じように効くものであり（§6.4）、中に入れると
        片方を最大化したときに消える。
      */}
      <div className="app-body">
        <SidePanel />
        <SplitLayout top={<DiagramCanvas onCursor={handleCursor} />} bottom={<Timetable />} />
      </div>

      <StatusBar cursor={cursor} message={statusMessage} />

      <FileDialogHost request={request} onRespond={respond} />
    </div>
  );
}
