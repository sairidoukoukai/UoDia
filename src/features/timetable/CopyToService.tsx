/**
 * 別のダイヤへ複製する操作（仕様書 §6.1.4、#200）。
 *
 * ## 方向タブと同じ行に置く
 *
 * かつては自分の行を持っていた（`.timetable__toolbar`）。**行を 1 本増やす
 * たびに、表に使える高さがそのぶん減る**——時刻表は縦に詰まっているほど多くの
 * 停留所が一度に見える。並べ替えと知らせが既に方向タブの行へ移っており
 * （§6.1.1）、**複製だけがその行に乗り損ねていた。**
 *
 * ## 並べ替えの右に置く
 *
 * **並べ替えはこの表の中の操作、複製は外へ出す操作**である。内から外の順に
 * 並べる。
 *
 * ## 写し先が無ければ、その部分だけを出さない
 *
 * ダイヤが 1 つのあいだは写す先が無い。**押せない操作を置いても何も伝わらない。**
 * 行そのものは消えないため、**出たり消えたりしても表の高さは動かない**——
 * 以前は行ごと生えたり枯れたりしていた。
 */

import type { ReactElement } from 'react';
import type { Service } from '@/domain/model';

export interface CopyToServiceProps {
  readonly selectedCount: number;
  /** 写し先に選べるダイヤ（編集中のものを除く）。 */
  readonly otherServices: readonly Service[];
  readonly onCopyTo: (serviceId: string) => void;
}

export function CopyToService(props: CopyToServiceProps): ReactElement | null {
  const { selectedCount, otherServices } = props;

  if (otherServices.length === 0) return null;

  return (
    <label className="timetable__copy">
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
  );
}
