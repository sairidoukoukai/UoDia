/**
 * 一斉出力に入るもの（仕様書 v2 §5.2、T-74）。
 *
 * ## ここには中身が 1 つも無い
 *
 * T-74 が作るのは**器だけ**である。中身は後から差し込む——ダイヤグラム PNG は
 * T-75、時刻表 CSV は T-76、PDF は T-78 と T-80 が持ってくる。
 *
 * ## なぜ表にするのか
 *
 * 5 つを 1 つずつ書き出しの手順に書き足すと、**進み具合の数え方と、失敗したとき
 * の言い方が 5 か所に散らばる**（仕様書 v2 §5.8・§5.9）。表にしておけば、手順は
 * 「表を上から順に作り、名前を付けて包む」の 1 つで済む。
 */

import type { NetworkIndex } from '@/domain/network';
import type { Project, Service } from '@/domain/model';
import type { AppSettings } from '@/store';

/**
 * 中身を作るのに要るもの。
 *
 * **編集中のダイヤ 1 つだけを出す**（仕様書 v2 §5.2）。プロジェクトに複数の
 * ダイヤがあっても、出るのは今開いているものである。
 */
export interface ExportSource {
  readonly project: Project;
  readonly network: NetworkIndex;
  /** 編集中のダイヤ。 */
  readonly service: Service;
  /** 画面の表示設定。**見えているものが出る**（仕様書 v2 §5.4.1）。 */
  readonly settings: AppSettings;
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

/**
 * 一斉出力に入るもの。**まだ空である。**
 *
 * | 足す先 | 中身 |
 * | --- | --- |
 * | T-75 | ダイヤグラム.png |
 * | T-76 | 時刻表_豊中方面.csv・時刻表_吹田方面.csv |
 * | T-78 | ダイヤグラム.pdf |
 * | T-80 | 箱ダイヤ.pdf |
 *
 * GTFS は入らない（仕様書 v2 §5.7）。GTFS 画面の書き出しタブから出す。
 */
export const EXPORT_PRODUCERS: readonly ExportProducer[] = [];
