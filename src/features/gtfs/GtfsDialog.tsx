/**
 * GTFS 画面（#163・#198、仕様書 v2 §3、T-72）。
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
 * ## 打った値はすぐには効かない
 *
 * 設定ダイアログの区間タブと同じく、**適用するまで状態に触れない**（§6.5.1）。
 * 打ちかけの緯度で検証を走らせても、直している最中の値に意味は無い。
 */

import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import type { PlatformAdapter } from '@/platform';
import { saveNetworkDef } from '@/features/settings';
import { useAppStore } from '@/store';
import {
  AGENCY_FIELDS,
  agencyChanged,
  agencyEditsOf,
  missingRequired,
  type AgencyEdits,
  type AgencyField,
} from './agency';
import {
  invalidRows,
  parseLat,
  parseLon,
  stopCoordinateRows,
  type CoordinateEdits,
} from './coordinates';
import { applyGtfsEdits } from './gtfsService';
import { CalendarTab } from './CalendarTab';
import { ExportTab } from './ExportTab';

/** タブ（仕様書 v2 §3.2）。 */
type TabId = 'agency' | 'stops' | 'calendar' | 'export';

const TABS: readonly { readonly id: TabId; readonly label: string }[] = [
  { id: 'agency', label: '事業者' },
  { id: 'stops', label: '停留所' },
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
  const [tab, setTab] = useState<TabId>('agency');

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
      {props.open && (tab === 'agency' || tab === 'stops') && (
        <NetworkTab tab={tab} platform={props.platform} onNotice={props.onNotice} />
      )}
      {props.open && tab === 'calendar' && <CalendarTab />}
      {props.open && tab === 'export' && <ExportTab onGoTo={setTab} />}

      <div className="settings__actions">
        <button type="button" onClick={props.onClose}>
          閉じる
        </button>
      </div>
    </dialog>
  );
}

interface NetworkTabProps {
  readonly tab: 'agency' | 'stops';
  readonly platform: PlatformAdapter;
  readonly onNotice?: ((message: string | null) => void) | undefined;
}

/**
 * 事業者タブと停留所タブ。
 *
 * **1 つの部品にまとめる。** どちらも `route.json` を書き換えるものであり、
 * **適用も書き戻しも 1 回で行う**（`applyGtfsEdits`）。タブごとに適用ボタンを
 * 置くと、片方だけ適用して閉じたときに中途半端な `route.json` が残る。
 */
function NetworkTab(props: NetworkTabProps): ReactElement {
  const networkDef = useAppStore((state) => state.networkDef);
  const writable = props.platform.capabilities.networkDefWritable;

  const [agencyEdits, setAgencyEdits] = useState<AgencyEdits>(() =>
    agencyEditsOf(networkDef?.agency),
  );
  const [coordinateEdits, setCoordinateEdits] = useState<CoordinateEdits>(() => new Map());

  const rows = useMemo(
    () => (networkDef === null ? [] : stopCoordinateRows(networkDef)),
    [networkDef],
  );

  if (networkDef === null) {
    return (
      <section className="settings__panel">
        <p className="settings__note">路線図を読み込んでいます…</p>
      </section>
    );
  }

  const missing = missingRequired(agencyEdits);
  const invalid = invalidRows(coordinateEdits);
  const dirty = agencyChanged(networkDef.agency, agencyEdits) || coordinateEdits.size > 0;
  const canApply = missing.length === 0 && invalid.length === 0 && dirty;

  /** 欄に出す値。**打ち直していれば打った値、そうでなければ定義の値。** */
  const shown = (stopId: string, key: 'lat' | 'lon', fallback: string): string =>
    coordinateEdits.get(stopId)?.[key] ?? fallback;

  const editCoordinate = (stopId: string, key: 'lat' | 'lon', value: string): void => {
    setCoordinateEdits((prev) => {
      const next = new Map(prev);
      const row = rows.find((r) => r.stopId === stopId);
      const current = next.get(stopId) ?? { lat: row?.lat ?? '', lon: row?.lon ?? '' };
      next.set(stopId, { ...current, [key]: value });
      return next;
    });
  };

  const apply = async (): Promise<void> => {
    const result = applyGtfsEdits(useAppStore, agencyEdits, coordinateEdits);
    props.onNotice?.(result.message);
    if (!result.ok) return;

    setCoordinateEdits(new Map());

    // **検証を通ったときだけ書き戻す**（§6.5.1）。順序を逆にすると、通らない
    // 内容がファイルへ書かれる。
    const saved = await saveNetworkDef(useAppStore, props.platform);
    if (saved !== null) props.onNotice?.(`${result.message}（${saved}）`);
  };

  return (
    <section className="settings__panel">
      {props.tab === 'agency' ? (
        <AgencyFields edits={agencyEdits} missing={missing} onChange={setAgencyEdits} />
      ) : (
        <table className="gtfs__stops">
          <caption className="gtfs__caption">
            停留所そのもの（名称・順序・軸位置）はここでは編集できません。route.json
            を直接編集してください。車庫にも欄があります——stops.txt に出すため、座標が要ります。
          </caption>
          <thead>
            <tr>
              <th scope="col">停留所</th>
              <th scope="col">緯度</th>
              <th scope="col">経度</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.stopId}>
                <th scope="row">
                  {row.stopName}
                  {row.isDepot ? '（車庫）' : ''}
                </th>
                <td>
                  <input
                    type="text"
                    inputMode="decimal"
                    aria-label={`${row.stopName}の緯度`}
                    aria-invalid={parseLat(shown(row.stopId, 'lat', row.lat)) === null}
                    value={shown(row.stopId, 'lat', row.lat)}
                    onChange={(event) => {
                      editCoordinate(row.stopId, 'lat', event.target.value);
                    }}
                  />
                </td>
                <td>
                  <input
                    type="text"
                    inputMode="decimal"
                    aria-label={`${row.stopName}の経度`}
                    aria-invalid={parseLon(shown(row.stopId, 'lon', row.lon)) === null}
                    value={shown(row.stopId, 'lon', row.lon)}
                    onChange={(event) => {
                      editCoordinate(row.stopId, 'lon', event.target.value);
                    }}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <p className="settings__note" role="status">
        {missing.length > 0
          ? '事業者の必須項目が空です'
          : invalid.length > 0
            ? `${String(invalid.length)} 件の緯度経度が読めません`
            : dirty
              ? '適用すると route.json に書き戻します'
              : '変更はありません'}
      </p>

      <div className="settings__panel-actions">
        <button type="button" disabled={!canApply} onClick={() => void apply()}>
          {writable ? '適用して route.json に書き戻す' : '適用して route.json を書き出す'}
        </button>
      </div>

      {!writable && (
        <p className="settings__note">
          この環境では route.json を書き戻せません（仕様書 §6.5.5）。書き出したファイルで route.json
          を差し替えるまで、ほかの環境には反映されません。
        </p>
      )}
    </section>
  );
}

interface AgencyFieldsProps {
  readonly edits: AgencyEdits;
  readonly missing: readonly AgencyField[];
  readonly onChange: (next: AgencyEdits) => void;
}

function AgencyFields(props: AgencyFieldsProps): ReactElement {
  return (
    <div className="gtfs__fields">
      {AGENCY_FIELDS.map((entry) => (
        <label key={entry.field} className="gtfs__field">
          <span>
            {entry.label}
            {entry.required ? '' : '（任意）'}
          </span>
          {/*
            **読み上げ名は欄の名前だけにする。** `<label>` で包むと補足（`small`）
            まで名前に混ざり、「事業者名バスを走らせている主体」と読まれる。
          */}
          <input
            type="text"
            aria-label={entry.label}
            value={props.edits[entry.field]}
            aria-invalid={props.missing.includes(entry.field)}
            onChange={(event) => {
              props.onChange({ ...props.edits, [entry.field]: event.target.value });
            }}
          />
          {entry.hint !== undefined && <small>{entry.hint}</small>}
        </label>
      ))}
    </div>
  );
}
