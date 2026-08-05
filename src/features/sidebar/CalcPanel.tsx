/**
 * 計算の節（T-65、#166、仕様書 v1.1 §6.4・§6.5）。
 *
 * 距離（#161）と輸送力（#162）を出し、**どこを数えるかをここで決める。**
 *
 * ## フォーカスは視野ではない
 *
 * 視野（送り・拡大率）は「画面のどこを見ているか」を決め、絵が動いても数は
 * 変わらない。フォーカスは「どこを数えるか」を決め、**数が変わっても絵は
 * 動かない。** 視野に連動させると、拡大しただけで輸送力の数が変わる——
 * **画面を送るたびに数が動く表は読めない。**
 *
 * ## 範囲を決める場所と、数を出す場所を離さない
 *
 * 離すと、絞ったことを忘れたまま数を読む。**部分的な数字を全体だと思い込む**
 * のが、この機能でいちばん避けたい事故である。
 */

import { useMemo, type ReactElement } from 'react';
import {
  DEFAULT_CAPACITY,
  distanceInRange,
  sectionCapacity,
  totalCapacity,
  type TimeRange,
} from '@/domain/block';
import type { Trip } from '@/domain/model';
import type { NetworkIndex } from '@/domain/network';
import { formatTime, fromHM, type Seconds } from '@/domain/time';
import { expandDeadheads, formatKm, originTime } from '@/domain/trip';
import { selectNetwork, selectTrips, selectView, useAppStore } from '@/store';

/** 定員を 1 つも打ち替えていない状態。 */
const NO_CAPACITIES: Readonly<Record<string, number>> = Object.freeze({});

/** 距離を言葉にする。**分からないときは数を出さない。** */
function describeKm(meters: number | null): string {
  return meters === null ? '— km' : formatKm(meters);
}

export function CalcPanel(): ReactElement {
  const network = useAppStore(selectNetwork);
  const trips = useAppStore(selectTrips);
  const capacities = useAppStore((state) => state.project?.patternCapacities ?? NO_CAPACITIES);
  const focus = useAppStore((state) => selectView(state)?.focus);

  const enabled = focus?.enabled ?? false;
  const from = focus?.from ?? fromHM(7, 0);
  const to = focus?.to ?? fromHM(22, 0);

  const range = useMemo<TimeRange | null>(
    () => (enabled ? { from, to } : null),
    [enabled, from, to],
  );

  /**
   * 走行距離（回送込み）と営業距離（回送抜き）。
   *
   * **回送を展開してから数える。** 出入区は便の一部であり（§6.1.7）、車庫まで
   * 走った距離も「その車が走った距離」である。
   */
  const distances = useMemo(() => {
    if (network === null) return { total: null, revenue: null };
    return {
      total: distanceInRange(expandDeadheads(trips, network), network, range),
      revenue: distanceInRange(trips, network, range),
    };
  }, [trips, network, range]);

  const capacity = useMemo(
    () =>
      network === null
        ? { seats: 0, counted: 0, skipped: 0 }
        : totalCapacity(inRange(trips, range, network), network, capacities),
    [trips, network, capacities, range],
  );

  /** 断面（区間 × 方向）ごとの輸送力。**区間ごとに出す。** */
  const sections = useMemo(() => {
    if (network === null) return [];
    return network.def.segments
      .filter((segment) => {
        const stops = [segment.fromStopId, segment.toStopId];
        return stops.every((id) => network.findStop(id)?.isDepot !== true);
      })
      .map((segment) => ({
        key: `${segment.fromStopId}→${segment.toStopId}`,
        label: `${network.findStop(segment.fromStopId)?.shortName ?? segment.fromStopId} → ${
          network.findStop(segment.toStopId)?.shortName ?? segment.toStopId
        }`,
        total: sectionCapacity(trips, network, capacities, {
          fromStopId: segment.fromStopId,
          toStopId: segment.toStopId,
          range,
        }),
      }))
      .filter((row) => row.total.counted > 0);
  }, [trips, network, capacities, range]);

  /**
   * 範囲を変える。
   *
   * **履歴に載せず、未保存にもしない**（仕様書 v1.1 §6.4.3）。どこを数えて
   * いるかは編集ではない。視野（`setDiagramView`）と同じ扱いである。
   */
  const setFocus = (next: { enabled?: boolean; from?: Seconds; to?: Seconds }): void => {
    useAppStore.getState().setFocus(next);
  };

  return (
    <section className="panel__section">
      <h2 className="panel__title">計算</h2>

      <label className="panel__check">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(event) => {
            setFocus({ enabled: event.target.checked });
          }}
        />
        時間範囲を絞る
      </label>

      {/*
        **範囲が有効であることが画面から分かる**（受入条件）。気付かずに部分的な
        数字を全体だと思い込まないようにする。
      */}
      <div className="panel__range" aria-live="polite">
        <input
          type="time"
          aria-label="計算する範囲の開始時刻"
          disabled={!enabled}
          value={toInputTime(from)}
          onChange={(event) => {
            const parsed = fromInputTime(event.target.value);
            if (parsed !== null) setFocus({ from: parsed });
          }}
        />
        <span>〜</span>
        <input
          type="time"
          aria-label="計算する範囲の終了時刻"
          disabled={!enabled}
          value={toInputTime(to)}
          onChange={(event) => {
            const parsed = fromInputTime(event.target.value);
            if (parsed !== null) setFocus({ to: parsed });
          }}
        />
      </div>

      {enabled && (
        <p className="panel__focused">
          {formatTime(from)}〜{formatTime(to)} だけを数えています
        </p>
      )}

      <dl className="panel__stats">
        <dt>走行距離</dt>
        <dd>{describeKm(distances.total)}</dd>
        <dt>営業距離</dt>
        <dd>{describeKm(distances.revenue)}</dd>
        <dt>延べ輸送力</dt>
        <dd>{capacity.seats} 人</dd>
      </dl>

      {/*
        **数えなかった便の件数を必ず出す**（仕様書 v1.1 §6.5）。合計だけを出すと、
        抜けていることに気づかないまま読まれる。
      */}
      {capacity.skipped > 0 && (
        <p className="panel__empty">{capacity.skipped} 便が時刻未入力のため数えていません</p>
      )}

      {sections.length > 0 && (
        <table className="panel__sections">
          <caption>断面輸送力</caption>
          <thead>
            <tr>
              <th scope="col">区間</th>
              <th scope="col">便</th>
              <th scope="col">人</th>
            </tr>
          </thead>
          <tbody>
            {sections.map((row) => (
              <tr key={row.key}>
                <th scope="row">{row.label}</th>
                <td>{row.total.counted}</td>
                <td>{row.total.seats}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <p className="panel__note">
        定員の既定は {DEFAULT_CAPACITY} 人（暫定）。系統ごとに上のパターン一覧で変えられます。
      </p>
    </section>
  );
}

/** `<input type="time">` に渡す `HH:MM`。 */
function toInputTime(time: Seconds): string {
  const minutes = Math.floor(time / 60) % (24 * 60);
  const hh = String(Math.floor(minutes / 60)).padStart(2, '0');
  const mm = String(minutes % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}

/** `HH:MM` を秒にする。読み取れなければ `null`。 */
function fromInputTime(text: string): Seconds | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(text);
  if (match === null) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59 || minutes % 5 !== 0) return null;
  return fromHM(hours, minutes);
}

/**
 * 範囲に入る便だけを残す。
 *
 * **延べ輸送力は便を単位に数える**ため、始発時刻で見る。断面輸送力のほうは
 * 「その区間を通る時刻」で見る（`sectionCapacity`）——**問いが違えば見る時刻も
 * 違う。**
 */
function inRange(
  trips: readonly Trip[],
  range: TimeRange | null,
  network: NetworkIndex,
): readonly Trip[] {
  if (range === null) return trips;
  return trips.filter((trip) => {
    const time = originTime(trip, network);
    return time !== null && time >= range.from && time <= range.to;
  });
}
