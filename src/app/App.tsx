/**
 * アプリケーションのルート。
 *
 * 実際のレイアウト（上=ダイヤグラム／下=時刻表）は T-32 で実装する。それまでは、
 * **プラットフォーム実装が実際に動いていること**を画面で確かめられる状態に
 * しておく。`route.json` の読込は、設定ディレクトリへの複製（初回起動）と
 * ファイル読込の両方を通る経路であり、ここが出ていれば I/O は繋がっている。
 */

import { useEffect, useState } from 'react';
import { loadNetworkDef } from '@/domain/network';
import { usePlatform, type PlatformAdapter } from '@/platform';

type NetworkState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly stops: number; readonly patterns: number }
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
  const [network, setNetwork] = useState<NetworkState>({ status: 'loading' });
  const [writable, setWritable] = useState<boolean | null>(null);

  useEffect(() => {
    // 読み込み中にアンマウントされたら状態を更新しない。真偽値の変数ではなく
    // AbortController を使うのは、別のクロージャでの書き換えを型検査が
    // 追えず「常に false」と判断されるため。
    const controller = new AbortController();

    void (async () => {
      try {
        // 待ち合わせをすべて済ませてから一度だけ確認する。await のたびに
        // 確認すると、型検査が「2 回目以降は常に false」と判断してしまう。
        const json = await platform.loadNetworkDef();
        const isWritable = await checkWritable(platform);
        if (controller.signal.aborted) return;

        setWritable(isWritable);
        const result = loadNetworkDef(json);
        setNetwork(
          result.ok
            ? {
                status: 'ready',
                stops: result.network.def.stops.length,
                patterns: result.network.def.patterns.length,
              }
            : { status: 'failed', message: `${result.stage} の段階で失敗しました` },
        );
      } catch (error) {
        if (!controller.signal.aborted) {
          setNetwork({ status: 'failed', message: String(error) });
        }
      }
    })();

    return () => {
      controller.abort();
    };
  }, [platform]);

  return (
    <div className="app-shell">
      <h1>UoDia</h1>
      <p>大阪大学 学内連絡バス ダイヤグラム設計ソフトウェア</p>
      <p className="app-shell__note">
        実行環境: {platform.kind}
        {' ／ '}
        {network.status === 'loading' && 'route.json を読み込んでいます…'}
        {network.status === 'ready' &&
          `route.json: 停留所 ${String(network.stops)} 件・停車パターン ${String(network.patterns)} 件`}
        {network.status === 'failed' && `route.json を読み込めません（${network.message}）`}
      </p>
      <p className="app-shell__note">
        書き込み: {writable === null ? '確認中…' : writable ? '正常' : '失敗'}
      </p>
      <p className="app-shell__note">UI は T-19 以降で実装します。</p>
    </div>
  );
}
