/**
 * GTFS の書き出しタブ（#163、仕様書 v2 §3.2、T-81）。
 *
 * ## 押せないなら、押せない理由を出す
 *
 * **押してから断らない。** 足りないものがあるうちは押しボタンを薄くし、**何が
 * 足りないか**と**どこで直すか**を並べる（`readiness.ts`）。
 *
 * **「直す」ボタンが付くのは、この画面に直す先があるものだけ**である（T-85）。
 * `route.json` を直すものにも**直す先は書く**——移れないことと、どこを直せば
 * よいか分からないことは別である。
 *
 * ## 実例と違えるところは、この画面に出さない
 *
 * 出したものは実例（`docs/gtfs_example/`）と 1 バイト単位では一致しない
 * （仕様書 v2 §6.7）。かつてはその一覧をここに畳んで置いていたが、**外した**
 * （#261）。**この画面を開く人が読むものではない**——開くのはダイヤを配りたい
 * 人であり、要るのは「出せるか、出せないなら何が足りないか」だけである。実例と
 * 1 バイトずつ突き合わせるのは別の場面の仕事で、そのとき読まれるのは画面では
 * なく仕様書 v2 §6.7 である。
 */

import { useState, type ReactElement } from 'react';
import { selectActiveService, useAppStore } from '@/store';
import { describeMissing, missingForGtfs, type ReadinessTab } from './readiness';

export interface ExportTabProps {
  /** 直す先のタブへ移る。 */
  readonly onGoTo: (tab: ReadinessTab) => void;
  /**
   * 書き出す。**まだ無い**（T-82）。
   *
   * 渡されていなければ、出せる状態でも押せない。
   */
  readonly onExport?: () => Promise<void>;
}

export function ExportTab(props: ExportTabProps): ReactElement {
  const networkDef = useAppStore((state) => state.project?.network ?? null);
  const service = useAppStore(selectActiveService);
  const [busy, setBusy] = useState(false);

  const missing = missingForGtfs({ network: networkDef, service });
  const ready = missing.length === 0;

  return (
    <section className="settings__panel">
      <p className="settings__note">
        編集中のダイヤを GTFS（zip）で書き出します。一斉出力（ファイル &gt;
        書き出し）には含まれません。
      </p>

      {ready ? (
        <p className="gtfs__ready" role="status">
          書き出せます。
        </p>
      ) : (
        <div className="gtfs__missing">
          <h3>足りないもの</h3>
          <ul>
            {missing.map((item) => {
              // **押しボタンの中で絞り込まない。** 閉じ込めた値のほうが、
              // 何を渡しているかがその場で読める。
              const fix = item.fix;
              return (
                <li key={item.message}>
                  <span>{describeMissing(item)}</span>
                  {fix?.kind === 'tab' && (
                    <button
                      type="button"
                      onClick={() => {
                        props.onGoTo(fix.tab);
                      }}
                    >
                      直す
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div className="settings__panel-actions">
        <button
          type="button"
          disabled={!ready || props.onExport === undefined || busy}
          onClick={() => {
            const run = props.onExport;
            if (run === undefined) return;
            setBusy(true);
            void run().finally(() => {
              setBusy(false);
            });
          }}
        >
          {busy ? '書き出しています…' : 'GTFS を書き出す'}
        </button>
      </div>
    </section>
  );
}
