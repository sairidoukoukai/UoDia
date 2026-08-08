/**
 * カレンダータブ（#197、仕様書 v2 §4.5、T-73）。
 *
 * ## 事業者・停留所タブと作りが違う
 *
 * あちらは `route.json` を書き換えるため、**適用ボタンを押すまで状態に触れない**。
 * こちらが触るのはプロジェクト（`Service.calendar`）であり、**打った時点で履歴に
 * 載せる**（§4.5.1）。戻す手立てが <kbd>Ctrl</kbd>+<kbd>Z</kbd> にあるのだから、
 * 適用を挟む理由が無い。
 *
 * ## 積むのは 1 回だけ
 *
 * ドラッグしている最中は積まない。積むのは**指を離したとき**である。積み方を
 * 誤ると、範囲を 1 つ引くのに 30 回の取り消しが要る。
 */

import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { serviceDates } from '@/domain/calendar';
import { WEEKDAYS, type CalendarDate, type ServiceCalendar } from '@/domain/model';
import { useAppStore } from '@/store';
import {
  addClosedRange,
  defaultCalendar,
  formatRange,
  removeClosedRange,
  replaceClosedRange,
  setPeriod,
  toggleWeekday,
} from './calendarEdits';
import { clampMonth, monthGrid, monthOf, shiftMonth, WEEKDAY_LABEL } from './monthGrid';

/** 今日。**引数で受け取れるようにしておく**（検証で日付を固定するため）。 */
export interface CalendarTabProps {
  readonly today?: CalendarDate;
}

export function CalendarTab(props: CalendarTabProps): ReactElement {
  const services = useAppStore((state) => state.project?.services);
  const editProject = useAppStore((state) => state.editProject);
  const [serviceId, setServiceId] = useState<string | null>(null);

  const service = useMemo(() => {
    if (services === undefined || services.length === 0) return null;
    return services.find((s) => s.serviceId === serviceId) ?? services[0] ?? null;
  }, [services, serviceId]);

  if (service === null) {
    return (
      <section className="settings__panel">
        <p className="settings__note">ダイヤがありません。</p>
      </section>
    );
  }

  /** カレンダーを 1 回の編集で置き換える。**履歴に 1 段だけ積む。** */
  const update = (label: string, next: ServiceCalendar): void => {
    editProject(label, (project) => {
      const target = project.services.find((s) => s.serviceId === service.serviceId);
      if (target !== undefined) target.calendar = next;
    });
  };

  return (
    <section className="settings__panel">
      <label className="gtfs__field">
        <span>ダイヤ</span>
        <select
          aria-label="運行日を決めるダイヤ"
          value={service.serviceId}
          onChange={(event) => {
            setServiceId(event.target.value);
          }}
        >
          {(services ?? []).map((entry) => (
            <option key={entry.serviceId} value={entry.serviceId}>
              {entry.serviceName}
            </option>
          ))}
        </select>
      </label>

      {service.calendar === undefined ? (
        <NoCalendar
          onCreate={() => {
            update(
              '運行日を設定',
              defaultCalendar(props.today ?? new Date().toISOString().slice(0, 10)),
            );
          }}
        />
      ) : (
        <CalendarEditor calendar={service.calendar} onChange={update} />
      )}
    </section>
  );
}

/** まだ運行日を持たないダイヤ。**空白を出さず、作る手立てを置く。** */
function NoCalendar(props: { readonly onCreate: () => void }): ReactElement {
  return (
    <>
      <p className="settings__note">
        このダイヤは運行日を持っていません。持たないままでも編集はできますが、GTFS
        は書き出せません。
      </p>
      <div className="settings__panel-actions">
        <button type="button" onClick={props.onCreate}>
          運行日を設定する
        </button>
      </div>
    </>
  );
}

interface CalendarEditorProps {
  readonly calendar: ServiceCalendar;
  readonly onChange: (label: string, next: ServiceCalendar) => void;
}

function CalendarEditor(props: CalendarEditorProps): ReactElement {
  const { calendar } = props;
  const [month, setMonth] = useState(() => monthOf(calendar.startDate));
  /** ドラッグの起点。掴んでいなければ `null`。 */
  const [anchor, setAnchor] = useState<CalendarDate | null>(null);
  /** いま指が乗っている日。**引いている範囲を描くために持つ。** */
  const [hover, setHover] = useState<CalendarDate | null>(null);

  const shown = clampMonth(month, calendar);
  const grid = useMemo(() => monthGrid(calendar, shown), [calendar, shown]);
  const runningDays = useMemo(() => serviceDates(calendar).length, [calendar]);

  const canGoBack = shown > monthOf(calendar.startDate);
  const canGoForward = shown < monthOf(calendar.endDate);

  /** 引いている最中の範囲に入っているか。 */
  const inDrag = (date: CalendarDate): boolean => {
    if (anchor === null || hover === null) return false;
    const [from, to] = anchor <= hover ? [anchor, hover] : [hover, anchor];
    return from <= date && date <= to;
  };

  /*
   * **指を離すのは窓で受ける。**
   *
   * 升目の上で受けると、離した場所が押しボタンとは限らないぶんだけ取りこぼす
   * ——`disabled` な升目の上、表の外、窓の外。取りこぼすと掴んだ状態が残り、
   * **次に押した日で範囲が引かれる**（掴んだ覚えの無いところから伸びる）。
   *
   * 引く先は最後に指が乗っていた日（`hover`）である。**画面で光っていた範囲が
   * そのまま入る**——見えていたものと違う範囲が入っては、引き直すたびに結果を
   * 確かめることになる。
   */
  useEffect(() => {
    if (anchor === null) return;

    const release = (): void => {
      const end = hover ?? anchor;
      setAnchor(null);
      setHover(null);
      props.onChange('運行なしの期間を追加', addClosedRange(calendar, anchor, end));
    };

    window.addEventListener('pointerup', release);
    return () => {
      window.removeEventListener('pointerup', release);
    };
  }, [anchor, hover, calendar, props]);

  return (
    <>
      <div className="gtfs__period">
        <label className="gtfs__field">
          <span>有効期間</span>
          <input
            type="date"
            aria-label="有効期間の開始日"
            value={calendar.startDate}
            onChange={(event) => {
              props.onChange(
                '有効期間の変更',
                setPeriod(calendar, event.target.value, calendar.endDate),
              );
            }}
          />
        </label>
        <label className="gtfs__field">
          <span>〜</span>
          <input
            type="date"
            aria-label="有効期間の終了日"
            value={calendar.endDate}
            onChange={(event) => {
              props.onChange(
                '有効期間の変更',
                setPeriod(calendar, calendar.startDate, event.target.value),
              );
            }}
          />
        </label>
      </div>

      <fieldset className="gtfs__weekdays">
        <legend>走る曜日</legend>
        {WEEKDAYS.map((weekday) => {
          const checked = calendar.weekdays.includes(weekday);
          // 最後の 1 つは外せない（`toggleWeekday`）。押せないことを見せる。
          const last = checked && calendar.weekdays.length === 1;
          return (
            <label key={weekday}>
              <input
                type="checkbox"
                checked={checked}
                disabled={last}
                onChange={() => {
                  props.onChange('走る曜日の変更', toggleWeekday(calendar, weekday));
                }}
              />
              {WEEKDAY_LABEL[weekday]}
            </label>
          );
        })}
      </fieldset>

      <div className="gtfs__month">
        <button
          type="button"
          disabled={!canGoBack}
          aria-label="前の月"
          onClick={() => {
            setMonth(shiftMonth(shown, -1));
          }}
        >
          ‹
        </button>
        <span>
          {grid.year} 年 {grid.monthNumber} 月
        </span>
        <button
          type="button"
          disabled={!canGoForward}
          aria-label="次の月"
          onClick={() => {
            setMonth(shiftMonth(shown, 1));
          }}
        >
          ›
        </button>
      </div>

      <table className="gtfs__calendar">
        <thead>
          <tr>
            {WEEKDAYS.map((weekday) => (
              <th key={weekday} scope="col">
                {WEEKDAY_LABEL[weekday]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {grid.weeks.map((week) => (
            <tr key={week[0]?.date ?? ''}>
              {week.map((cell) => {
                // 掴めるのは「走る日」と「運行なしの日」だけである。曜日で
                // 外れている日と期間の外は、範囲を足しても何も変わらない。
                const selectable = cell.kind === 'runs' || cell.kind === 'closed';
                return (
                  <td key={cell.date}>
                    <button
                      type="button"
                      className={[
                        'gtfs__day',
                        `gtfs__day--${cell.kind}`,
                        cell.inMonth ? '' : 'gtfs__day--other',
                        inDrag(cell.date) ? 'gtfs__day--dragging' : '',
                      ]
                        .filter((name) => name !== '')
                        .join(' ')}
                      disabled={!selectable}
                      aria-label={`${cell.date}（${KIND_LABEL[cell.kind]}）`}
                      onPointerDown={() => {
                        setAnchor(cell.date);
                        setHover(cell.date);
                      }}
                      /*
                        **指の行き先は `pointermove` で追う。** `pointerenter` は
                        升目ごとに 1 回しか来ず、掴んだあとに戻ってきた升目を
                        取りこぼす。**同じ日なら書き込まない**——`pointermove` は
                        1 升の上でも何度も来るため、そのたびに描き直すことになる。
                      */
                      onPointerMove={() => {
                        if (anchor !== null && hover !== cell.date) setHover(cell.date);
                      }}
                      /*
                        **キーボードだけで範囲を足せる**（§9.4）。押すたびに
                        1 日ぶんの範囲を作る——掴んで引く操作は鍵盤に無い。
                      */
                      onKeyDown={(event) => {
                        if (event.key !== 'Enter' && event.key !== ' ') return;
                        event.preventDefault();
                        props.onChange(
                          '運行なしの期間を追加',
                          addClosedRange(calendar, cell.date, cell.date),
                        );
                      }}
                    >
                      {cell.day}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>

      <p className="settings__note" role="status">
        走る日は {runningDays} 日です。
      </p>

      <ClosedRanges calendar={calendar} onChange={props.onChange} />
    </>
  );
}

const KIND_LABEL = {
  runs: '運行',
  offWeekday: '走らない曜日',
  closed: '運行なし',
  outside: '期間の外',
} as const;

interface ClosedRangesProps {
  readonly calendar: ServiceCalendar;
  readonly onChange: (label: string, next: ServiceCalendar) => void;
}

/** 運行なしの期間の一覧。**カレンダーからも、ここからも打てる。** */
function ClosedRanges(props: ClosedRangesProps): ReactElement {
  const { calendar } = props;

  return (
    <div className="gtfs__ranges">
      <h3>運行なしの期間</h3>
      {calendar.closedRanges.length === 0 ? (
        <p className="settings__note">
          ありません。カレンダーの上を引くか、下のボタンで足してください。
        </p>
      ) : (
        <ul>
          {calendar.closedRanges.map((range, index) => (
            <li key={`${range.from}-${range.to}-${String(index)}`}>
              <span className="gtfs__range-dates">{formatRange(range)}</span>
              <input
                type="text"
                aria-label={`${formatRange(range)}の注記`}
                placeholder="夏季休業 など"
                value={range.note ?? ''}
                onChange={(event) => {
                  const note = event.target.value;
                  props.onChange(
                    '注記の変更',
                    replaceClosedRange(calendar, index, {
                      from: range.from,
                      to: range.to,
                      ...(note === '' ? {} : { note }),
                    }),
                  );
                }}
              />
              <button
                type="button"
                aria-label={`${formatRange(range)}を削除`}
                onClick={() => {
                  props.onChange('運行なしの期間を削除', removeClosedRange(calendar, index));
                }}
              >
                削除
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="settings__panel-actions">
        <button
          type="button"
          onClick={() => {
            props.onChange(
              '運行なしの期間を追加',
              addClosedRange(calendar, calendar.startDate, calendar.startDate),
            );
          }}
        >
          範囲を足す
        </button>
      </div>
    </div>
  );
}
