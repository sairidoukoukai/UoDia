/**
 * 時刻表グリッドの描画（仕様書 §6.1.1、T-19）。
 *
 * `<table>` をそのまま使う。行が停留所・列が便という構造そのものが表であり、
 * 画面読み上げに見出しの対応（`scope`）を伝えられる。`div` で組み直すと、
 * その対応を自前で書き足すことになる（仕様書 §9.4）。
 *
 * 停留所名の列は横スクロールしても残す（`position: sticky`）。列が 100 本並ぶと、
 * 右のほうを見たときに「これが何駅の行か」が分からなくなる。
 *
 * 100 便でも素直に全部描く。1 日 100 便・停留所 5 行で 500 升であり、間引く
 * 仕掛けを入れるほどの量ではない。実測は T-40 で行う。
 */

import type { ReactElement } from 'react';
import { formatTime } from '@/domain/time';
import { HANDLING_MARK, NOT_SERVED, type Timetable, type TimetableCell } from './model';

export interface TimetableGridProps {
  readonly timetable: Timetable;
}

/** 便番号・運用番号が空のときに出す印。 */
const BLANK = '―';

export function TimetableGrid({ timetable }: TimetableGridProps): ReactElement {
  const { stops, columns } = timetable;

  if (columns.length === 0) {
    return <p className="timetable__empty">この方向の便はまだありません。</p>;
  }

  return (
    <div className="timetable__scroll">
      <table className="timetable">
        <thead>
          <tr>
            <th scope="col" className="timetable__corner">
              停留所
            </th>
            {columns.map((column, index) => (
              <th key={column.trip.tripId} scope="col" className={columnClass(column.pattern)}>
                {index + 1}便
                {column.pattern?.isDeadhead === true && (
                  <span className="timetable__badge">回送</span>
                )}
              </th>
            ))}
          </tr>
          {/*
            見出しは 4 行（パターン・行先・便番号・運用）。回送便は行先の代わりに
            「回送」と出し、列の色でも分かるようにする。
          */}
          <tr>
            <th scope="row">パターン</th>
            {columns.map((column) => (
              <td key={column.trip.tripId} className={columnClass(column.pattern)}>
                {column.trip.patternId}
              </td>
            ))}
          </tr>
          <tr>
            <th scope="row">行先</th>
            {columns.map((column) => (
              <td key={column.trip.tripId} className={columnClass(column.pattern)}>
                {column.pattern === null ? '？' : column.pattern.patternName}
              </td>
            ))}
          </tr>
          <tr>
            <th scope="row">便番号</th>
            {columns.map((column) => (
              <td key={column.trip.tripId} className={columnClass(column.pattern)}>
                {column.trip.tripShortName === '' ? BLANK : column.trip.tripShortName}
              </td>
            ))}
          </tr>
          <tr>
            <th scope="row">運用</th>
            {columns.map((column) => (
              <td key={column.trip.tripId} className={columnClass(column.pattern)}>
                {column.trip.blockId === '' ? BLANK : column.trip.blockId}
              </td>
            ))}
          </tr>
        </thead>
        <tbody>
          {stops.map((stop, row) => (
            <tr key={stop.stopId}>
              <th scope="row" className="timetable__stop">
                {stop.stopName}
              </th>
              {columns.map((column) => (
                <Cell
                  key={column.trip.tripId}
                  cell={column.cells[row] ?? { kind: 'notServed' }}
                  deadhead={column.pattern?.isDeadhead === true}
                />
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Cell({
  cell,
  deadhead,
}: {
  readonly cell: TimetableCell;
  readonly deadhead: boolean;
}): ReactElement {
  const base = deadhead ? 'timetable__cell timetable__cell--deadhead' : 'timetable__cell';

  if (cell.kind === 'notServed') {
    // 経由しないことを空欄で表さない。空欄は「まだ入れていない」に見える。
    return (
      <td className={`${base} timetable__cell--notServed`} aria-label="経由しません">
        {NOT_SERVED}
      </td>
    );
  }

  const mark = HANDLING_MARK[cell.handling];

  if (cell.kind === 'empty') {
    return (
      <td
        className={`${base} timetable__cell--empty`}
        aria-label={cell.reason === 'unset' ? '時刻が未入力です' : '時刻を計算できません'}
      >
        {mark}
      </td>
    );
  }

  return (
    <td className={cell.isAnchor ? `${base} timetable__cell--anchor` : base}>
      {mark}
      {formatTime(cell.time)}
    </td>
  );
}

/** 回送便の列と、参照が壊れている列を見分けられるようにする。 */
function columnClass(pattern: { readonly isDeadhead: boolean } | null): string {
  if (pattern === null) return 'timetable__head timetable__head--broken';
  return pattern.isDeadhead ? 'timetable__head timetable__head--deadhead' : 'timetable__head';
}
