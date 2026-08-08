/**
 * GTFS 画面の適用（#198、仕様書 v2 §3.2）。
 *
 * **設定ダイアログと同じ作法に従う**（`settings/settingsService.ts`）。
 *
 * 1. 定義を書き換える（`editNetwork`）。**ここで検証が走る**（R-01〜R-15）。
 *    通らなければ状態は 1 ビットも変わらない
 * 2. 通ったときだけ `route.json` へ書き戻す
 *
 * 逆にすると、検証を通らない内容をファイルへ書いてしまう。
 */

import type { Agency } from '@/domain/model';
import type { AppStore } from '@/store';
import { toAgency, type AgencyEdits } from './agency';
import { changedCoordinates, type CoordinateEdits } from './coordinates';

/** 読み書きに要るだけの入れ口。 */
export interface GtfsStore {
  getState(): AppStore;
}

export interface ApplyResult {
  readonly ok: boolean;
  /** 画面に出す言葉。 */
  readonly message: string;
}

/**
 * 事業者と緯度経度の変更を当てる（履歴に載る）。
 *
 * **2 つを 1 回の編集で当てる。** 分けると、片方だけが検証を通ったときに中途半端な
 * 状態が残る。履歴も 2 段になり、**打った 1 回の「適用」を戻すのに 2 回の取り消しが
 * 要る**（`settings/settingsService.ts` の区間と距離と同じ判断）。
 *
 * **書き戻しはしない。** ファイルへ書くかどうかは環境で変わり（§6.5.5）、待ち時間も
 * ある。状態を変えることと、それを保存することは別の操作である。
 */
export function applyGtfsEdits(
  store: GtfsStore,
  agencyEdits: AgencyEdits,
  coordinateEdits: CoordinateEdits,
): ApplyResult {
  const state = store.getState();
  const def = state.networkDef;
  if (def === null) return { ok: false, message: '路線図を読み込んでいません' };

  const agency = toAgency(agencyEdits, def.agency?.agencyId ?? '', def.agency);
  if (agency === null) {
    return { ok: false, message: '事業者の必須項目が空です' };
  }
  if (agency.agencyId === '') {
    // agencyId は法人番号であり、こちらで採番し直さない（仕様書 v2 §6.6）。
    // 画面からは打てないため、まだ無いなら route.json を直接編集してもらう。
    return { ok: false, message: 'agencyId がありません。route.json に書いてください' };
  }

  const coordinates = changedCoordinates(def, coordinateEdits);

  const result = state.editNetwork('GTFS の情報を変更', (draft) => {
    draft.agency = agency;
    for (const stop of draft.stops) {
      const next = coordinates.get(stop.stopId);
      if (next === undefined) continue;
      stop.lat = next.lat;
      stop.lon = next.lon;
    }
  });

  if (!result.ok) {
    // 検証（R-01〜R-15）を通らなかった。**状態は変わっていない。**
    const first = result.issues[0];
    return {
      ok: false,
      message:
        first === undefined
          ? '変更を適用できません'
          : `変更を適用できません: [${first.rule}] ${first.message}`,
    };
  }
  if (!result.changed) return { ok: true, message: '変わった項目はありません' };

  return {
    ok: true,
    message:
      coordinates.size === 0
        ? '事業者の情報を変えました'
        : `事業者の情報と、${String(coordinates.size)} 停留所の緯度経度を変えました`,
  };
}

/** いまの定義が持っている事業者。**画面の初期値に使う。** */
export function currentAgency(store: GtfsStore): Agency | undefined {
  return store.getState().networkDef?.agency;
}
