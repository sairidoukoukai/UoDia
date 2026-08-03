/**
 * 停車パターンタブ（隠し設定。仕様書 §6.5.4、T-36）。
 *
 * 開くには <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Alt</kbd>+<kbd>D</kbd> が要る
 * （`unlock.ts`）。**普段の作図で触る場所ではない**——路線の定義であり、便を作る
 * 操作とは別の頻度で変わる。
 *
 * ## 直したそばから検証する
 *
 * 区間表に無い停留所対を並べると、その便の時刻は計算できない（R-03）。適用の
 * ときだけ知らせるのでは、**どの操作が壊したのか**を戻って探すことになる。
 * 打ち直すたびに検証し、**足りない区間をそのまま出す。**
 */

import { useMemo, useState, type ReactElement } from 'react';
import type { DirectionId, Handling, ServiceType, StopPattern } from '@/domain/model';
import { validateNetwork } from '@/domain/network';
import type { PlatformAdapter } from '@/platform';
import { selectNetwork, selectTrips, useAppStore } from '@/store';
import {
  affectedTripCount,
  changedPatternIds,
  duplicatedPattern,
  movedStop,
  patternRows,
  withHandling,
  withPatterns,
  withStopAdded,
  withStopRemoved,
} from './patterns';
import { applyPatterns, saveNetworkDef } from './settingsService';

const HANDLING_LABEL: Record<Handling, string> = {
  stop: '乗降',
  boardOnly: '乗車のみ',
  alightOnly: '降車のみ',
};

const DIRECTION_LABEL: Record<DirectionId, string> = { 0: '吹田方面', 1: '豊中方面' };

const SERVICE_TYPE_LABEL: Record<ServiceType, string> = { local: '各駅', express: '通過' };

export interface PatternsTabProps {
  readonly platform: PlatformAdapter;
  readonly onNotice?: ((message: string | null) => void) | undefined;
}

export function PatternsTab(props: PatternsTabProps): ReactElement {
  const network = useAppStore(selectNetwork);
  const trips = useAppStore(selectTrips);

  /** 編集中のパターン。`null` なら今の定義のまま。 */
  const [draft, setDraft] = useState<readonly StopPattern[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // **今の定義を写さずに指す。** 編集していないあいだ（`draft === null`）は
  // 定義の配列そのものを使うため、記憶化した計算がそのまま効く。
  const patterns = useMemo(() => draft ?? network?.def.patterns ?? [], [draft, network]);
  const rows = useMemo(
    () => (network === null ? [] : patternRows(patterns, network)),
    [patterns, network],
  );
  const selected = patterns.find((pattern) => pattern.patternId === selectedId) ?? patterns[0];

  const changed = useMemo(
    () => (network === null ? [] : changedPatternIds(network.def.patterns, patterns)),
    [network, patterns],
  );
  const affected = useMemo(
    () => (network === null ? 0 : affectedTripCount(trips, network, changed)),
    [trips, network, changed],
  );

  /** 直したそばから検証する（R-03 ほか）。 */
  const issues = useMemo(
    () => (network === null ? [] : validateNetwork(withPatterns(network.def, patterns))),
    [network, patterns],
  );

  const edit = (next: StopPattern): void => {
    setDraft(patterns.map((pattern) => (pattern.patternId === next.patternId ? next : pattern)));
    setConfirming(false);
  };

  const apply = (): void => {
    const result = applyPatterns(useAppStore, patterns);
    setConfirming(false);
    setMessage(result.message);
    props.onNotice?.(result.message);
    if (result.ok) setDraft(null);
  };

  const save = (): void => {
    void saveNetworkDef(useAppStore, props.platform).then(
      (said) => {
        if (said !== null) {
          setMessage(said);
          props.onNotice?.(said);
        }
      },
      (error: unknown) => {
        setMessage(`書き戻せません: ${String(error)}`);
      },
    );
  };

  if (network === null) {
    return (
      <section className="settings__panel">
        <p>路線図を読み込んでいません。</p>
      </section>
    );
  }

  return (
    <section className="settings__panel settings__panel--patterns">
      <p className="settings__note">
        停留所そのもの（名称・順序・軸位置）はここでは編集できません。route.json
        を直接直してください（仕様書 §6.5.4）。
      </p>

      <div className="settings__patterns">
        <ul className="settings__pattern-list">
          {rows.map((row) => (
            <li key={row.pattern.patternId}>
              <button
                type="button"
                aria-pressed={row.pattern.patternId === selected?.patternId}
                onClick={() => {
                  setSelectedId(row.pattern.patternId);
                }}
              >
                <span className="settings__pattern-id">{row.pattern.patternId}</span>{' '}
                {row.pattern.patternName}
                <span className="settings__note"> {row.path}</span>
              </button>
            </li>
          ))}
        </ul>

        {selected !== undefined && (
          <div className="settings__pattern-detail">
            <label className="settings__field">
              名前
              <input
                value={selected.patternName}
                onChange={(event) => {
                  edit({ ...selected, patternName: event.target.value });
                }}
              />
            </label>

            <label className="settings__field">
              方向
              <select
                value={String(selected.directionId)}
                onChange={(event) => {
                  edit({ ...selected, directionId: Number(event.target.value) as DirectionId });
                }}
              >
                {([0, 1] as const).map((direction) => (
                  <option key={direction} value={direction}>
                    {DIRECTION_LABEL[direction]}
                  </option>
                ))}
              </select>
            </label>

            {/* 回送に各駅・通過の別は無い（R-12、#114）。 */}
            {!selected.isDeadhead && (
              <label className="settings__field">
                種別
                <select
                  value={selected.serviceType ?? 'local'}
                  onChange={(event) => {
                    edit({ ...selected, serviceType: event.target.value as ServiceType });
                  }}
                >
                  {(['local', 'express'] as const).map((type) => (
                    <option key={type} value={type}>
                      {SERVICE_TYPE_LABEL[type]}
                    </option>
                  ))}
                </select>
              </label>
            )}

            <table className="settings__stops">
              <thead>
                <tr>
                  <th scope="col">停留所</th>
                  <th scope="col">取扱区分</th>
                  <th scope="col">並び</th>
                </tr>
              </thead>
              <tbody>
                {selected.stopSequence.map((stop, index) => (
                  <tr key={stop.stopId}>
                    <th scope="row">{network.findStop(stop.stopId)?.shortName ?? stop.stopId}</th>
                    <td>
                      <select
                        aria-label={`${stop.stopId} の取扱区分`}
                        value={stop.handling}
                        onChange={(event) => {
                          edit(withHandling(selected, index, event.target.value as Handling));
                        }}
                      >
                        {(['stop', 'boardOnly', 'alightOnly'] as const).map((handling) => (
                          <option key={handling} value={handling}>
                            {HANDLING_LABEL[handling]}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <button
                        type="button"
                        aria-label={`${stop.stopId} を上へ`}
                        disabled={index === 0}
                        onClick={() => {
                          edit(movedStop(selected, index, -1));
                        }}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        aria-label={`${stop.stopId} を下へ`}
                        disabled={index === selected.stopSequence.length - 1}
                        onClick={() => {
                          edit(movedStop(selected, index, 1));
                        }}
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        aria-label={`${stop.stopId} を外す`}
                        onClick={() => {
                          edit(withStopRemoved(selected, index));
                        }}
                      >
                        外す
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <label className="settings__field">
              停留所を足す
              <select
                aria-label="足す停留所"
                value=""
                onChange={(event) => {
                  if (event.target.value === '') return;
                  edit(withStopAdded(selected, event.target.value, 'stop'));
                }}
              >
                <option value="">選ぶ…</option>
                {network.def.stops
                  .filter((stop) => !selected.stopSequence.some((s) => s.stopId === stop.stopId))
                  .map((stop) => (
                    <option key={stop.stopId} value={stop.stopId}>
                      {stop.shortName}
                    </option>
                  ))}
              </select>
            </label>

            <div className="settings__panel-actions">
              <button
                type="button"
                onClick={() => {
                  const copy = duplicatedPattern(selected, patterns);
                  setDraft([...patterns, copy]);
                  setSelectedId(copy.patternId);
                  setConfirming(false);
                }}
              >
                複製して追加
              </button>
              <button
                type="button"
                onClick={() => {
                  setDraft(patterns.filter((pattern) => pattern.patternId !== selected.patternId));
                  setSelectedId(null);
                  setConfirming(false);
                }}
              >
                このパターンを削除
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 足りない区間をそのまま出す（R-03、受入条件）。 */}
      {issues.length > 0 && (
        <ul className="settings__issues">
          {issues.map((issue) => (
            <li key={`${issue.rule}:${issue.message}`} className="settings__error">
              [{issue.rule}] {issue.message}
            </li>
          ))}
        </ul>
      )}

      {changed.length > 0 && (
        <p className="settings__affected">
          {changed.length} パターンの変更。<strong>{affected} 便</strong>の時刻が変わります
        </p>
      )}

      <div className="settings__panel-actions">
        {confirming ? (
          <>
            <span className="settings__confirm">
              {affected} 便の時刻が変わります。よろしいですか？
            </span>
            <button type="button" onClick={apply}>
              適用する
            </button>
            <button
              type="button"
              onClick={() => {
                setConfirming(false);
              }}
            >
              やめる
            </button>
          </>
        ) : (
          <button
            type="button"
            disabled={changed.length === 0 || issues.length > 0}
            onClick={() => {
              setConfirming(true);
            }}
          >
            変更を適用
          </button>
        )}
        <button
          type="button"
          disabled={draft === null}
          onClick={() => {
            setDraft(null);
            setConfirming(false);
            setMessage(null);
          }}
        >
          入力を元に戻す
        </button>
        <button type="button" onClick={save}>
          {props.platform.capabilities.networkDefWritable
            ? 'route.json に書き戻す'
            : 'route.json を書き出す'}
        </button>
      </div>

      {message !== null && <p className="settings__message">{message}</p>}
    </section>
  );
}
