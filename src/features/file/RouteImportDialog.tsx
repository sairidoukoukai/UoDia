/**
 * 路線を取り込む確認（#235、T-91）。
 *
 * ## 押す前に、起きることを全部出す
 *
 * 取り込みは **1 操作で全便に及ぶ**。増減の数だけでなく、**参照が壊れる便**を
 * 名指しで並べる——「時刻が出ない便が 12 件」と当ててから言われても、どれを
 * 直せばよいかが分からない。
 *
 * 取り消せる操作ではあるが、**取り消せることは、起きてよいことの理由にならない。**
 *
 * ## 何も変わらないときは押させない
 *
 * 同じ路線を取り込んでも履歴に空の 1 段が積まれるだけである。**押しボタンを
 * 薄くし、変わらないことを言う。**
 */

import { useEffect, useRef, type ReactElement } from 'react';
import { changeCount, type RouteChange } from '@/domain/network';
import type { RouteImportCandidate } from './routeImportService';

export interface RouteImportDialogProps {
  /** `null` なら閉じている。 */
  readonly candidate: RouteImportCandidate | null;
  readonly onCancel: () => void;
  readonly onApply: (candidate: RouteImportCandidate) => void;
}

export function RouteImportDialog(props: RouteImportDialogProps): ReactElement {
  const ref = useRef<HTMLDialogElement>(null);
  const candidate = props.candidate;

  useEffect(() => {
    const dialog = ref.current;
    if (dialog === null) return;

    if (candidate === null) {
      if (dialog.open) dialog.close();
      return;
    }
    if (!dialog.open) dialog.showModal();
  }, [candidate]);

  const summary = candidate?.summary ?? null;

  return (
    <dialog
      ref={ref}
      className="settings"
      aria-label="路線を取り込む"
      onCancel={(event) => {
        event.preventDefault();
        props.onCancel();
      }}
    >
      {candidate !== null && summary !== null && (
        <section className="settings__panel">
          <p className="settings__note">
            {candidate.sourceName} の路線を、いま開いている文書へ取り込みます。
          </p>

          {summary.unchanged ? (
            <p className="settings__message" role="status">
              いまの路線と同じです。取り込んでも何も変わりません。
            </p>
          ) : (
            <>
              <table className="settings__segments">
                <thead>
                  <tr>
                    <th scope="col">項目</th>
                    <th scope="col">増える</th>
                    <th scope="col">減る</th>
                  </tr>
                </thead>
                <tbody>
                  <ChangeRow label="停留所" change={summary.stops} />
                  <ChangeRow label="区間" change={summary.segments} />
                  <ChangeRow label="停車パターン" change={summary.patterns} />
                </tbody>
              </table>

              {changeCount(summary.stops) +
                changeCount(summary.segments) +
                changeCount(summary.patterns) ===
                0 && (
                <p className="settings__note">増減はありませんが、所要時間などの値が違います。</p>
              )}
            </>
          )}

          {summary.brokenTrips.length > 0 && (
            <div className="gtfs__missing">
              <h3>時刻が出なくなる便（{summary.brokenTrips.length} 件）</h3>
              <p className="settings__note">
                指している停車パターンが、取り込む路線にありません。取り込むと既定の
                パターンへ倒れます。
              </p>
              <ul>
                {summary.brokenTrips.slice(0, BROKEN_SHOWN).map((trip) => (
                  <li key={trip.tripId}>
                    <span>
                      {trip.serviceId} の便 {trip.tripId}（{trip.patternId}）
                    </span>
                  </li>
                ))}
                {summary.brokenTrips.length > BROKEN_SHOWN && (
                  <li>
                    <span>ほか {summary.brokenTrips.length - BROKEN_SHOWN} 件</span>
                  </li>
                )}
              </ul>
            </div>
          )}

          <div className="settings__panel-actions">
            <button
              type="button"
              disabled={summary.unchanged}
              onClick={() => {
                props.onApply(candidate);
              }}
            >
              取り込む
            </button>
            <button type="button" onClick={props.onCancel}>
              やめる
            </button>
          </div>

          <p className="settings__note">取り消し（Ctrl+Z）で戻せます。</p>
        </section>
      )}
    </dialog>
  );
}

/**
 * 名前を並べる上限。
 *
 * **全部出しても読まれない。** 何件あるかと、どんなものかが分かれば足りる。
 */
const BROKEN_SHOWN = 10;
const NAMES_SHOWN = 6;

function ChangeRow(props: { readonly label: string; readonly change: RouteChange }): ReactElement {
  return (
    <tr>
      <th scope="row">{props.label}</th>
      <td>{describe(props.change.added)}</td>
      <td>{describe(props.change.removed)}</td>
    </tr>
  );
}

/** 名前を並べる。多ければ数で畳む。 */
function describe(names: readonly string[]): string {
  if (names.length === 0) return '—';
  if (names.length <= NAMES_SHOWN) return names.join('・');
  return `${names.slice(0, NAMES_SHOWN).join('・')} ほか ${String(names.length - NAMES_SHOWN)} 件`;
}
