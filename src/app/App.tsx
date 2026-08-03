/**
 * アプリケーションのルート（仕様書 §6.4、T-32）。
 *
 * 画面は**ツールバー・上下 2 分割・ステータスバー**の 3 段でできている。ここが
 * 持つのは、どこに何を置くかと、起動時の段取り（route.json の読込・バックアップ
 * からの復元・閉じる操作への割り込み）だけである。**中身の理屈は各機能が持つ。**
 *
 * ## 操作の入口は 1 つの表から作る（T-37）
 *
 * メニューに並ぶものも、ショートカットで走るものも、`features/shell/commands.ts`
 * の表を読む。ここがするのは**その表の各項目に「何をするか」を結び付ける**こと
 * だけである——動きを知っているのはここ（ファイル操作・ストア・ダイアログを
 * 束ねている場所）であり、表はデータのままにしておく。
 *
 * **起動時に書き込みを試す確認は置かない。** 以前は自動バックアップの往復で
 * 「読めるが書けない」状態を検出していたが、T-18 で本物のバックアップが同じ
 * 場所を使うようになった。確認の後始末（`clearBackup`）が、復元すべき編集
 * 内容をそのまま消してしまう。
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactElement,
} from 'react';
import { DiagramCanvas, type DiagramCursor } from '@/features/diagram';
import { loadNetworkDef } from '@/domain/network';
import {
  FileDialogHost,
  createBackupService,
  createFileService,
  useFileDialogs,
  watchWindowTitle,
} from '@/features/file';
import {
  BrowserNotice,
  HelpDialog,
  MenuBar,
  SplitLayout,
  StatusBar,
  DocumentDialog,
  attachShortcuts,
  togglePane,
  type CommandActions,
  type HelpTopic,
  type MenuExtra,
} from '@/features/shell';
import {
  SettingsDialog,
  applyTheme,
  attachUnlock,
  loadSettings,
  watchSettings,
} from '@/features/settings';
import { SidePanel } from '@/features/sidebar';
import { Timetable, copySelection, cutSelection, pasteClipboard } from '@/features/timetable';
import { ValidationPanel } from '@/features/validation';
import { usePlatform, type RecentFile } from '@/platform';
import { selectCanRedo, selectCanUndo, selectIsDirty, useAppStore } from '@/store';

type LoadState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready' }
  | { readonly status: 'failed'; readonly message: string };

export function App(): ReactElement {
  const platform = usePlatform();
  const [load, setLoad] = useState<LoadState>({ status: 'loading' });
  const [recent, setRecent] = useState<readonly RecentFile[]>([]);
  const [cursor, setCursor] = useState<DiagramCursor | null>(null);
  const [help, setHelp] = useState<HelpTopic | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [documentOpen, setDocumentOpen] = useState(false);
  /** 直前の操作が伝えたいこと（写した便の数など）。次の操作で置き換わる。 */
  const [notice, setNotice] = useState<string | null>(null);

  const { dialogs, request, respond } = useFileDialogs();
  const files = useMemo(
    () => createFileService({ platform, store: useAppStore, dialogs }),
    [platform, dialogs],
  );
  // バックアップの間隔は設定で変えられる（§6.5.2）。**間隔が変われば繋ぎ直す**
  // ——走っている時計はその間隔を焼き付けているため、作り直すほかない。
  const backupIntervalMs = useAppStore((state) => state.settings.backupIntervalMs);
  const backups = useMemo(
    () => createBackupService({ platform, store: useAppStore, intervalMs: backupIntervalMs }),
    [platform, backupIntervalMs],
  );

  const canUndo = useAppStore(selectCanUndo);
  const canRedo = useAppStore(selectCanRedo);
  const setNetworkDef = useAppStore((state) => state.setNetworkDef);
  const tool = useAppStore((state) => state.ui.tool);
  const maximized = useAppStore((state) => state.ui.maximized);

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

  // 参照を変えない。変えると、ダイヤグラムが繋ぎ直しはしないまでも（`useRef`）、
  // 指を動かすたびに App ごと描き直される道ができてしまう。
  const handleCursor = useCallback((next: DiagramCursor | null) => {
    setCursor(next);
  }, []);

  /**
   * 操作の表（`commands.ts`）に「何をするか」を結び付ける（T-37）。
   *
   * **状態は呼ばれた時点で読む。** ここで `getState()` を先に呼んで閉じ込めると、
   * メニューを開いた時点の便を写す、といった古い値に対する操作になる。
   *
   * `null` は「今は使えない」である。設定ダイアログ（T-35）はまだ無く、取り消せる
   * ものが無ければ取り消しも使えない。**項目は出したまま薄くする**——押せない
   * ことがそのまま「まだ無い」「今はできない」を伝える。
   */
  const actions = useMemo<CommandActions>(() => {
    const runFile = (action: () => Promise<boolean>) => (): void => {
      void action().then(refreshRecent, refreshRecent);
    };
    const maximize = (pane: 'diagram' | 'timetable') => (): void => {
      const state = useAppStore.getState();
      state.setMaximizedPane(togglePane(state.ui.maximized, pane));
    };

    return {
      'file.new': runFile(() => files.newProject()),
      'file.open': runFile(() => files.open()),
      'file.save': runFile(() => files.save()),
      'file.saveAs': runFile(() => files.saveAs()),
      'file.backupNow': runFile(() => backups.backupNow()),
      'file.documentInfo': (): void => {
        setDocumentOpen(true);
      },

      'edit.undo': canUndo
        ? (): void => {
            useAppStore.getState().undo();
          }
        : null,
      'edit.redo': canRedo
        ? (): void => {
            useAppStore.getState().redo();
          }
        : null,
      'edit.copy': (): void => {
        setNotice(copySelection(useAppStore));
      },
      'edit.cut': (): void => {
        setNotice(cutSelection(useAppStore));
      },
      'edit.paste': (): void => {
        setNotice(pasteClipboard(useAppStore));
      },

      'edit.selectTool': (): void => {
        useAppStore.getState().setTool('select');
      },
      'edit.drawTool': (): void => {
        useAppStore.getState().setTool('draw');
      },

      'view.maximizeDiagram': maximize('diagram'),
      'view.maximizeTimetable': maximize('timetable'),
      'view.resetZoom': (): void => {
        // 戻す先は設定が持つ（§6.5.3）。定数に戻すと、設定した拡大率が
        // Ctrl+0 のたびに捨てられる。
        const state = useAppStore.getState();
        state.setDiagramView(state.settings.defaultDiagramView);
      },

      'settings.open': (): void => {
        setSettingsOpen(true);
      },

      'help.shortcuts': (): void => {
        setHelp('shortcuts');
      },
      'help.about': (): void => {
        setHelp('about');
      },
    };
  }, [files, backups, refreshRecent, canUndo, canRedo]);

  /**
   * メニューに印を付ける操作（#144）。
   *
   * ツールバーを畳んだため、**いまどちらの道具を持っているか**を知る場所は
   * メニューとステータスバーだけになった。
   */
  const checked = useMemo(
    () => ({
      'edit.selectTool': tool === 'select',
      'edit.drawTool': tool === 'draw',
      'view.maximizeDiagram': maximized === 'diagram',
      'view.maximizeTimetable': maximized === 'timetable',
    }),
    [tool, maximized],
  );

  // ショートカット（仕様書 §8.1）。メニューと同じ表を読む（T-37）。
  useEffect(() => attachShortcuts({ actions }), [actions]);

  // 隠し設定の有効化（§6.5.4、T-36）。**操作の表には載せない**——隠してある
  // ものをメニューにも鍵の一覧にも出しては、隠したことにならない。
  useEffect(() => attachUnlock({ store: useAppStore }), []);

  // 設定を読み、変わったら書く（§6.5、T-39）。**プロジェクトとは別に置く。**
  useEffect(() => {
    void loadSettings({ platform, store: useAppStore });
    return watchSettings({ platform, store: useAppStore });
  }, [platform]);

  /*
    テーマを根の要素に立てる（§9.4）。色そのものは CSS が持つ。

    **`useLayoutEffect` でなければならない。** ダイヤグラムは繋ぎ直すときに
    CSS から色を読む（`DiagramCanvas`）。通常の効果は**子から先に**走るため、
    ここを `useEffect` にすると、canvas が色を読む時点ではまだ前のテーマの
    ままで、格子とスジだけが古い配色で残る。
  */
  const theme = useAppStore((state) => state.settings.theme);
  useLayoutEffect(() => {
    applyTheme(theme, document.documentElement);
  }, [theme]);

  /**
   * 最近使ったファイル。**数が動くため表には持てない**（`MenuExtra`）。
   */
  const menuExtra = useMemo<readonly MenuExtra[]>(
    () =>
      recent.map((entry) => ({
        menu: 'file' as const,
        id: entry.handle.name,
        label: entry.handle.name,
        run: (): void => {
          void files.openRecent(entry.handle).then(refreshRecent, refreshRecent);
        },
      })),
    [recent, files, refreshRecent],
  );

  const statusMessage =
    load.status === 'loading'
      ? 'route.json を読み込んでいます…'
      : load.status === 'failed'
        ? `route.json を読み込めません（${load.message}）`
        : null;

  return (
    <div className="app-shell">
      {/*
        操作はすべてメニューから行う（仕様書 §8.1、#144）。**同じ操作を 2 か所に
        置かない**——ツールバーとメニューに同じ押しボタンが並ぶと、どちらが正なのか
        を利用者が確かめる羽目になる。
      */}
      <MenuBar actions={actions} extra={menuExtra} checked={checked} />

      {/*
        できないことを押す前に伝える（§10.4、T-42）。メニューのすぐ下に置くのは、
        **操作を始める前に目に入る**位置だからである。
      */}
      <BrowserNotice kind={platform.kind} capabilities={platform.capabilities} />

      {/*
        サイドパネルは上下 2 分割の**外**に置く。ダイヤ・パターン・運用・表示は
        どちらの画面にも同じように効くものであり（§6.4）、中に入れると
        片方を最大化したときに消える。
      */}
      <div className="app-body">
        <SidePanel />
        <SplitLayout top={<DiagramCanvas onCursor={handleCursor} />} bottom={<Timetable />} />
      </div>

      {/*
        検証パネルはサイドパネルの下も含めて画面の幅いっぱいに置く（§6.4）。
        指摘は 1 行の文であり、狭い柱に押し込むと読めない。
      */}
      <ValidationPanel />

      {/*
        直前の操作が伝えたいこと（「3 便を写しました」）もここに出す。読み込みの
        失敗は**それ以上何もできない状態**であり、そちらを先に出す。
      */}
      <StatusBar cursor={cursor} message={statusMessage ?? notice} />

      <FileDialogHost request={request} onRespond={respond} />
      <DocumentDialog
        open={documentOpen}
        onClose={() => {
          setDocumentOpen(false);
        }}
      />
      <HelpDialog
        topic={help}
        onClose={() => {
          setHelp(null);
        }}
      />
      <SettingsDialog
        open={settingsOpen}
        platform={platform}
        onNotice={setNotice}
        onClose={() => {
          setSettingsOpen(false);
        }}
      />
    </div>
  );
}
