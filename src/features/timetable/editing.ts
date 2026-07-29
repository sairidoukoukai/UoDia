/**
 * 升目の編集（仕様書 §6.1.2、T-20）。
 *
 * 画面から切り離して置く。**入力を受けてから便が変わるまで**に起きることは
 * 決まりごとの塊であり（丸め・アンカーの移動・表せる範囲）、React を立ち上げ
 * ずに固定できる形にしておきたい。
 *
 * ## 入力はアンカーの移し替えである
 *
 * どの升目に打ち込んでも、それは「この便の基準時刻をこの停留所にする」という
 * 意味になる（仕様書 §5.6）。前の基準は捨てられる。だから途中の停留所に時刻を
 * 入れると、始発を含む**同じ列のすべて**が計算し直される。
 */

import type { Trip } from '@/domain/model';
import type { NetworkIndex } from '@/domain/network';
import { parseTimeInput, type Seconds } from '@/domain/time';
import { setTimeAt } from '@/domain/trip';
import { columnCount, type Timetable } from './model';

/** 升目の位置。行は停留所、列は便。 */
export interface CellPosition {
  readonly row: number;
  readonly column: number;
}

export type Move = 'up' | 'down' | 'left' | 'right';

export interface GridSize {
  readonly rows: number;
  readonly columns: number;
}

const DELTA: Readonly<Record<Move, readonly [row: number, column: number]>> = {
  up: [-1, 0],
  down: [1, 0],
  left: [0, -1],
  right: [0, 1],
};

/**
 * 移動先の位置。端では止まる。
 *
 * 折り返さない。<kbd>Tab</kbd> で右端まで来たときに次の行の左端へ飛ぶと、
 * 打ち込んでいる列が変わったことに気づけない。時刻表は列（＝便）ごとに
 * 埋めていくものであり、行をまたぐ移動は利用者が意図して行うものとする。
 */
export function movePosition(at: CellPosition, move: Move, size: GridSize): CellPosition {
  const [dRow, dColumn] = DELTA[move];
  return {
    row: clamp(at.row + dRow, size.rows),
    column: clamp(at.column + dColumn, size.columns),
  };
}

function clamp(value: number, length: number): number {
  return Math.min(Math.max(value, 0), Math.max(length - 1, 0));
}

/**
 * 同じ行の左隣にある時刻。分だけの入力を補うのに使う（仕様書 §6.1.2）。
 *
 * 隣が経由しない便であれば、さらに左を見る。「直前の便」とは時刻の入っている
 * 便のことであり、間に挟まる `−` は数えない。
 */
export function previousTimeInRow(timetable: Timetable, at: CellPosition): Seconds | undefined {
  for (let column = at.column - 1; column >= 0; column--) {
    const cell = timetable.columns[column]?.cells[at.row];
    if (cell?.kind === 'time') return cell.time;
  }
  return undefined;
}

/** 入力を受け付けられなかった理由。 */
export type CommitFailure =
  /** その便は経由しない・参照が壊れている。 */
  | 'notEditable'
  /** 時刻として読めない。 */
  | 'unparsable'
  /** 読めたが、その便のどこかが 0:00〜47:55 に収まらない。 */
  | 'unrepresentable';

export type CommitOutcome =
  /** 既にある便の時刻を変える。 */
  | { readonly ok: true; readonly kind: 'update'; readonly trip: Trip; readonly rounded: boolean }
  /**
   * 空の列に打たれた。**この時刻でこの停留所を通る便を作る**（仕様書 §6.1.2）。
   *
   * 便そのものはここで作らない。便 ID の採番も経路の決定も、ダイヤ全体を知って
   * いる側の仕事である（`Timetable.tsx`）。ここが決めるのは「どの停留所の何時か」
   * までとする。
   */
  | {
      readonly ok: true;
      readonly kind: 'create';
      readonly stopId: string;
      readonly time: Seconds;
      readonly rounded: boolean;
    }
  | { readonly ok: false; readonly reason: CommitFailure }
  /** 何も打たれていない。取り消しと同じに扱う。 */
  | { readonly ok: false; readonly reason: null };

/**
 * 升目への入力を、便への変更に変える。
 *
 * **空の入力は取り消しとして扱う。** 時刻を消すのは <kbd>Delete</kbd> の役目で
 * あり（仕様書 §6.1.2）、何も打たずに確定したときに文句を言う理由がない。
 */
export function commitCellInput(
  timetable: Timetable,
  at: CellPosition,
  text: string,
  network: NetworkIndex,
): CommitOutcome {
  if (text.trim() === '') return { ok: false, reason: null };

  const stop = timetable.stops[at.row];
  if (stop === undefined || at.column >= columnCount(timetable)) {
    return { ok: false, reason: 'notEditable' };
  }

  const column = timetable.columns[at.column];
  if (column?.cells[at.row]?.kind === 'notServed') return { ok: false, reason: 'notEditable' };

  const parsed = parseTimeInput(text, previousTimeInRow(timetable, at));
  if (parsed === null) return { ok: false, reason: 'unparsable' };

  // 空の列。便がまだ無い（§6.1.1）。
  if (column === undefined) {
    return {
      ok: true,
      kind: 'create',
      stopId: stop.stopId,
      time: parsed.value,
      rounded: parsed.rounded,
    };
  }

  const trip = setTimeAt(column.trip, stop.stopId, parsed.value, network);
  // 表せる範囲を外れる。始発が 0:00 より前になる場合と、終着が 47:55 を超える
  // 場合の両方がここに来る。
  if (trip === null) return { ok: false, reason: 'unrepresentable' };

  return { ok: true, kind: 'update', trip, rounded: parsed.rounded };
}

/** 編集を始めるときに升目へ最初から入れておく文字列。 */
export function initialEditText(timetable: Timetable, at: CellPosition): string {
  const cell = timetable.columns[at.column]?.cells[at.row];
  return cell?.kind === 'time' ? formatForEdit(cell.time) : '';
}

/**
 * 編集欄に入れる形。表示と同じ `8:30` の形にする。
 *
 * `formatTime` を使わないのは、`domain/time` の整形が表示用であり、入力の
 * 解釈（`parseTimeInput`）と対になる保証が無いためである。ここで作る文字列は
 * **必ずそのまま読み直せる**必要がある。
 */
function formatForEdit(time: Seconds): string {
  const hours = Math.floor(time / 3600);
  const minutes = Math.floor((time % 3600) / 60);
  return `${String(hours)}:${String(minutes).padStart(2, '0')}`;
}
