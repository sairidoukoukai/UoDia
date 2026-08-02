/**
 * 便の写し・切り取り・貼り付け（仕様書 §6.1.4、§8.1、T-53／T-37）。
 *
 * **画面の部品ではなくストアの上の操作にしてある。** 写す対象は「選ばれている
 * 便」であり、選択はダイヤグラムと時刻表で 1 つである（§6.3.1）。時刻表の中に
 * 置いたままにすると、ダイヤグラムに焦点があるときの <kbd>Ctrl</kbd>+<kbd>C</kbd>
 * が効かない、という**焦点の位置で変わる規則**が生まれる。
 *
 * 切り取りは「写してから消す」である。**履歴に載るのは削除だけ**であり、
 * 取り消しても写したものは消えない。貼り直せる。
 */

import type { Trip } from '@/domain/model';
import { pasteTrips, removeTrips } from '@/domain/service';
import { selectActiveService, selectSelectedTrips, type AppStore } from '@/store';

/** 読み書きに要るだけの入れ口（テストでは作ったストアを渡す）。 */
export interface ClipboardStore {
  getState(): AppStore;
}

/**
 * 起きたことを言葉にしたもの。`null` は「言うほどのことは起きていない」。
 *
 * 写しただけでは画面が変わらないため、**言葉で伝えるほかない**。貼り付けと
 * 切り取りは便の数が変わるので、うまくいったときは黙っている。
 */
export type ClipboardMessage = string | null;

/** 選んだ便を写す。 */
export function copySelection(store: ClipboardStore): ClipboardMessage {
  const state = store.getState();
  const selected = selectSelectedTrips(state);
  if (selected.length === 0) return null;

  state.copyTrips(selected);
  return `${String(selected.length)} 便を写しました`;
}

/** 選んだ便を切り取る（写してから消す）。 */
export function cutSelection(store: ClipboardStore): ClipboardMessage {
  const state = store.getState();
  const selected = selectSelectedTrips(state);
  const service = selectActiveService(state);
  if (selected.length === 0 || service === null) return null;

  state.copyTrips(selected);
  replaceTrips(
    state,
    service.serviceId,
    '便の切り取り',
    removeTrips(
      service.trips,
      selected.map((trip) => trip.tripId),
    ),
  );
  state.clearSelection();
  return `${String(selected.length)} 便を切り取りました`;
}

/** 写した便を今のダイヤへ貼る。 */
export function pasteClipboard(store: ClipboardStore): ClipboardMessage {
  const state = store.getState();
  const service = selectActiveService(state);
  if (service === null) return null;
  if (state.ui.clipboard.length === 0) return '写した便がありません';

  const all = state.project?.services.flatMap((item) => item.trips) ?? [];
  const result = pasteTrips(service.trips, state.ui.clipboard, all);
  if (result === null) return '写した便がありません';

  replaceTrips(state, service.serviceId, '貼り付け', result.trips);
  // 貼った便を選んでおく。続けて時刻をずらす、という流れがそのまま繋がる。
  state.selectTrips(result.added.map((trip) => trip.tripId));
  return null;
}

/** そのダイヤの便を丸ごと入れ替える。 */
function replaceTrips(
  state: AppStore,
  serviceId: string,
  label: string,
  next: readonly Trip[],
): void {
  state.editProject(label, (project) => {
    const service = project.services.find((item) => item.serviceId === serviceId);
    // **写しを作らない。** 何も変わらなかった操作は同じ配列を返してくるため、
    // ここで複製すると履歴に空の 1 段が積まれる。
    if (service !== undefined) service.trips = next as Trip[];
  });
}
