/**
 * 着色モードと、パターン・運用に属さない表示の切替（仕様書 §6.2.4、T-33）。
 *
 * パターンと運用の表示切替はそれぞれの一覧に置いてある（`PatternList` /
 * `BlockList`）。**同じ切替を 2 か所に出さない。** ここに残るのは、一覧を持たない
 * 方向と回送、そして着色モードである。
 *
 * ここまで T-26 の仮の操作列（`DiagramControls`）が持っていたものであり、この
 * 節がその置き換えにあたる。
 */

import type { ReactElement } from 'react';
import type { DirectionId } from '@/domain/model';
import { DIRECTION_LABEL } from '@/features/timetable';
import { selectView, useAppStore } from '@/store';
import { withHidden } from './filters';

const DIRECTIONS: readonly DirectionId[] = [0, 1];

/** 空の一覧。**毎回作らない**——参照が変わると購読が動く。 */
const NO_DIRECTIONS: readonly DirectionId[] = [];

export function DisplayFilters(): ReactElement {
  /**
   * **必要な項目だけを購読する**（T-40）。`view` を丸ごと見ると、ダイヤグラムを
   * 送るたびにこの節が描き直される——送りも `view` の一部だからである。
   */
  const hasView = useAppStore((state) => selectView(state) !== null);
  const colorMode = useAppStore((state) => selectView(state)?.colorMode ?? 'pattern');
  const hiddenDirections = useAppStore(
    (state) => selectView(state)?.hiddenDirections ?? NO_DIRECTIONS,
  );
  const showDeadhead = useAppStore((state) => selectView(state)?.showDeadhead ?? true);
  const showBlockLinks = useAppStore((state) => selectView(state)?.showBlockLinks ?? true);
  const editProject = useAppStore((state) => state.editProject);

  if (!hasView) return <section className="panel__section" />;

  return (
    <section className="panel__section">
      <h2 className="panel__title">表示</h2>

      <label className="panel__field">
        着色{' '}
        <select
          value={colorMode}
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

      {DIRECTIONS.map((directionId) => (
        <label key={directionId} className="panel__field">
          <input
            type="checkbox"
            checked={!hiddenDirections.includes(directionId)}
            onChange={(event) => {
              const show = event.target.checked;
              editProject('方向の表示の変更', (project) => {
                project.view.hiddenDirections = withHidden(
                  project.view.hiddenDirections,
                  directionId,
                  show,
                ) as DirectionId[];
              });
            }}
          />{' '}
          {DIRECTION_LABEL[directionId]}
        </label>
      ))}

      <label className="panel__field">
        <input
          type="checkbox"
          checked={showDeadhead}
          onChange={(event) => {
            const showDeadhead = event.target.checked;
            editProject('回送便の表示の変更', (project) => {
              project.view.showDeadhead = showDeadhead;
            });
          }}
        />{' '}
        回送便
      </label>

      {/*
        折返しの接続線（#167）。便が増えると水平線も増えるため切れるようにする。
        **既定は出す**——どの便がどの便に繋がるかは、絵から読めることに意味がある。
      */}
      <label className="panel__field">
        <input
          type="checkbox"
          checked={showBlockLinks}
          onChange={(event) => {
            const showBlockLinks = event.target.checked;
            editProject('折返しの接続線の表示の変更', (project) => {
              project.view.showBlockLinks = showBlockLinks;
            });
          }}
        />{' '}
        折返しの接続
      </label>
    </section>
  );
}
