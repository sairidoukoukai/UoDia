/**
 * アプリケーションのルート。
 *
 * 実際のレイアウト（上=ダイヤグラム／下=時刻表）は T-32 で実装する。それまでは、
 * **ここまでの層が実際に繋がっていること**を画面で確かめられる状態にしておく。
 * `route.json` の読込・書き込みの往復・ストアへの反映・セレクタによる導出が
 * すべて通っていれば、この行が出る。
 */

import { useEffect, useState } from 'react';
import { createProject } from '@/domain/io';
import { loadNetworkDef } from '@/domain/network';
import { usePlatform, type PlatformAdapter } from '@/platform';
import { selectBlocks, selectValidation, selectVisibleStops, useAppStore } from '@/store';

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

  const setNetwork = useAppStore((state) => state.setNetwork);
  const setProject = useAppStore((state) => state.setProject);
  const stops = useAppStore(selectVisibleStops);
  const blocks = useAppStore(selectBlocks);
  const issues = useAppStore(selectValidation);

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
        setNetwork(result.network);
        setProject(createProject(result.network));
        setLoad({ status: 'ready' });
      } catch (error) {
        if (!controller.signal.aborted) {
          setLoad({ status: 'failed', message: String(error) });
        }
      }
    })();

    return () => {
      controller.abort();
    };
  }, [platform, setNetwork, setProject]);

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
      <p className="app-shell__note">UI は T-19 以降で実装します。</p>
    </div>
  );
}
