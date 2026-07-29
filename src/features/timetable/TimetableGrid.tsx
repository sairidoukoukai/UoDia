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

import { useEffect, useRef, useState, type KeyboardEvent, type ReactElement } from 'react';
import type { StopPattern } from '@/domain/model';
import { formatTime } from '@/domain/time';
import {
  initialEditText,
  movePosition,
  type CellPosition,
  type CommitFailure,
  type Move,
} from './editing';
import {
  HANDLING_MARK,
  NOT_SERVED,
  type LinkCell,
  type Timetable,
  type TimetableCell,
  type TimetableColumn,
} from './model';

/** 入力を確定したときの結果。丸めが起きたか、なぜ受け付けられなかったか。 */
export type CommitResult =
  | { readonly ok: true; readonly rounded: boolean }
  | { readonly ok: false; readonly reason: CommitFailure | null };

export interface TimetableGridProps {
  readonly timetable: Timetable;
  /**
   * 升目の入力を確定する。
   *
   * 表そのものは書き換えない。書き換えるのはストアであり、その結果が
   * `timetable` として降りてくる。**同じ列の他の升目が計算し直されるのは、
   * この流れが 1 本しかないため**である（仕様書 §6.1.2）。
   */
  readonly onCommit: (at: CellPosition, text: string) => CommitResult;
  /** 選択中の便（仕様書 §6.3.1）。列見出しと升目の色に出す。 */
  readonly selectedTripIds: readonly string[];
  /**
   * 列見出しが押された。`additive` は <kbd>Ctrl</kbd> 等を伴う押下。
   *
   * 「選択を置き換える」か「加える」かの判断は呼び出し側に任せる。選択は
   * 編集ではなく、履歴にも載らない（`store/store.ts`）。
   */
  readonly onSelectTrip: (tripId: string, additive: boolean) => void;
  /** 列見出しの上で <kbd>Delete</kbd> が押された。 */
  readonly onRemoveSelection: () => void;
  /**
   * 運用番号ごとの色（仕様書 §6.1.3、§5.8）。未割当（空欄）は含まない。
   *
   * 色を決めるのは表ではない。運用は方向をまたぐため、片方向しか知らない
   * ここで割り当てると、同じ運用が方向によって違う色になる。
   */
  readonly blockColors: ReadonlyMap<string, string>;
  /** 運用番号が書き換えられた。 */
  readonly onChangeBlockId: (tripId: string, blockId: string) => void;
  /**
   * その方向で選べる停車パターン（仕様書 §6.1.4）。回送は含めない。
   *
   * パターン欄は一覧から選ぶ形にする。**存在しないパターンを打ち込めない**ため、
   * 受け付けられない入力そのものが起こらない。
   */
  readonly patterns: readonly StopPattern[];
  /** パターン欄で別のパターンが選ばれた。 */
  readonly onChangePattern: (tripId: string, patternId: string) => void;
  /**
   * 升目で <kbd>Delete</kbd> が押された（仕様書 §6.1.2）。
   *
   * 消えるのは**その便の時刻**である。便に時刻は 1 つしかないため、1 つの升目を
   * 消すことは列全体を消すことになる。便そのものを消すのは列見出しの
   * <kbd>Delete</kbd>（`onRemoveSelection`）。
   */
  readonly onClearTime: (tripId: string) => void;
  /**
   * 便を写す・切り取る・貼り付ける（仕様書 §8.1、T-53）。
   *
   * <kbd>Ctrl</kbd>+<kbd>C</kbd> / <kbd>X</kbd> / <kbd>V</kbd> を表の上で拾う。
   * 文字を打っている最中は拾わない——そこでのコピーは**文字のコピー**である。
   */
  readonly onCopy: () => void;
  readonly onCut: () => void;
  readonly onPaste: () => void;
  /**
   * 空の列の升目に時刻が確定された（仕様書 §6.1.1、§6.1.2）。
   *
   * ここで便ができる。「便を追加」という操作を持たないのは、表計算ソフトに
   * 「行を追加」ボタンが無いのと同じ理由である。
   */
  /**
   * 便番号（仕様書 §6.1.6）。**便は番号を持たない**ため、外から渡す。
   *
   * 表示中の方向だけで採番すると、方向をまたいで番号が重なる。採番はダイヤの
   * 全便から決める（`store/selectors.ts` の `selectTripNumbers`）。
   */
  readonly tripNumbers: ReadonlyMap<string, string>;
  /**
   * 前運用・後運用の欄が押された（仕様書 §6.1.7）。
   *
   * 押すと出区・入区が付き、もう一度押すと外れる。**時刻も経路も決めるものが
   * 無い**ため、切り替えだけで足りる（0 分折返し）。
   */
  readonly onTogglePullOut: (tripId: string) => void;
  readonly onTogglePullIn: (tripId: string) => void;
}

/** 丸めを知らせる点滅の長さ（ミリ秒）。 */
const FLASH_MS = 700;

/** 移動に使うキー。 */
const MOVE_KEYS: Readonly<Record<string, Move>> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
};

/** 編集中の升目。 */
interface Editing {
  readonly at: CellPosition;
  readonly text: string;
  /** 直前の確定が受け付けられなかったか。 */
  readonly failure: CommitFailure | null;
}

/** 便番号・運用番号が空のときに出す印。 */
const BLANK = '―';

/**
 * 空の列の升目（仕様書 §6.1.1）。
 *
 * 「まだ時刻が入っていない」として扱う。`notServed`（`−`）にしないのは、
 * 経由するともしないとも言えないためである——パターンはまだ決まっていない。
 */
const BLANK_CELL: TimetableCell = { kind: 'empty', handling: 'stop', reason: 'unset' };

export function TimetableGrid(props: TimetableGridProps): ReactElement {
  const { timetable, onCommit, selectedTripIds, blockColors, tripNumbers } = props;
  const { stops, columns } = timetable;
  /**
   * 描く列。便の右に**空の列**が続く（仕様書 §6.1.1）。
   *
   * `null` は便でない列である。打った時点でそれが便になるため、表は常に
   * 「打てる升目」で埋まっている。
   */
  const slots: readonly (TimetableColumn | null)[] = [
    ...columns,
    ...Array.from({ length: timetable.emptyColumns }, () => null),
  ];
  const size = { rows: stops.length, columns: slots.length };
  const selected = new Set(selectedTripIds);

  /**
   * 今その列を照らしている運用番号。空文字は「照らしていない」。
   *
   * 未割当（空欄）の便どうしを繋げてはならない（仕様書 §6.1.3）。空文字を
   * 「無し」に使えるのは、そのためにどのみち空欄を除外するからである。
   */
  const [highlightedBlockId, setHighlightedBlockId] = useState('');

  /** その列に付ける印。空の列は選ばれることも照らされることもない。 */
  const marks = (column: TimetableColumn | null): ColumnMarks => ({
    selected: column !== null && selected.has(column.trip.tripId),
    sameBlock:
      column !== null && highlightedBlockId !== '' && column.trip.blockId === highlightedBlockId,
  });

  const [focus, setFocus] = useState<CellPosition | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [flash, setFlash] = useState<CellPosition | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  /**
   * 利用者が表を触ったか。
   *
   * 触るまでは焦点を奪わない。読み込み直後に画面が勝手に表へ飛ぶのを防ぐ。
   * `document.activeElement` を見る形では駄目である。確定した直後は編集欄が
   * 外れて焦点が本体へ戻っており、**続けて打てるはずの場面で見失う**。
   */
  const interacting = useRef(false);

  // 移動と編集の終わりに、その升目へ焦点を移す。移さないと、確定した瞬間に
  // キーボード操作の起点が消える。
  useEffect(() => {
    if (focus === null || editing !== null || !interacting.current) return;
    const grid = gridRef.current;
    if (grid === null) return;
    cellElement(grid, focus)?.focus();
  }, [focus, editing]);

  // 丸めの点滅は一定時間で消す（仕様書 §6.1.2）。
  useEffect(() => {
    if (flash === null) return;
    const timer = setTimeout(() => {
      setFlash(null);
    }, FLASH_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [flash]);

  /** 編集を終える。確定できなければ編集状態を保ったまま警告する。 */
  const finish = (next: CellPosition | null): void => {
    if (editing === null) return;
    const result = onCommit(editing.at, editing.text);

    if (!result.ok && result.reason !== null) {
      // 入力を消さない。打ち直せる状態のまま、なぜ駄目かを色で示す。
      setEditing({ ...editing, failure: result.reason });
      return;
    }

    setEditing(null);
    if (result.ok && result.rounded) setFlash(editing.at);
    if (next !== null) setFocus(next);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>, at: CellPosition): void => {
    interacting.current = true;
    const move = MOVE_KEYS[event.key];

    if (editing !== null) {
      if (event.key === 'Escape') {
        event.preventDefault();
        setEditing(null);
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        finish(movePosition(at, 'down', size));
        return;
      }
      if (event.key === 'Tab') {
        event.preventDefault();
        finish(movePosition(at, event.shiftKey ? 'left' : 'right', size));
        return;
      }
      // 矢印キーは編集欄の中の移動に使う。升目の移動には使わない。
      return;
    }

    if (move !== undefined) {
      event.preventDefault();
      setFocus(movePosition(at, move, size));
      return;
    }
    if (event.key === 'Enter' || event.key === 'F2') {
      event.preventDefault();
      startEditing(at, initialEditText(timetable, at));
      return;
    }
    if (event.key === 'Tab') {
      event.preventDefault();
      setFocus(movePosition(at, event.shiftKey ? 'left' : 'right', size));
      return;
    }
    // 直接タイプで上書き入力を始める（表計算ソフトと同じ挙動）。
    if (isTypingKey(event)) {
      event.preventDefault();
      startEditing(at, event.key);
    }
  };

  const startEditing = (at: CellPosition, text: string): void => {
    interacting.current = true;
    // 経由しない升目には打てない。空の列（便がまだ無い）はどの行にも打てる。
    if (columns[at.column]?.cells[at.row]?.kind === 'notServed') return;
    setFocus(at);
    setEditing({ at, text, failure: null });
  };

  /** 表の上での <kbd>Ctrl</kbd>+<kbd>C</kbd> / <kbd>X</kbd> / <kbd>V</kbd>。 */
  const handleClipboard = (event: KeyboardEvent<HTMLElement>): void => {
    if (!event.ctrlKey && !event.metaKey) return;
    // 記入欄の中では文字のコピーである。表の操作として横取りしない。
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) {
      return;
    }

    const action = { c: props.onCopy, x: props.onCut, v: props.onPaste }[event.key.toLowerCase()];
    if (action === undefined) return;
    event.preventDefault();
    action();
  };

  return (
    <div className="timetable__scroll" ref={gridRef} onKeyDown={handleClipboard}>
      <table className="timetable">
        <thead>
          {/*
            見出しは 3 行（列見出し = 便番号・パターン・運用。仕様書 §6.1.1）。
            **列の位置を示す見出しは置かない。** 位置は便番号でも運用番号でも
            なく、並べ替えれば変わり、ダイヤグラムとも共有されない。同じ便が
            画面によって違う名前で呼ばれると、口頭でも文書でも指せなくなる。
          */}
          <tr>
            <th scope="col" className="timetable__corner">
              停留所
            </th>
            {slots.map((column, index) => (
              <th
                key={column?.trip.tripId ?? `empty-${String(index)}`}
                scope="col"
                className={columnClass(column?.pattern ?? null, marks(column))}
              >
                {/*
                  列見出しは押しボタンにする。便を選ぶ手立てがここしか無く、
                  <th> のままではキーボードで辿り着けない（仕様書 §9.4）。
                  空の列は便ではないため、選べない。
                */}
                {column !== null && (
                  <button
                    type="button"
                    className="timetable__column"
                    aria-pressed={selected.has(column.trip.tripId)}
                    onClick={(event) => {
                      props.onSelectTrip(
                        column.trip.tripId,
                        event.ctrlKey || event.metaKey || event.shiftKey,
                      );
                    }}
                    onKeyDown={(event) => {
                      if (event.key !== 'Delete' && event.key !== 'Backspace') return;
                      event.preventDefault();
                      props.onRemoveSelection();
                    }}
                  >
                    {tripNumbers.get(column.trip.tripId) ?? BLANK}
                  </button>
                )}
              </th>
            ))}
          </tr>
          <tr>
            <th scope="row">パターン</th>
            {slots.map((column, index) => (
              <td
                key={column?.trip.tripId ?? `empty-${String(index)}`}
                className={columnClass(column?.pattern ?? null, marks(column))}
                // 行先はパターンと 1 対 1 であり、行を割いて並べると同じことを
                // 2 度言うことになる（§6.1.1）。手掛かりとしてだけ残す。
                title={
                  column === null
                    ? undefined
                    : (column.pattern?.patternName ?? '参照が壊れています')
                }
              >
                {/*
                  パターンは一覧から選ぶ（仕様書 §6.1.4）。押せば一覧が出て、
                  キーを打てばその文字で選べる。**存在しないパターンは選べない。**
                  空の列には置かない——便は時刻を打つことで生まれる。
                */}
                {column !== null && (
                  <select
                    className="timetable__pattern"
                    value={column.trip.patternId}
                    aria-label={`${tripNumbers.get(column.trip.tripId) ?? BLANK}の停車パターン`}
                    onChange={(event) => {
                      props.onChangePattern(column.trip.tripId, event.target.value);
                    }}
                  >
                    {/*
                      参照が壊れている便のための項目。選ばせるためではなく、
                      今の値を偽らずに見せるために置く。
                    */}
                    {column.pattern === null && (
                      <option value={column.trip.patternId} disabled>
                        {column.trip.patternId}
                      </option>
                    )}
                    {/*
                      出すのはパターンの記号だけである。行先を併記すると列が
                      広がり、時刻の列が押し出される。行先は升目のツールチップで
                      読める（§6.1.1）。
                    */}
                    {props.patterns.map((pattern) => (
                      <option key={pattern.patternId} value={pattern.patternId}>
                        {pattern.patternId}
                      </option>
                    ))}
                  </select>
                )}
              </td>
            ))}
          </tr>
          <tr>
            <th scope="row">運用</th>
            {slots.map((column, index) => {
              const color = column === null ? undefined : blockColors.get(column.trip.blockId);
              return (
                <td
                  key={column?.trip.tripId ?? `empty-${String(index)}`}
                  className={columnClass(column?.pattern ?? null, marks(column))}
                  // 運用の色は運用番号の並びから決まるため、あらかじめ書けない
                  // （`domain/block/colors.ts`）。罫線ではなく内側の影で描くのは、
                  // 色の付いた列だけ行の高さが変わるのを避けるため。
                  style={
                    color === undefined ? undefined : { boxShadow: `inset 0 -0.25rem ${color}` }
                  }
                >
                  {column !== null && (
                    <input
                      className="timetable__block"
                      value={column.trip.blockId}
                      // 空欄は未割当（仕様書 §6.1.3）。何も入っていないことが
                      // 見えるよう、他の欄と同じ印を薄く出す。
                      placeholder={BLANK}
                      aria-label={`${String(index + 1)}便の運用番号`}
                      onChange={(event) => {
                        props.onChangeBlockId(column.trip.tripId, event.target.value);
                      }}
                      onFocus={() => {
                        setHighlightedBlockId(column.trip.blockId);
                      }}
                      onBlur={() => {
                        setHighlightedBlockId('');
                      }}
                    />
                  )}
                </td>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {/*
            前運用・後運用の行（仕様書 §6.1.7）。回送便を列にせず、ここに畳み込む。
            **前は必ず上端、後は必ず下端**にある。豊中方面では停留所の並びが逆に
            なるが（T-48）、時刻が上から下へ進むことは変わらないため、この位置は
            どちらのタブでも「手前」「その先」を指す。
          */}
          <LinkRow
            title="前運用"
            action="出区"
            columns={slots}
            cellOf={(column) => column.links.previous}
            marks={marks}
            numbers={tripNumbers}
            onToggle={props.onTogglePullOut}
          />
          {stops.map((stop, row) => (
            <tr key={stop.stopId}>
              <th scope="row" className="timetable__stop">
                {stop.stopName}
              </th>
              {slots.map((column, index) => {
                const at = { row, column: index };
                return (
                  <Cell
                    key={column?.trip.tripId ?? `empty-${String(index)}`}
                    // 空の列は打てる空欄にする。`−`（経由しない）は出さない
                    // ——パターンが決まっていない以上、経由するともしないとも
                    // 言えないためである（仕様書 §6.1.1）。
                    cell={column?.cells[row] ?? BLANK_CELL}
                    selected={marks(column).selected}
                    sameBlock={marks(column).sameBlock}
                    at={at}
                    focused={focus?.row === row && focus.column === index}
                    editing={
                      editing !== null && editing.at.row === row && editing.at.column === index
                        ? editing
                        : null
                    }
                    flashing={flash?.row === row && flash.column === index}
                    onFocusCell={(next) => {
                      interacting.current = true;
                      setFocus(next);
                    }}
                    onStartEditing={startEditing}
                    onChangeText={(text) => {
                      setEditing((current) =>
                        current === null ? null : { ...current, text, failure: null },
                      );
                    }}
                    onKeyDown={handleKeyDown}
                    onClear={() => {
                      if (column !== null) props.onClearTime(column.trip.tripId);
                    }}
                    onBlurInput={() => {
                      finish(null);
                    }}
                  />
                );
              })}
            </tr>
          ))}
          <LinkRow
            title="後運用"
            action="入区"
            columns={slots}
            cellOf={(column) => column.links.next}
            marks={marks}
            numbers={tripNumbers}
            onToggle={props.onTogglePullIn}
          />
        </tbody>
      </table>
    </div>
  );
}

interface LinkRowProps {
  readonly title: string;
  /** 押したときに切り替わるもの。押しボタンの説明に使う。 */
  readonly action: string;
  /** 描く列。`null` は空の列（便ではない）。 */
  readonly columns: readonly (TimetableColumn | null)[];
  readonly cellOf: (column: TimetableColumn) => LinkCell;
  readonly marks: (column: TimetableColumn | null) => ColumnMarks;
  readonly numbers: ReadonlyMap<string, string>;
  readonly onToggle: (tripId: string) => void;
}

/** 前運用・後運用の行（仕様書 §6.1.7）。 */
function LinkRow(props: LinkRowProps): ReactElement {
  return (
    <tr>
      <th scope="row" className="timetable__link-head">
        {props.title}
      </th>
      {props.columns.map((column, index) => {
        if (column === null) {
          // 空の列。便が無い以上、前も後も無い。
          return (
            <td
              key={`empty-${String(index)}`}
              className={linkClass(props.marks(column))}
              aria-hidden="true"
            />
          );
        }
        const cell = props.cellOf(column);
        const number = props.numbers.get(column.trip.tripId) ?? BLANK;
        return (
          <td key={column.trip.tripId} className={linkClass(props.marks(column))}>
            {/*
              **繋がる営業便が出ている欄も押せる。** 運用の途中で車庫へ帰る運用は
              そこから作る（仕様書 §6.1.7）。押した直後は繋がりが切れた状態に
              なるが、それは V-01 が伝える。
            */}
            <button
              type="button"
              className="timetable__link"
              aria-label={`${number}の${props.title}`}
              aria-pressed={cell.kind === 'depot' || cell.kind === 'depotUnresolvable'}
              title={`押すと${props.action}を付ける／外す`}
              onClick={() => {
                props.onToggle(column.trip.tripId);
              }}
            >
              {linkText(cell)}
            </button>
          </td>
        );
      })}
    </tr>
  );
}

/** 前運用・後運用の欄に出す文字。 */
function linkText(cell: LinkCell): string {
  if (cell.kind === 'depot') return formatTime(cell.time);
  // 時刻を出せないまま空欄にすると「押しても何も起きない」に見える。
  if (cell.kind === 'depotUnresolvable') return '!';
  if (cell.kind === 'trip') return cell.label;
  return '';
}

function linkClass(marks: ColumnMarks): string {
  const classes = ['timetable__link-cell'];
  if (marks.sameBlock) classes.push('timetable__cell--sameBlock');
  if (marks.selected) classes.push('timetable__cell--selected');
  return classes.join(' ');
}

interface CellProps {
  readonly cell: TimetableCell;
  readonly selected: boolean;
  readonly sameBlock: boolean;
  readonly at: CellPosition;
  readonly focused: boolean;
  readonly editing: Editing | null;
  readonly flashing: boolean;
  readonly onFocusCell: (at: CellPosition) => void;
  readonly onStartEditing: (at: CellPosition, text: string) => void;
  readonly onChangeText: (text: string) => void;
  readonly onKeyDown: (event: KeyboardEvent<HTMLElement>, at: CellPosition) => void;
  /** その升目で <kbd>Delete</kbd> が押された。 */
  readonly onClear: () => void;
  readonly onBlurInput: () => void;
}

function Cell(props: CellProps): ReactElement {
  const { cell, selected, sameBlock, at, focused, editing, flashing } = props;

  const classes = ['timetable__cell'];
  if (sameBlock) classes.push('timetable__cell--sameBlock');
  if (selected) classes.push('timetable__cell--selected');
  if (flashing) classes.push('timetable__cell--rounded');
  if (editing?.failure != null) classes.push('timetable__cell--invalid');
  if (cell.kind === 'notServed') classes.push('timetable__cell--notServed');
  if (cell.kind === 'empty') classes.push('timetable__cell--empty');
  if (cell.kind === 'time' && cell.isAnchor) classes.push('timetable__cell--anchor');

  return (
    <td
      className={classes.join(' ')}
      data-cell={`${String(at.row)}:${String(at.column)}`}
      // 焦点を持てる升目を 1 つに絞る。表全体が Tab の順路になると、表を
      // 通り抜けるだけで 100 回以上 Tab を押すことになる。
      tabIndex={focused ? 0 : -1}
      aria-label={describe(cell)}
      onMouseDown={(event) => {
        props.onFocusCell(at);
        // 明示的に焦点を移す。押しボタン以外の要素を押しても焦点が移らない
        // ブラウザがあり、任せると環境によって挙動が変わる。
        event.currentTarget.focus();
      }}
      onDoubleClick={() => {
        props.onStartEditing(at, '');
      }}
      onKeyDown={(event) => {
        // 時刻を消す（仕様書 §6.1.2）。編集中は編集欄の中の消去に使うため、
        // ここでは拾わない。
        if (editing === null && (event.key === 'Delete' || event.key === 'Backspace')) {
          event.preventDefault();
          props.onClear();
          return;
        }
        props.onKeyDown(event, at);
      }}
    >
      {editing === null ? (
        content(cell)
      ) : (
        <input
          className="timetable__input"
          value={editing.text}
          autoFocus
          aria-label="時刻"
          aria-invalid={editing.failure !== null}
          onChange={(event) => {
            props.onChangeText(event.target.value);
          }}
          onBlur={props.onBlurInput}
        />
      )}
    </td>
  );
}

/** 升目に出す文字。 */
function content(cell: TimetableCell): string {
  // 経由しないことを空欄で表さない。空欄は「まだ入れていない」に見える。
  if (cell.kind === 'notServed') return NOT_SERVED;
  if (cell.kind === 'empty') return HANDLING_MARK[cell.handling];
  return `${HANDLING_MARK[cell.handling]}${formatTime(cell.time)}`;
}

/** 画面読み上げに升目の意味を伝える。 */
function describe(cell: TimetableCell): string | undefined {
  if (cell.kind === 'notServed') return '経由しません';
  if (cell.kind === 'empty') {
    return cell.reason === 'unset' ? '時刻が未入力です' : '時刻を計算できません';
  }
  return undefined;
}

/** その打鍵で上書き入力を始めてよいか。 */
function isTypingKey(event: KeyboardEvent<HTMLElement>): boolean {
  if (event.ctrlKey || event.altKey || event.metaKey) return false;
  // 1 文字のキーだけを見る。Shift や CapsLock のような修飾は key が長い。
  return event.key.length === 1;
}

/** 位置から升目の要素を引く。 */
function cellElement(grid: HTMLElement, at: CellPosition): HTMLElement | null {
  return grid.querySelector<HTMLElement>(`[data-cell="${String(at.row)}:${String(at.column)}"]`);
}

/** 列に付ける印。 */
interface ColumnMarks {
  readonly selected: boolean;
  /** 今照らしている運用番号と同じ便か（仕様書 §6.1.3）。 */
  readonly sameBlock: boolean;
}

/**
 * 参照が壊れている列を見分けられるようにする。
 *
 * 回送便の列を区別する必要は無い。**列になるのは営業便だけ**である（§6.1.7）。
 */
function columnClass(pattern: StopPattern | null, marks: ColumnMarks): string {
  const classes = ['timetable__head'];
  if (pattern === null) classes.push('timetable__head--broken');
  if (marks.sameBlock) classes.push('timetable__head--sameBlock');
  if (marks.selected) classes.push('timetable__head--selected');
  return classes.join(' ');
}
