/**
 * 着色モードと表示フィルタの仮の操作列（仕様書 §6.2.4、T-26）。
 *
 * **本来の置き場所はサイドパネル（T-33）である。** ここに置くのは、着色と
 * フィルタが実際に効くことを画面で確かめられるようにするためである。時刻表の
 * 操作列（T-21）と同じ扱いで、T-33 が置き換える。
 *
 * パターンごと・運用ごとの表示切替は出していない。値が増えるほど押しボタンが
 * 増える種類の操作であり、一覧の形（T-33）でしか収まらない。効くかどうかは
 * 単体テストで確かめている（`scene.test.ts`）。
 */

import type { ReactElement } from 'react';
import type { DirectionId } from '@/domain/model';
import { DIRECTION_LABEL } from '@/features/timetable';
import { useAppStore } from '@/store';

const DIRECTIONS: readonly DirectionId[] = [0, 1];

export function DiagramControls(): ReactElement {
  const editProject = useAppStore((state) => state.editProject);
  const view = useAppStore((state) => state.project?.view);

  if (view === undefined) return <div className="diagram__controls" />;

  return (
    <div className="diagram__controls">
      <label>
        着色{' '}
        <select
          value={view.colorMode}
          onChange={(event) => {
            const colorMode = event.target.value === 'block' ? 'block' : 'pattern';
            editProject('着色モードの変更', (project) => {
              project.view.colorMode = colorMode;
            });
          }}
        >
          <option value="pattern">パターン</option>
          <option value="block">運用</option>
        </select>
      </label>

      <label>
        <input
          type="checkbox"
          checked={view.showDeadhead}
          onChange={(event) => {
            const showDeadhead = event.target.checked;
            editProject('回送便の表示の変更', (project) => {
              project.view.showDeadhead = showDeadhead;
            });
          }}
        />{' '}
        回送便
      </label>

      {DIRECTIONS.map((directionId) => (
        <label key={directionId}>
          <input
            type="checkbox"
            checked={!view.hiddenDirections.includes(directionId)}
            onChange={(event) => {
              const show = event.target.checked;
              editProject('方向の表示の変更', (project) => {
                const hidden = project.view.hiddenDirections.filter((id) => id !== directionId);
                project.view.hiddenDirections = show ? hidden : [...hidden, directionId];
              });
            }}
          />{' '}
          {DIRECTION_LABEL[directionId]}
        </label>
      ))}
    </div>
  );
}
