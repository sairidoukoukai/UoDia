/**
 * 時刻表に残る操作（仕様書 §6.1.4、T-52）。
 *
 * **便の操作はここに無い。** 追加も削除もずらすのもパターンの変更も、すべて
 * 升目の上で行う（§6.1.2）。操作列のボタンは「今どの列が選ばれているか」を
 * 利用者に覚えさせ、押した結果がどの列に出るのかは押すまで分からない。
 *
 * ここに残るのは、**升目の上に自然な置き場所が無いもの**だけである。本来の
 * 置き場所はメニューであり（T-37）、それができるまでの仮住まいとする。
 *
 * 並べ替えと、直前の操作の知らせは方向タブと同じ行へ移した（`Timetable`）。
 * **行を 1 本増やすたびに、表に使える高さがそのぶん減る。**
 */

import type { ReactElement } from 'react';
import type { Service } from '@/domain/model';

export interface TimetableToolbarProps {
  readonly selectedCount: number;
  /** 写し先に選べるダイヤ（編集中のものを除く）。 */
  readonly otherServices: readonly Service[];
  readonly onCopyTo: (serviceId: string) => void;
}

export function TimetableToolbar(props: TimetableToolbarProps): ReactElement | null {
  const { selectedCount, otherServices } = props;

  // 写し先が無いときは行ごと出さない。**押せない操作のために高さを使わない**
  // ——ダイヤが 1 つしか無いあいだ、この行は何も伝えない。
  if (otherServices.length === 0) return null;

  return (
    <div className="timetable__toolbar" role="toolbar" aria-label="ダイヤの操作">
      <label>
        別のダイヤへ複製{' '}
        <select
          value=""
          disabled={selectedCount === 0}
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
    </div>
  );
}
