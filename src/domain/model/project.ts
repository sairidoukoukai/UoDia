/**
 * プロジェクト（`.uodia` ファイル）のスキーマ。仕様書 §5.6〜§5.10、§7.2。
 *
 * 停留所・区間・パターンの定義は含まない（`route.json` から読む）。
 * 1 便あたりの永続化データは 6 フィールドのみで、100 便でも数十 KB に収まる。
 */

import { z } from 'zod';
import { fromHM } from '@/domain/time';
import {
  directionIdSchema,
  hexColorSchema,
  idSchema,
  isoDateTimeSchema,
  secondsSchema,
} from './primitives';

/** 現在のファイル形式の版数。破壊的変更のたびに繰り上げる（仕様書 §7.3）。 */
export const CURRENT_FORMAT_VERSION = 3;

/**
 * 基準時刻（仕様書 §5.6）。**便の時刻を決める唯一の入力。**
 *
 * 便の全停留所の時刻はこの 1 点から導出され、永続化されない。利用者が別の
 * 停留所の時刻を設定すると、このアンカーが丸ごと置き換わる。
 */
export const anchorSchema = z.object({
  /** パターンに含まれる停留所であること（T-11 の参照整合性検査で確認）。 */
  stopId: idSchema,
  time: secondsSchema,
});
export type Anchor = z.infer<typeof anchorSchema>;

/** 便（仕様書 §5.6）。停車パターンと基準時刻 1 点のみで完全に決まる。 */
export const tripSchema = z.object({
  /** GTFS `trip_id`。 */
  tripId: idSchema,
  /** 方向・行先・経由地を兼ねる。 */
  patternId: idSchema,
  /**
   * 基準時刻。`null` は**まだ時刻が入力されていない便**を表す（仕様書 §6.1.4）。
   *
   * 便の追加は「既定パターンの空便を挿入する」操作であり、その時点では時刻が
   * 決まっていない。これを表現できないと、時刻を入れるまで便を作れないか、
   * あるいは仮の時刻を入れて「本当に 0:00 発なのか、まだ入力していないのか」を
   * 区別できなくなる。
   */
  anchor: anchorSchema.nullable(),
  /** 運用番号。GTFS `block_id`。空文字は未割当を意味する。 */
  blockId: z.string(),
  /**
   * この便の前に車庫から出るか（出区）。仕様書 §6.1.7。
   *
   * **回送便そのものは持たない。** 0 分折返しの制約により、回送便の停車パターン・
   * 時刻・運用番号はすべてこの便から決まる。持つべき情報はこの真偽値だけであり、
   * 回送便は要る場面で展開する（`domain/service/deadhead.ts`）。
   */
  pullOut: z.boolean().default(false),
  /** この便の後に車庫へ入るか（入区）。仕様書 §6.1.7。 */
  pullIn: z.boolean().default(false),
  note: z.string().optional(),
  /*
   * 便番号は持たない（仕様書 §6.1.6）。始発時刻の昇順から導出される値であり、
   * 保存すると 1 便を動かすたびに全便を書き換えることになる。取り消しの単位が
   * 「1 便の移動」ではなく「全便の書き換え」になってしまう。
   */
});
export type Trip = z.infer<typeof tripSchema>;

/** ダイヤ（仕様書 §5.7）。運行日種別ごとの便の集合。 */
export const serviceSchema = z.object({
  /** GTFS `service_id`。 */
  serviceId: idSchema,
  /** 例: 授業期間平日ダイヤ */
  serviceName: z.string().min(1),
  /** 両方向の営業便。**回送便は含まない**（導出値。仕様書 §6.1.7）。 */
  trips: z.array(tripSchema),
});
export type Service = z.infer<typeof serviceSchema>;

/** ファイルのメタ情報（仕様書 §7.2）。 */
export const metaSchema = z.object({
  format: z.literal('uodia'),
  formatVersion: z.number().int().min(1),
  appVersion: z.string(),
  /** 依存する `route.json` の版数。不一致なら読込時に警告する。 */
  routeVersion: z.number().int().min(1),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type Meta = z.infer<typeof metaSchema>;

/** 文書情報。 */
export const documentInfoSchema = z.object({
  name: z.string(),
  author: z.string(),
  comment: z.string(),
});
export type DocumentInfo = z.infer<typeof documentInfoSchema>;

/** ダイヤグラムのスジの着色方法（仕様書 §6.2.4）。 */
export const colorModeSchema = z.enum(['pattern', 'block']);
export type ColorMode = z.infer<typeof colorModeSchema>;

/**
 * ダイヤグラムのビューポート（仕様書 §6.2.1、§6.2.3）。
 *
 * 表示範囲の既定は 7:00〜22:00。スクロール位置と拡大率を保存し、ファイルを
 * 開き直しても表示が再現されるようにする。
 */
export const diagramViewSchema = z.object({
  /** 横軸の拡大率（1 分あたりの px）。 */
  pxPerMinute: z.number().positive().default(3),
  /**
   * 縦軸の拡大率（`axisPosition` 1 単位あたりの px）。
   *
   * 営業所を縦軸から外したぶん（#118）、既定を 6 から 8 に上げた。縦軸の範囲が
   * 0〜52 から 0〜40 に縮んだため、そのままでは**同じ画面に同じ絵が小さく載る**。
   * 8 にすると描かれる高さが 320px となり、それまでの 312px とほぼ変わらない。
   */
  pxPerAxisUnit: z.number().positive().default(8),
  /**
   * 表示左端の時刻（秒）。
   *
   * **5 分の倍数に縛らない**（v4.17）。5 分刻みの決まり（仕様書 §2.1）は便の
   * 時刻についてのものであって、画面をどこまで送ったかについてのものではない。
   * 縛ると、拡大の中心をカーソルに合わせられず（§6.2.3）、送りも 5 分単位に
   * 飛ぶ。`Seconds` を名乗らないのはそのためである。
   */
  scrollTime: z.number().finite().default(fromHM(7, 0)),
  /** 表示上端の軸位置。 */
  scrollAxis: z.number().default(0),
});
export type DiagramView = z.infer<typeof diagramViewSchema>;

/**
 * 拡大率の下限と上限（仕様書 §6.2.3）。
 *
 * 下限は「1 日分（15 時間）がおよそ画面に収まる」ところ、上限は「1 分が指で
 * 掴める幅になる」ところに置く。**際限なく縮められると、格子も文字も潰れた
 * 灰色の帯だけが残り、戻す手立てが分からなくなる。**
 */
export const DIAGRAM_ZOOM_LIMITS = {
  minPxPerMinute: 0.5,
  maxPxPerMinute: 40,
  minPxPerAxisUnit: 1,
  maxPxPerAxisUnit: 60,
} as const;

/**
 * 拡大率を下限と上限に収める。
 *
 * スキーマで縛らないのは、**範囲外の値を持つファイルを拒みたくない**ためで
 * ある。開けないより、収めて開くほうがよい。
 */
export function clampDiagramView(view: DiagramView): DiagramView {
  const pxPerMinute = clamp(
    view.pxPerMinute,
    DIAGRAM_ZOOM_LIMITS.minPxPerMinute,
    DIAGRAM_ZOOM_LIMITS.maxPxPerMinute,
  );
  const pxPerAxisUnit = clamp(
    view.pxPerAxisUnit,
    DIAGRAM_ZOOM_LIMITS.minPxPerAxisUnit,
    DIAGRAM_ZOOM_LIMITS.maxPxPerAxisUnit,
  );
  if (pxPerMinute === view.pxPerMinute && pxPerAxisUnit === view.pxPerAxisUnit) return view;

  return { ...view, pxPerMinute, pxPerAxisUnit };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * 上下 2 分割の比率の下限と上限（仕様書 §6.4）。
 *
 * **どちらかを 0 にできないようにする。** 潰しきれると、境界だけが残った画面から
 * 元に戻す手立てが分からなくなる。片方だけを見たいときは最大化を使う——
 * こちらは押し直せば必ず戻る（`features/shell/layout.ts`）。
 */
export const SPLIT_RATIO_LIMITS = { min: 0.1, max: 0.9 } as const;

/** ダイヤグラムが占める高さの既定値。上をやや広く取る（仕様書 §6.4）。 */
export const DEFAULT_SPLIT_RATIO = 0.6;

/**
 * 分割比率を下限と上限に収める。
 *
 * **スキーマが範囲を縛っているため、収めずに書き込んではならない。** 範囲外の
 * 値を持つプロジェクトは書き出せても読み込めず、開けないファイルができる。
 */
export function clampSplitRatio(ratio: number): number {
  if (!Number.isFinite(ratio)) return DEFAULT_SPLIT_RATIO;
  return clamp(ratio, SPLIT_RATIO_LIMITS.min, SPLIT_RATIO_LIMITS.max);
}

/**
 * 表示設定（仕様書 §5.10）。プロジェクトに保存され、開き直しても再現される。
 *
 * すべての項目に既定値を与えている。古いファイルに項目が欠けていても、
 * マイグレーション処理を書かずに読み込めるようにするため。
 */
export const viewSettingsSchema = z.object({
  /** ダイヤグラム（上）が占める高さの比率。0〜1（仕様書 §6.4）。 */
  splitRatio: z
    .number()
    .min(SPLIT_RATIO_LIMITS.min)
    .max(SPLIT_RATIO_LIMITS.max)
    .default(DEFAULT_SPLIT_RATIO),
  /** 編集中のダイヤ。null なら先頭のダイヤを使う。 */
  activeServiceId: idSchema.nullable().default(null),
  /** 時刻表の方向タブ。 */
  activeDirection: directionIdSchema.default(0),
  diagram: diagramViewSchema.default({}),
  colorMode: colorModeSchema.default('pattern'),
  /** 非表示にするパターン。 */
  hiddenPatternIds: z.array(idSchema).default([]),
  /** 非表示にする運用番号。 */
  hiddenBlockIds: z.array(idSchema).default([]),
  /** 非表示にする方向。 */
  hiddenDirections: z.array(directionIdSchema).default([]),
  /** 回送便を表示するか。 */
  showDeadhead: z.boolean().default(true),
  /** 検証パネルを開いているか。 */
  validationPanelOpen: z.boolean().default(true),
  /**
   * 運用ごとに選んだ色（#148）。選んだものだけを入れる。
   *
   * **設定ではなくプロジェクトに置く。** 運用番号はその文書のものであり、
   * `A` という運用はダイヤが違えば違う車の動きを指す。設定に持つと、別の
   * ファイルを開いたときに無関係な `A` の色を引き継ぐことになる。色を決める
   * のは「この日のダイヤを説明するため」であり、**渡した相手の画面でも同じ色で
   * 見えてほしい。**
   *
   * 入っていない運用は、これまでどおり並び順から自動で決まる
   * （`assignBlockColors`）。選んだものだけを覚えるため、**運用を足しても
   * 選んだ色は動かない。**
   */
  blockColors: z.record(idSchema, hexColorSchema).default({}),
});
export type ViewSettings = z.infer<typeof viewSettingsSchema>;

/** プロジェクト全体（仕様書 §5.10、§7.2）。`.uodia` ファイルの中身。 */
export const projectSchema = z.object({
  meta: metaSchema,
  document: documentInfoSchema,
  services: z.array(serviceSchema),
  view: viewSettingsSchema.default({}),
});

/** 読み込んだ後のプロジェクト。既定値が適用済み。 */
export type Project = z.infer<typeof projectSchema>;

/** ファイルに書かれ得るプロジェクト。既定値のある項目は省略できる。 */
export type ProjectInput = z.input<typeof projectSchema>;
