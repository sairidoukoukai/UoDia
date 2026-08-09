/**
 * GTFS 画面（#163・#198・#221、仕様書 v2 §3、T-72・T-85）。
 *
 * ## なぜ設定ダイアログに入れないか
 *
 * 設定ダイアログは既に 4 タブある。それ以上に、**扱っているものが違う**（§3.1）。
 *
 * | | 設定ダイアログ | ここ |
 * | --- | --- | --- |
 * | 何を決めるか | 今の見え方と、区間の値 | **外へ出すときにだけ要る値** |
 * | 変えると何が動くか | 画面がすぐ変わる | **画面は何も変わらない** |
 *
 * **画面が何も変わらない値を、画面を変える場所に置かない。** 設定を開いた利用者は
 * 「変えたら何かが変わる」ものを探しており、そこに緯度経度が並んでいると、何のための
 * 欄なのかが読めない。
 *
 * ## 変わらない値には欄を作らない（T-85）
 *
 * 事業者と停留所の緯度経度には**欄があった**。外した（#221）。
 *
 * **どちらも打ち直すものではない。** 事業者名は既に決まっており（§3.3）、停留所の
 * 位置は動かない。`route.json` 版数 3 に実例の値が入っている以上、**欄が伝えて
 * いたのは「打ち直せる」ことだけ**であり、それは打ち間違いの入口でしかない。
 *
 * **直す先が無くなったわけではない。** 欠けていれば書き出しタブが `route.json`
 * だと言う（`readiness.ts`）。手で直す。
 */

import { useEffect, useRef, useState, type ReactElement } from 'react';
import type { PlatformAdapter } from '@/platform';
import { useAppStore } from '@/store';
import { CalendarTab } from './CalendarTab';
import { ExportTab } from './ExportTab';
import { exportGtfs } from './gtfsExport';

/** タブ（仕様書 v2 §3.2）。 */
type TabId = 'calendar' | 'export';

const TABS: readonly { readonly id: TabId; readonly label: string }[] = [
  { id: 'calendar', label: 'カレンダー' },
  { id: 'export', label: '書き出し' },
];

export interface GtfsDialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly platform: PlatformAdapter;
  /** 起きたことを画面に伝える（ステータスバー）。 */
  readonly onNotice?: (message: string | null) => void;
}

export function GtfsDialog(props: GtfsDialogProps): ReactElement {
  const ref = useRef<HTMLDialogElement>(null);
  const [tab, setTab] = useState<TabId>('calendar');

  useEffect(() => {
    const dialog = ref.current;
    if (dialog === null) return;

    if (!props.open) {
      if (dialog.open) dialog.close();
      return;
    }
    if (!dialog.open) dialog.showModal();
  }, [props.open]);

  return (
    <dialog
      ref={ref}
      className="settings"
      aria-label="GTFS"
      onCancel={(event) => {
        event.preventDefault();
        props.onClose();
      }}
    >
      <div className="settings__tabs" role="tablist" aria-label="GTFS の区分">
        {TABS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            aria-selected={tab === entry.id}
            className={tab === entry.id ? 'settings__tab settings__tab--active' : 'settings__tab'}
            onClick={() => {
              setTab(entry.id);
            }}
          >
            {entry.label}
          </button>
        ))}
      </div>

      {/*
        開いているあいだだけ組み立てる。閉じているダイアログの中身を作っても
        誰も見ず、定義が変わるたびに欄の初期値を作り直すことになる。
      */}
      {props.open && tab === 'calendar' && <CalendarTab />}
      {props.open && tab === 'export' && (
        <ExportTab
          onGoTo={setTab}
          onExport={async () => {
            const done = await exportGtfs({
              platform: props.platform,
              store: useAppStore,
              // **窓を重ねない。** GTFS 画面は既にモーダルであり、その上に
              // もう 1 枚出すと、閉じる順を利用者が組み立てることになる。
              dialogs: {
                showError: (message) => {
                  props.onNotice?.(message);
                  return Promise.resolve();
                },
              },
            });
            if (done) props.onNotice?.('GTFS を書き出しました');
          }}
        />
      )}

      <div className="settings__actions">
        <button type="button" onClick={props.onClose}>
          閉じる
        </button>
      </div>
    </dialog>
  );
}
