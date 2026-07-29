/**
 * 時刻表に残る操作（仕様書 §6.1.4、T-52）。
 *
 * **便の操作はここに無い。** 追加も削除もずらすのもパターンの変更も、すべて
 * 升目の上で行う（§6.1.2）。操作列のボタンは「今どの列が選ばれているか」を
 * 利用者に覚えさせ、押した結果がどの列に出るのかは押すまで分からない。
 *
 * ここに残るのは、**升目の上に自然な置き場所が無いもの**だけである。本来の
 * 置き場所はメニューであり（T-37）、それができるまでの仮住まいとする。
 */

import type { ReactElement } from 'react';
import type { Service } from '@/domain/model';

export interface TimetableToolbarProps {
  readonly selectedCount: number;
  /** 写し先に選べるダイヤ（編集中のものを除く）。 */
  readonly otherServices: readonly Service[];
  readonly onSort: () => void;
  readonly onCopyTo: (serviceId: string) => void;
  /** 直前の操作について伝えること。無ければ `null`。 */
  readonly message: string | null;
}

export function TimetableToolbar(props: TimetableToolbarProps): ReactElement {
  const { selectedCount, otherServices, message } = props;
  const none = selectedCount === 0;

  return (
    <div className="timetable__toolbar" role="toolbar" aria-label="ダイヤの操作">
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
        {message ??
          (none ? '升目に時刻を打つと便ができます' : `${String(selectedCount)} 便を選択中`)}
      </span>
    </div>
  );
}
