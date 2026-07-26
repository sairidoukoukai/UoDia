/**
 * 時刻表（仕様書 §6.1）。方向タブとグリッドをストアに繋ぐ。
 *
 * 表示中の方向は `project.view.activeDirection` に持つ（仕様書 §5.10）。
 * 画面の状態としてここに持たないのは、ファイルに保存される設定だからである。
 * 両方に置くと、どちらが正かを決める規則が要る（`store/types.ts`）。
 */

import { useCallback, useMemo, type ReactElement } from 'react';
import type { DirectionId } from '@/domain/model';
import {
  selectActiveDirection,
  selectAllTripTimes,
  selectNetwork,
  selectTripsByDirection,
  useAppStore,
} from '@/store';
import { commitCellInput, type CellPosition } from './editing';
import { DIRECTION_LABEL, buildTimetable, stopsForDirection } from './model';
import { TimetableGrid, type CommitResult } from './TimetableGrid';

const DIRECTIONS: readonly DirectionId[] = [0, 1];

export function Timetable(): ReactElement {
  const network = useAppStore(selectNetwork);
  const direction = useAppStore(selectActiveDirection);
  const trips = useAppStore((state) => selectTripsByDirection(state, direction));
  const times = useAppStore(selectAllTripTimes);
  const editProject = useAppStore((state) => state.editProject);

  const timetable = useMemo(() => {
    if (network === null) return null;
    return buildTimetable(trips, stopsForDirection(network, direction), network, times);
  }, [network, trips, direction, times]);

  /**
   * 升目の入力を便に反映する。
   *
   * 書き換えるのは 1 便だけであり、他の升目は計算し直さない。**時刻は
   * アンカーから導かれる純粋な関数**であるため（T-08）、便が変われば同じ列の
   * 表示は次の描画でひとりでに揃う。
   */
  const handleCommit = useCallback(
    (at: CellPosition, text: string): CommitResult => {
      if (network === null || timetable === null) return { ok: false, reason: 'notEditable' };

      const outcome = commitCellInput(timetable, at, text, network);
      if (!outcome.ok) return { ok: false, reason: outcome.reason };

      const { trip } = outcome;
      editProject(
        '時刻の入力',
        (project) => {
          for (const service of project.services) {
            const index = service.trips.findIndex((t) => t.tripId === trip.tripId);
            if (index >= 0) service.trips[index] = trip;
          }
        },
        // 同じ升目への打ち直しは 1 回の取り消しでまとめて戻す（仕様書 §6.7）。
        `time:${trip.tripId}:${String(at.row)}`,
      );
      return { ok: true, rounded: outcome.rounded };
    },
    [network, timetable, editProject],
  );

  return (
    <section className="timetable-pane">
      <div className="timetable__tabs" role="tablist" aria-label="方向">
        {DIRECTIONS.map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={id === direction}
            className={
              id === direction ? 'timetable__tab timetable__tab--active' : 'timetable__tab'
            }
            onClick={() => {
              // 方向の切り替えは編集であり、取り消せる（保存される設定のため）。
              editProject('方向の切り替え', (project) => {
                project.view.activeDirection = id;
              });
            }}
          >
            {DIRECTION_LABEL[id]}
          </button>
        ))}
      </div>

      {timetable === null ? (
        <p className="timetable__empty">ネットワーク定義を読み込んでいます…</p>
      ) : (
        <TimetableGrid timetable={timetable} onCommit={handleCommit} />
      )}
    </section>
  );
}
