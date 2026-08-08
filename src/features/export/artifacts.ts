/**
 * 一斉出力に入るものの約束（仕様書 v2 §5.2、T-74）。**型だけを置く。**
 *
 * 何が入るかは `producers.ts` が持つ。**約束と中身を分けてある**——中身は
 * 描画にも表計算にも触るが、約束は 2 つの型でしかない。
 *
 * ## なぜ表にするのか
 *
 * 5 つを 1 つずつ書き出しの手順に書き足すと、**進み具合の数え方と、失敗したとき
 * の言い方が 5 か所に散らばる**（仕様書 v2 §5.8・§5.9）。表にしておけば、手順は
 * 「表を上から順に作り、名前を付けて包む」の 1 つで済む。
 */

import type { NetworkIndex } from '@/domain/network';
import type { Project, Service } from '@/domain/model';
import type { AppState } from '@/store';

/**
 * 中身を作るのに要るもの。
 *
 * **編集中のダイヤ 1 つだけを出す**（仕様書 v2 §5.2）。プロジェクトに複数の
 * ダイヤがあっても、出るのは今開いているものである。
 */
export interface ExportSource {
  /**
   * 画面が持っているものすべて。**表示設定もフィルタもここから読む**
   * （仕様書 v2 §5.4.1。見えているものが出る）。
   *
   * **選択と引きずりは落としてある**（`diagramExportScene`）。どの便を選んで
   * いたかは配る絵に関係が無い。
   */
  readonly state: AppState;
  /** `state.project` と同じもの。**無いことが無いと分かっている。** */
  readonly project: Project;
  readonly network: NetworkIndex;
  /** 編集中のダイヤ。 */
  readonly service: Service;
}

/** 書き出しに入る 1 つ。 */
export interface ExportProducer {
  /** 進み具合に出す名前（「箱ダイヤ」）。 */
  readonly label: string;
  /** zip の中での名前（「箱ダイヤ.pdf」）。 */
  readonly fileName: string;
  /**
   * 中身を作る。
   *
   * **失敗したら投げてよい。** 呼ぶ側が受けて、どれを作っていて失敗したかを
   * 伝える（仕様書 v2 §5.8）。
   */
  build(source: ExportSource): Promise<Uint8Array> | Uint8Array;
}
