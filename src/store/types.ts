/**
 * アプリ状態の形（実装計画書 §3.6）。
 *
 * **派生値を状態に持たない。** 停留所ごとの時刻・運用の導出値・検証結果は、
 * すべてセレクタで計算する（`selectors.ts`）。持たせると、便を 1 つ書き換える
 * たびに派生値を更新して回る必要があり、更新し忘れた箇所が「画面によって
 * 値が違う」という形で現れる。
 *
 * ## 表示設定を `ui` に置かない
 *
 * 実装計画書 §3.6 の草案では `ui` に `activeServiceId` や `splitRatio` を
 * 置いていたが、これらは `project.view` として**ファイルに保存される**
 * （仕様書 §5.10、§7.2）。両方に置くと、どちらが正かを決める規則が要る。
 *
 * `ui` に残すのは**保存しない状態だけ**である。選択は開き直したときに
 * 復元しないため、ここに置く。
 *
 * ## 索引ではなく定義を持つ（T-16 で変更）
 *
 * T-15 では `NetworkIndex` をそのまま持っていたが、`NetworkDef` に改めた。
 * 区間所要時間の変更も undo の対象であり（仕様書 §6.7）、undo は状態の一部を
 * 差し替えるパッチとして記録される。索引は関数を含む導出物であり、その一部
 * だけを差し替えると**閉じ込めた古い値を返し続ける索引**ができあがる。
 * 状態が持つのは素のデータだけとし、索引はセレクタで組み立てる
 * （`selectNetwork`）。
 */

import type { DiagramView, NetworkDef, Project, Trip } from '@/domain/model';
import type { FileHandle } from '@/platform';
import type { History } from './history';

/**
 * 矩形選択で囲んでいる範囲（仕様書 §6.3.1、T-28）。
 *
 * **画面の px ではなく、描くものの座標（時刻と軸位置）で持つ。** px で持つと、
 * 拡大率や canvas の大きさが変わった瞬間に、囲んでいた範囲が別の便を指す。
 */
export interface SelectionRect {
  readonly fromTime: number;
  readonly toTime: number;
  readonly fromAxis: number;
  readonly toAxis: number;
}

/**
 * 引きずっている最中のスジの移動量（仕様書 §6.3.2、T-29）。
 *
 * 便そのものは**その場で動いている**（履歴には `mergeKey` で 1 操作にまとまる）。
 * ここにあるのは画面に出す数字だけであり、動いた結果を持っているわけではない。
 */
export interface TripShift {
  /** ずらした分。5 分の倍数。 */
  readonly minutes: number;
  /** 数字を出す場所（カーソルの位置）。描くものの座標で持つ。 */
  readonly atTime: number;
  readonly atAxis: number;
}

/**
 * 片方だけを大きく見ている状態（仕様書 §6.4、T-32）。`null` は 2 分割のまま。
 *
 * **分割比率とは別に持つ。** 比率のほうへ 0 や 1 を書き込んで表すと、最大化を
 * 解いたときに戻る先が消える。
 */
export type MaximizedPane = 'diagram' | 'timetable' | null;

/**
 * ダイヤグラムの左ボタンが何をするか（仕様書 §6.3.3、T-30）。
 *
 * - `select` — 選ぶ・囲む・引きずる（§6.3.1、§6.3.2）
 * - `draw` — 停留所線を押して便を作る（§6.3.3）
 *
 * **保存しない。** 道具を選んだ状態でファイルを閉じ、開き直した先で線を引く
 * つもりの無いクリックが便になっては困る。
 */
export type DiagramTool = 'select' | 'draw';

/** 保存しない状態。 */
export interface UiState {
  /** 選択中の便。時刻表とダイヤグラムで共有する（仕様書 §6.3.1）。 */
  readonly selectedTripIds: readonly string[];
  /**
   * 引きずっている最中の選択の矩形。掴んでいなければ `null`。
   *
   * 引きずり終えれば消える。**画面に出ている途中経過であって、編集の結果では
   * ない**ため、履歴にもファイルにも入らない。
   */
  readonly selectionRect: SelectionRect | null;
  /** 引きずっている最中の移動量。掴んでいなければ `null`（T-29）。 */
  readonly tripShift: TripShift | null;
  /**
   * 最大化している側（仕様書 §6.4、T-32）。2 分割のままなら `null`。
   *
   * **保存しない。** 分割比率はファイルに残るが（§5.10）、最大化はいま片方を
   * じっくり見ているというだけの姿である。開き直した画面が片側の潰れた形で
   * 始まると、壊れたように見える。
   */
  readonly maximized: MaximizedPane;
  /** ダイヤグラムの左ボタンの役目（仕様書 §6.3.3、T-30）。 */
  readonly tool: DiagramTool;
  /**
   * 写した便（仕様書 §6.1.4、§8.1、T-53）。貼り付けるまで持つ。
   *
   * **便そのものを持つ。** ID の一覧にすると、写したあとに元の便を消したり
   * 直したりしたときに、貼り付けたものが変わってしまう。写した時点の姿を
   * 貼るのが「コピー」である。
   *
   * ファイルにも履歴にも入れない。切り取り（コピー＋削除）のうち履歴に載るのは
   * 削除だけであり、**取り消しても写したものは消えない。**
   */
  readonly clipboard: readonly Trip[];
}

/**
 * 編集の対象そのもの。**Undo/Redo が戻す範囲**を型で示す。
 *
 * 選択と履歴自身はここに含めない。選択の移動は編集ではなく、undo で戻って
 * きてほしいものではない。
 */
export interface DocumentState {
  /**
   * ネットワーク定義。読込前は `null`。
   *
   * 読込は非同期であり、その間も画面は立ち上がっている。`null` を許さない形に
   * すると、読込が終わるまでストアを作れず、状態の置き場所が二重になる。
   */
  readonly networkDef: NetworkDef | null;
  /** 編集対象。開いていなければ `null`。 */
  readonly project: Project | null;
}

/**
 * 開いているファイルの状態（仕様書 §6.8）。
 *
 * **未保存かどうかを真偽値で持たない。** 「保存した時点の内容」を覚えておき、
 * 今の内容と**参照が同じか**で判定する（`selectIsDirty`）。真偽値だと、状態を
 * 変えるすべての場所で立て忘れ・下ろし忘れが起こりうる。参照の比較なら、
 * 更新が 1 箇所でも漏れれば「保存済み」と嘘をつくのではなく「未保存」に倒れる。
 *
 * 参照の比較で足りるのは、`execute` が**内容が変わったときだけ**新しい
 * プロジェクトを作るためである（変わらなければ履歴にも載せない）。
 */
export interface FileState {
  /** 保存先。まだ保存していなければ `null`。 */
  readonly handle: FileHandle | null;
  /** 最後に保存した内容そのもの。保存も読込もしていなければ `null`。 */
  readonly savedProject: Project | null;
}

/**
 * アプリの設定（仕様書 §6.5.2、§6.5.3、T-35）。
 *
 * **プロジェクトには入れない。** 履歴段数もバックアップ間隔も「この道具の
 * 使い方」であり、開いたファイルによって変わるものではない。`view`（§5.10）が
 * 文書の見え方を持つのと対になる。
 *
 * **履歴にも載せない。** 設定を変えることは便の編集ではない。
 *
 * いまは起動のたびに既定へ戻る。設定の保存先はテーマと一緒に決める（T-39）。
 */
export interface AppSettings {
  /** 自動バックアップの間隔（ミリ秒。仕様書 §6.8）。 */
  readonly backupIntervalMs: number;
  /**
   * ダイヤグラムの既定の拡大率（仕様書 §6.5.3）。
   *
   * <kbd>Ctrl</kbd>+<kbd>0</kbd>（拡大率を既定に戻す）が戻す先である。
   */
  readonly defaultDiagramView: DiagramView;
  /**
   * 停車パターンの編集を開いてよいか（仕様書 §6.5.4、T-36）。
   *
   * **起動のたびに閉じる。** 隠してあるのは危ないからではなく、**普段の作図で
   * 触る場所ではない**からである。覚えさせて開いたままにすると、隠した意味が
   * 薄れる。
   */
  readonly patternsUnlocked: boolean;
}

export interface AppState extends DocumentState {
  readonly ui: UiState;
  readonly history: History;
  readonly file: FileState;
  readonly settings: AppSettings;
}

/** 状態が持つ項目。派生値を足していないことをテストで固定するために使う。 */
export const APP_STATE_KEYS = [
  'networkDef',
  'project',
  'ui',
  'history',
  'file',
  'settings',
] as const;
