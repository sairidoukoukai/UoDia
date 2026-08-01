/**
 * 検証パネル（仕様書 §6.6、§6.4、T-34）。
 *
 * 画面の下に置き、**折りたたんでも件数は見えるようにする。** 閉じているあいだに
 * エラーが増えても気づけないのでは、畳む意味が「見ないことにする」になる。
 *
 * ## 直したくなる形で出す
 *
 * 指摘は押せる。押すと**その便が選ばれ、時刻表とダイヤグラムがそこへ寄る**
 * （`jumpTargetOf`）。指摘を読んでから自力で探し当てる手間は、直す手間より
 * 大きいことがある。
 */

import { useMemo, useState, type ReactElement } from 'react';
import type { Severity, ValidationIssue } from '@/domain/validation';
import { selectNetwork, selectTrips, selectView, useAppStore } from '@/store';
import { jumpTargetOf, scrollTimeFor } from './jump';
import {
  SEVERITY_LABEL,
  SEVERITY_MARK,
  SEVERITY_ORDER,
  countBySeverity,
  shownIssues,
} from './severity';
import { useValidationIssues } from './useValidationIssues';

/** 一度に並べる上限。これを超えたら件数だけ伝える。 */
const MAX_ROWS = 200;

export function ValidationPanel(): ReactElement {
  const issues = useValidationIssues();
  const trips = useAppStore(selectTrips);
  const network = useAppStore(selectNetwork);
  const open = useAppStore((state) => selectView(state)?.validationPanelOpen ?? true);
  const setOpen = useAppStore((state) => state.setValidationPanelOpen);
  const setSelection = useAppStore((state) => state.selectTrips);
  const setDiagramView = useAppStore((state) => state.setDiagramView);
  const editProject = useAppStore((state) => state.editProject);

  // 重大度の絞り込みは**保存しない**。今この瞬間どれを眺めたいか、という話で
  // あり、開き直したときに情報が隠れたままだと「指摘が出ない」と受け取られる。
  const [shown, setShown] = useState<ReadonlySet<Severity>>(() => new Set(SEVERITY_ORDER));

  const counts = useMemo(() => countBySeverity(issues), [issues]);
  const rows = useMemo(() => shownIssues(issues, shown), [issues, shown]);

  /** 指摘の指す場所へ飛ぶ。選択・方向・送りを一度に動かす。 */
  const jump = (issue: ValidationIssue): void => {
    if (network === null) return;
    const target = jumpTargetOf(issue, trips, network);
    if (target.tripIds.length === 0) return;

    // 方向を先に切り替える。あとにすると、時刻表側の切り替えが選択を解く。
    const { directionId } = target;
    if (directionId !== null) {
      editProject('方向の切り替え', (project) => {
        project.view.activeDirection = directionId;
      });
    }
    setSelection(target.tripIds);

    if (target.time !== null) {
      const view = useAppStore.getState().project?.view.diagram;
      if (view !== undefined) {
        setDiagramView({ ...view, scrollTime: scrollTimeFor(target.time) });
      }
    }
  };

  const toggleSeverity = (severity: Severity): void => {
    setShown((current) => {
      const next = new Set(current);
      if (next.has(severity)) next.delete(severity);
      else next.add(severity);
      return next;
    });
  };

  return (
    <section className={open ? 'validation validation--open' : 'validation'} aria-label="検証">
      <div className="validation__bar">
        <button
          type="button"
          className="validation__toggle"
          aria-expanded={open}
          onClick={() => {
            setOpen(!open);
          }}
        >
          {open ? '▼' : '▶'} 検証
        </button>

        {/*
          **畳んでいても件数は出す。** 閉じているあいだに増えたエラーに
          気づけないのでは、畳むことが「見ないことにする」になる。
        */}
        {SEVERITY_ORDER.map((severity) => (
          <span
            key={severity}
            className={`validation__count validation__count--${severity}`}
            aria-label={`${SEVERITY_LABEL[severity]} ${String(counts[severity])} 件`}
          >
            {SEVERITY_MARK[severity]} {counts[severity]}
          </span>
        ))}

        {/* **0 件はそう言う**（受入条件）。空欄は「まだ検証していない」に見える。 */}
        <span className="validation__summary" role="status">
          {counts.error === 0
            ? 'エラーはありません'
            : `エラーが ${String(counts.error)} 件あります`}
        </span>

        {open && (
          <span className="validation__filters">
            {SEVERITY_ORDER.map((severity) => (
              <label key={severity}>
                <input
                  type="checkbox"
                  checked={shown.has(severity)}
                  onChange={() => {
                    toggleSeverity(severity);
                  }}
                />{' '}
                {SEVERITY_LABEL[severity]}
              </label>
            ))}
          </span>
        )}
      </div>

      {open && (
        <ul className="validation__list">
          {/*
            **無いのか、隠しているのかを言い分ける。** 絞り込みで消えているのに
            「指摘はありません」と出ると、直すべきものが無いと受け取られる。
          */}
          {rows.length === 0 && (
            <li className="validation__empty">
              {issues.length === 0 ? '指摘はありません' : '選んだ重大度の指摘はありません'}
            </li>
          )}

          {rows.slice(0, MAX_ROWS).map((issue, index) => (
            <li
              key={`${issue.id}-${issue.target.tripId ?? issue.target.blockId ?? ''}-${String(index)}`}
            >
              <button
                type="button"
                className={`validation__item validation__item--${issue.severity}`}
                onClick={() => {
                  jump(issue);
                }}
              >
                <span className="validation__mark" aria-hidden="true">
                  {SEVERITY_MARK[issue.severity]}
                </span>
                <span className="validation__id">{issue.id}</span>
                <span className="validation__message">{issue.message}</span>
              </button>
            </li>
          ))}

          {rows.length > MAX_ROWS && (
            <li className="validation__empty">
              ほかに {rows.length - MAX_ROWS} 件（絞り込んで見てください）
            </li>
          )}
        </ul>
      )}
    </section>
  );
}
