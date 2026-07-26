/**
 * 時刻表（仕様書 §6.1）。方向タブとグリッドをストアに繋ぐ。
 *
 * 表示中の方向は `project.view.activeDirection` に持つ（仕様書 §5.10）。
 * 画面の状態としてここに持たないのは、ファイルに保存される設定だからである。
 * 両方に置くと、どちらが正かを決める規則が要る（`store/types.ts`）。
 */

import { useMemo, type ReactElement } from 'react';
import type { DirectionId } from '@/domain/model';
import {
  selectActiveDirection,
  selectAllTripTimes,
  selectNetwork,
  selectTripsByDirection,
  useAppStore,
} from '@/store';
import { DIRECTION_LABEL, buildTimetable, stopsForDirection } from './model';
import { TimetableGrid } from './TimetableGrid';

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
        <TimetableGrid timetable={timetable} />
      )}
    </section>
  );
}
