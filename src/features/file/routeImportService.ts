/**
 * 路線の取り込み（#235、T-91）。
 *
 * ## 2 つの形を受け取る
 *
 * 取り込み元は**別の `.uodia`** でも**`route.json`** でもよい。前者は新経路を
 * 足した文書から引き継ぐため、後者は手で書いた路線を入れるためである。
 *
 * **どちらかを利用者に宣言させない。** 中身を見れば分かることを尋ねると、
 * 選び間違いという失敗が 1 つ増える。
 *
 * ## 当てるのは確かめたあと
 *
 * 読んで数えるところまでを {@link RouteImportService.inspect} が行い、当てるのは
 * {@link RouteImportService.apply} である。**間に画面が挟まる**——1 操作で全便に
 * 及ぶ変更であり、起きてから気づかせない（`domain/network/routeImport.ts`）。
 */

import { loadProjectData } from '@/domain/io';
import { networkDefSchema, parseWithSchema, type NetworkDef } from '@/domain/model';
import { summarizeRouteImport, type NetworkIndex, type RouteImportSummary } from '@/domain/network';
import { parseJson } from '@/domain/util';
import type { PlatformAdapter } from '@/platform';
import { selectSeedNetwork, type AppStoreHook } from '@/store';

export interface RouteImportServiceOptions {
  readonly platform: PlatformAdapter;
  readonly store: AppStoreHook;
}

/** 読み込んだ路線と、取り込むと何が起きるか。 */
export interface RouteImportCandidate {
  /** 取り込み元の名前（画面に出す）。 */
  readonly sourceName: string;
  readonly network: NetworkDef;
  readonly summary: RouteImportSummary;
}

export type InspectResult =
  | { readonly ok: true; readonly candidate: RouteImportCandidate }
  /** 取り消された。**失敗ではない。** */
  | { readonly ok: false; readonly reason: 'cancelled' }
  | { readonly ok: false; readonly reason: 'unreadable'; readonly message: string };

export interface RouteImportService {
  /** ファイルを選ばせ、取り込むと何が起きるかを返す。**状態は変えない。** */
  inspect(): Promise<InspectResult>;
  /** 取り込む。**履歴に積む**（取り消せる）。 */
  apply(candidate: RouteImportCandidate): boolean;
}

/**
 * 中身から路線を取り出す。
 *
 * **先に文書として読む。** `route.json` は文書のスキーマを通らないため、
 * 取り違えは起きない。
 *
 * @param seed 版数 4 以下の文書を読むのに要る路線。**取り出す値ではない**
 */
export function networkFrom(content: string, seed: NetworkIndex): NetworkDef | null {
  const parsed = parseJson(content);
  if (!parsed.ok) return null;

  const asProject = loadProjectData(parsed.value, seed);
  if (asProject.ok) return asProject.project.network;

  const asNetwork = parseWithSchema(networkDefSchema, parsed.value);
  return asNetwork.ok ? asNetwork.value : null;
}

export function createRouteImportService(options: RouteImportServiceOptions): RouteImportService {
  const { platform, store } = options;

  return {
    async inspect(): Promise<InspectResult> {
      const seed = selectSeedNetwork(store.getState());
      const project = store.getState().project;
      if (seed === null || project === null) {
        return { ok: false, reason: 'unreadable', message: '文書を開いていません' };
      }

      const opened = await platform.openProject();
      if (opened === null) return { ok: false, reason: 'cancelled' };

      const network = networkFrom(opened.content, seed);
      if (network === null) {
        return {
          ok: false,
          reason: 'unreadable',
          message: `${opened.handle.name} から路線を読み取れませんでした`,
        };
      }

      return {
        ok: true,
        candidate: {
          sourceName: opened.handle.name,
          network,
          summary: summarizeRouteImport(project, network),
        },
      };
    },

    apply(candidate: RouteImportCandidate): boolean {
      // **丸ごと差し替える。** 部分的に混ぜると、取り込んだ路線でも元の路線でも
      // ないものができあがる。`editProject` を通すのは、路線の差し替えが**文書の
      // 編集**だからである（履歴に積まれ、取り消せる）。
      const result = store
        .getState()
        .editProject(`${candidate.sourceName} から路線を取り込み`, (project) => {
          project.network = candidate.network;
          project.meta.routeVersion = candidate.network.version;
        });

      return result.ok;
    },
  };
}
