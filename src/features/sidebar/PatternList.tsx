/**
 * 停車パターンの一覧（仕様書 §6.2.4、T-33）。
 *
 * **定義は変えられない。** パターンの中身（停留所の並び・取扱区分）は
 * `route.json` のものであり、直すのは隠し設定（T-36）の仕事である。ここでは
 * 見分けるための色と線種を並べ、**描くか描かないか**だけを切り替える。
 *
 * 色見本に線種を添えるのは、色だけに頼らないためである（§9.4）。ダイヤグラムの
 * 線種はパターンの定義順で決まっており（`assignPatternDashes`）、同じ道具を
 * 使うことで**一覧とスジが必ず一致する。**
 */

import { useMemo, type ReactElement } from 'react';
import { assignPatternDashes } from '@/features/diagram';
import { DIRECTION_LABEL } from '@/features/timetable';
import { selectNetwork, selectView, useAppStore } from '@/store';
import { withHidden } from './filters';

export function PatternList(): ReactElement {
  const network = useAppStore(selectNetwork);
  const view = useAppStore(selectView);
  const editProject = useAppStore((state) => state.editProject);

  const dashes = useMemo(
    () => (network === null ? null : assignPatternDashes(network.def.patterns)),
    [network],
  );

  // **回送のパターンは出さない。** 回送スジは営業便から展開された線であり
  // （§6.1.7）、パターンの絞り込みは保存されている便にしか掛からない——ここに
  // 並べても、押しても何も起きないチェックになる。回送の表示はまとめて 1 つの
  // 切替で行う（`DisplayFilters`）。時刻表がパターンの選択肢から回送を外して
  // いるのと同じ理由でもある（§6.1.4）。
  const patterns = useMemo(
    () => (network?.def.patterns ?? []).filter((pattern) => !pattern.isDeadhead),
    [network],
  );
  const hidden = view?.hiddenPatternIds ?? [];

  const toggle = (patternId: string, show: boolean): void => {
    editProject('パターンの表示の変更', (project) => {
      project.view.hiddenPatternIds = withHidden(
        project.view.hiddenPatternIds,
        patternId,
        show,
      ) as string[];
    });
  };

  return (
    <section className="panel__section">
      <h2 className="panel__title">停車パターン</h2>

      {patterns.length === 0 ? (
        <p className="panel__empty">読み込んでいます…</p>
      ) : (
        <ul className="panel__list">
          {patterns.map((pattern) => (
            <li key={pattern.patternId} className="panel__row">
              <input
                type="checkbox"
                aria-label={`${pattern.patternId} を表示`}
                checked={!hidden.includes(pattern.patternId)}
                onChange={(event) => {
                  toggle(pattern.patternId, event.target.checked);
                }}
              />
              <Swatch color={pattern.color} dash={dashes?.get(pattern.patternId) ?? []} />
              <span className="panel__id">{pattern.patternId}</span>
              <span className="panel__note">{pattern.patternName}</span>
              <span className="panel__count">{DIRECTION_LABEL[pattern.directionId]}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

interface SwatchProps {
  readonly color: string;
  readonly dash: readonly number[];
}

/** 色と線種の見本。ダイヤグラムに引かれる線と同じ姿にする。 */
function Swatch(props: SwatchProps): ReactElement {
  return (
    <svg className="panel__swatch" width="24" height="10" aria-hidden="true" focusable="false">
      <line
        x1="1"
        y1="5"
        x2="23"
        y2="5"
        stroke={props.color}
        strokeWidth="2"
        strokeDasharray={props.dash.length === 0 ? undefined : props.dash.join(' ')}
      />
    </svg>
  );
}
