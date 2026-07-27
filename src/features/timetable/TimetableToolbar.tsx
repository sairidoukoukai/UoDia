/**
 * 便の操作の操作列（仕様書 §6.1.4、T-21）。
 *
 * ここは**押しボタンだけ**を持つ。何が起こるかは呼び出し側（`Timetable.tsx`）が
 * 決め、できなかったときの言葉も渡される。表と同じく、React を通さずに
 * 確かめられる部分（`domain/service/operations.ts`）を外へ出しておくためである。
 *
 * ## 選択が要る操作は、選択が無ければ押せない
 *
 * 押せてしまうと「押したのに何も起きない」が起き、利用者は原因を探すことに
 * なる。押せないことが理由の説明を兼ねる（仕様書 §9.4）。
 */

import { useState, type ReactElement } from 'react';
import type { Service, StopPattern } from '@/domain/model';
import { GRAIN_MINUTES } from '@/domain/service';

export interface TimetableToolbarProps {
  readonly selectedCount: number;
  /** 選択中の便が全て同じパターンならその ID。混ざっていれば空文字。 */
  readonly selectedPatternId: string;
  /** その方向で選べるパターン。 */
  readonly patterns: readonly StopPattern[];
  /** 写し先に選べるダイヤ（編集中のものを除く）。 */
  readonly otherServices: readonly Service[];
  readonly onAdd: () => void;
  readonly onDuplicate: (minutes: number) => void;
  readonly onRemove: () => void;
  readonly onChangePattern: (patternId: string) => void;
  readonly onShift: (minutes: number) => void;
  readonly onSort: () => void;
  readonly onCopyTo: (serviceId: string) => void;
  /** 直前の操作について伝えること。無ければ `null`。 */
  readonly message: string | null;
}

/** 複製・シフトの既定の分数。5 分格子の 1 目盛り。 */
const DEFAULT_SHIFT = GRAIN_MINUTES;

export function TimetableToolbar(props: TimetableToolbarProps): ReactElement {
  const { selectedCount, selectedPatternId, patterns, otherServices, message } = props;
  const [minutes, setMinutes] = useState(DEFAULT_SHIFT);
  const none = selectedCount === 0;

  return (
    <div className="timetable__toolbar" role="toolbar" aria-label="便の操作">
      <button type="button" onClick={props.onAdd}>
        便を追加
      </button>

      <span className="timetable__toolbar-group">
        <label>
          分{' '}
          <input
            type="number"
            className="timetable__minutes"
            step={GRAIN_MINUTES}
            value={minutes}
            aria-label="ずらす分"
            onChange={(event) => {
              setMinutes(Number(event.target.value));
            }}
          />
        </label>
        <button
          type="button"
          disabled={none}
          onClick={() => {
            props.onDuplicate(minutes);
          }}
        >
          複製
        </button>
        <button
          type="button"
          disabled={none}
          onClick={() => {
            props.onShift(minutes);
          }}
        >
          ずらす
        </button>
      </span>

      <button type="button" disabled={none} onClick={props.onRemove}>
        削除
      </button>

      <label>
        パターン{' '}
        <select
          value={selectedPatternId}
          disabled={none}
          aria-label="停車パターン"
          onChange={(event) => {
            props.onChangePattern(event.target.value);
          }}
        >
          {/*
            選択が混ざっているときに出す空の項目。選ぶための項目ではないため
            選べないようにする。value を空にできないと、混在を「先頭の
            パターン」と偽って表示することになる。
          */}
          <option value="" disabled>
            —
          </option>
          {patterns.map((pattern) => (
            <option key={pattern.patternId} value={pattern.patternId}>
              {pattern.patternId}（{pattern.patternName}）
            </option>
          ))}
        </select>
      </label>

      <button type="button" onClick={props.onSort}>
        始発時刻順に並べ替え
      </button>

      {/* 写し先が無いときは出さない。押せない操作を並べても場所を取るだけである。 */}
      {otherServices.length > 0 && (
        <label>
          別のダイヤへ複製{' '}
          <select
            value=""
            disabled={none}
            aria-label="複製先のダイヤ"
            onChange={(event) => {
              props.onCopyTo(event.target.value);
            }}
          >
            <option value="" disabled>
              選ぶ
            </option>
            {otherServices.map((service) => (
              <option key={service.serviceId} value={service.serviceId}>
                {service.serviceName}
              </option>
            ))}
          </select>
        </label>
      )}

      <span className="timetable__toolbar-status" role="status">
        {message ?? (none ? '便を選ぶと操作できます' : `${String(selectedCount)} 便を選択中`)}
      </span>
    </div>
  );
}
