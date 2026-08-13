/**
 * ネットワーク定義（`route.json`）のスキーマ。仕様書 §5.1〜§5.5。
 *
 * 停留所・区間所要時間・停車パターンを定義する固定データ。プロジェクトファイル
 * には含めない。
 *
 * 本モジュールは**構造の検証のみ**を行う。停留所参照の実在性や区間表の網羅性
 * （R-02〜R-07）は T-06 が担う。構造と意味の検証を分けることで、エラーの原因が
 * 「JSON の形が違う」のか「データの内容が矛盾している」のか切り分けられる。
 */

import { z } from 'zod';
import { GRAIN_SECONDS } from '@/domain/time';
import {
  directionIdSchema,
  gtfsColorSchema,
  hexColorSchema,
  idSchema,
  latitudeSchema,
  longitudeSchema,
  runMinutesSchema,
} from './primitives';

/** ダイヤグラムの停留所線の描き方。 */
export const gridStyleSchema = z.enum(['bold', 'normal', 'dashed']);
export type GridStyle = z.infer<typeof gridStyleSchema>;

/**
 * スジの線種（#147）。**選べる先を決めておく。**
 *
 * 刻み（`[8, 4]` など）そのものは描画側が持つ（`features/diagram/tripStyle.ts`）。
 * ここに置くのは、設定として保存される値だからである。
 */
export const dashKindSchema = z.enum(['solid', 'dashed', 'dashDot']);
export type DashKind = z.infer<typeof dashKindSchema>;

/**
 * 取扱区分（仕様書 §5.4）。その便がその停留所で乗客の乗り降りをどう扱うか。
 *
 * 「通過」は設けない。パターンに含まれない停留所は、その便が経由しないことを
 * 意味する。
 */
export const handlingSchema = z.enum(['stop', 'boardOnly', 'alightOnly']);
export type Handling = z.infer<typeof handlingSchema>;

/** 停留所（仕様書 §5.3）。千里営業所も停留所の一種として扱う。 */
export const stopSchema = z.object({
  /** GTFS `stop_id`。例: `1_0` */
  stopId: idSchema,
  /** GTFS `stop_name`。例: 豊中学舎 */
  stopName: z.string().min(1),
  /** ダイヤグラム縦軸・時刻表用の略称。UoDia 独自。例: 豊中 */
  shortName: z.string().min(1),
  /** 例: 豊中地区 */
  area: z.string(),
  /** ダイヤグラム縦軸の座標（任意単位）。表示専用で、便の時刻を拘束しない。 */
  axisPosition: z.number().finite(),
  gridStyle: gridStyleSchema,
  /** true の停留所は時刻表・ダイヤグラムに表示しない。内部データとしてのみ保持する。 */
  hiddenInEditor: z.boolean(),
  /**
   * true の停留所は営業所。
   *
   * **`stops.txt` からは除外しない**（仕様書 v2 §6.5.2、版数 3.0 で改めた）。
   * 回送便の `stop_times` が車庫を指すため、出さなければ参照先が無くなる。
   * `location_type: 1` として出す。
   */
  isDepot: z.boolean(),

  /**
   * 緯度・経度（GTFS `stop_lat` / `stop_lon`。#198、仕様書 v2 §3.4）。
   *
   * **省略できる。** 版数 2 以前の `route.json` は持たないことが正しい状態で
   * あり、読めなくすると古い定義で起動できなくなる。版数 3 以上で全停留所に
   * 入っていることは R-15 が検証する。
   */
  lat: latitudeSchema.optional(),
  lon: longitudeSchema.optional(),

  /**
   * よみがな・英語名（GTFS `translations.txt`。仕様書 v2 §6.5.6）。
   *
   * **画面には出さない。** 書き出すときにだけ使う。画面に出す名前は
   * `stopName` と `shortName` の 2 つで足りており、3 つめを画面へ持ち込むと
   * 「どれを出すか」の判断が描画のたびに要る。
   */
  nameKana: z.string().min(1).optional(),
  nameEn: z.string().min(1).optional(),
});
export type Stop = z.infer<typeof stopSchema>;

/**
 * 区間（仕様書 §5.2）。隣接する 2 停留所を結ぶ**有向**の辺。
 *
 * 所要時間は停留所でも停車パターンでもなく、区間が持つ。往復で所要時間が
 * 異なり得るため有向とする（実際に箕面〜吹田間は経路が異なり 5 分ずれる）。
 */
export const segmentSchema = z.object({
  fromStopId: idSchema,
  toStopId: idSchema,
  runMinutes: runMinutesSchema,
  /**
   * 区間距離（メートル。#161、仕様書 v1.1 §6.1）。
   *
   * **メートルの整数で持つ。** km の小数で足し合わせると丸め誤差が乗り、
   * 10 区間を足して `12.299999999999999 km` と出る。ダイヤの検討に使う数として
   * 信用されない。画面には km で小数第 1 位まで出す。
   *
   * **5 の倍数のような刻みは設けない。** 所要時間が 5 分刻みなのはダイヤ全体が
   * 5 分刻みだからであり（仕様書 §2.1）、距離にその制約は無い。
   *
   * **省略できる。** 版数 1 の `route.json` は距離を持たないことが正しい状態で
   * あり、読めなくすると古い定義で起動できなくなる。**未設定は「不明」であって
   * 0 ではない**——0 に倒すと合計が静かに小さく出る。版数 2 以上で全区間に
   * 入っていることは R-13 が検証する。
   */
  distanceMeters: z.number().int().min(0).optional(),
});
export type Segment = z.infer<typeof segmentSchema>;

/**
 * 運行の種別（仕様書 §5.5、#114）。**線種はここから決まる。**
 *
 * 見分けたいのは「箕面学舎に寄るか、直行か」だけである。区間便かどうかは
 * スジの端がどこにあるかで読めるため、線種を分ける理由が無い——区別する必要の
 * 無いものに別の記号を与えると、記号のほうが多くなる。
 *
 * **判定はデータが持つ。** 停留所の並びから推し量ると、実装が特定の停留所 ID を
 * 名指しすることになる。各駅か通過かは路線側の事実であり、`route.json` に書く。
 */
export const serviceTypeSchema = z.enum(['local', 'express']);
export type ServiceType = z.infer<typeof serviceTypeSchema>;

/** 停車パターン内の 1 停留所。 */
export const patternStopSchema = z.object({
  stopId: idSchema,
  handling: handlingSchema,
});
export type PatternStop = z.infer<typeof patternStopSchema>;

/**
 * 停車パターン（仕様書 §5.5）。
 *
 * **所要時間は持たない。** 停留所の並びのみを持ち、所要時間は区間表から引く。
 * 回送もパターンの一種として扱うことで、出入庫のための専用構造を不要にしている。
 */
export const stopPatternSchema = z.object({
  /** 例: `S1` */
  patternId: idSchema,
  /** GTFS `trip_headsign`。例: 直行吹田 */
  patternName: z.string().min(1),
  /** GTFS `route_long_name` の生成元。例: 豊中吹田線 */
  routeName: z.string().min(1),
  directionId: directionIdSchema,
  /** ダイヤグラムのスジ色。 */
  color: hexColorSchema,
  /** 便の新規作成時に選ばれる。方向ごとにちょうど 1 つ（R-05 で検証）。 */
  isDefault: z.boolean(),
  /** true なら回送。営業運行ではなく、GTFS 出力から除外される。 */
  isDeadhead: z.boolean(),
  /**
   * 各駅（`local`）か通過（`express`）か。**回送は持たない**（R-12 で検証）。
   *
   * 乗る人にとっての区別であり、客を乗せない回送には当てはまらない。回送の
   * 線種は営業パターンと別に決まっている（`DEADHEAD_DASH`）。
   */
  serviceType: serviceTypeSchema.optional(),
  /** 通過順。先頭が始発、末尾が終着。2 要素以上（R-06 で検証）。 */
  stopSequence: z.array(patternStopSchema),
});
export type StopPattern = z.infer<typeof stopPatternSchema>;

/**
 * 事業者（GTFS `agency.txt`。#198、仕様書 v2 §6.5.1）。
 *
 * **バスを走らせている主体であり、この配信を作っている主体ではない。**
 * 後者は `feed_info.txt` の発行者（再履バス同好会）であり、書き出し側が
 * 固定値として持つ。**GTFS はこの 2 つを別の欄で分けている。**
 */
export const agencySchema = z.object({
  /** GTFS `agency_id`。法人番号。**こちらで採番し直さない**（外と突き合わせる ID）。 */
  agencyId: idSchema,
  agencyName: z.string().min(1),
  agencyUrl: z.string().min(1),
  /** 例: `Asia/Tokyo` */
  agencyTimezone: z.string().min(1),
  /** 例: `ja` */
  agencyLang: z.string().min(1),
  /** 空でよい。 */
  agencyPhone: z.string().optional(),
  /** よみがな・英語名（`translations.txt`）。 */
  nameKana: z.string().min(1).optional(),
  nameEn: z.string().min(1).optional(),
});
export type Agency = z.infer<typeof agencySchema>;

/**
 * 系統（GTFS `routes.txt` の色と訳語。#198、仕様書 v2 §6.5.3）。
 *
 * **キーは `StopPattern.routeName`** である。パターンごとではない——豊中吹田線の
 * 往復 2 パターンは同じ色を持つ。
 */
export const routeInfoSchema = z.object({
  /** `StopPattern.routeName` と一致する。 */
  routeName: z.string().min(1),
  /**
   * GTFS `route_long_name` に出す名前。**省略時は `routeName` をそのまま使う。**
   *
   * **方向でひっくり返さないため**にある（仕様書 v2 §6.5.3）。`route.json` は
   * 往きを `豊中吹田線`、復りを `吹田豊中線` と持つが、GTFS ではどちらも
   * `豊中吹田線` である——**同じ線の往復に 2 つの名前があると、読む側には別の
   * 系統に見える。** 方向は `route_short_name` で分かれる。
   */
  longName: z.string().min(1).optional(),
  /** GTFS `route_color`。**画面のスジ色（`StopPattern.color`）とは別物。** */
  color: gtfsColorSchema,
  /** GTFS `route_text_color`。 */
  textColor: gtfsColorSchema,
  /** よみがな・英語名（`translations.txt`）。回送はよみがなを持たない。 */
  kana: z.string().min(1).optional(),
  en: z.string().min(1).optional(),
  /**
   * 回送の系統か（#247、T-97）。**既定は営業の系統である。**
   *
   * 回送かどうかは停車パターンが持つ（`StopPattern.isDeadhead`）。ここにある
   * のは**系統の側の宣言**であり、2 つが食い違えば R-07 が拾う。
   *
   * **系統で分けるのは、車庫との出入りと停留所間の回送を分けるためである。**
   * どちらも回送だが、走る先も描き方も違う（実装計画書 v2.3 §1.2）。
   */
  isDeadhead: z.boolean().default(false),
});
export type RouteInfo = z.infer<typeof routeInfoSchema>;

/** ネットワーク定義（仕様書 §5.1）。`route.json` の中身。 */
export const networkDefSchema = z.object({
  /** 本ファイルの版数。プロジェクトの `meta.routeVersion` との整合性検査に使う。 */
  version: z.number().int().min(1),
  name: z.string().min(1),
  /** 時刻の刻み（秒）。仕様書 §2.1 より 300 固定。 */
  timeGrain: z.literal(GRAIN_SECONDS),
  /**
   * 事業者（版数 3。#198）。**省略できる**——版数 2 以前は持たないことが正しい。
   * 版数 3 以上で入っていることは R-14 が検証する。
   */
  agency: agencySchema.optional(),
  stops: z.array(stopSchema),
  segments: z.array(segmentSchema),
  patterns: z.array(stopPatternSchema),
  /**
   * 系統ごとの色と訳語（版数 3。#198）。**省略できる**（同上）。
   *
   * 書き出しにしか使わないため、**画面はこの配列を見ない。**
   */
  routes: z.array(routeInfoSchema).optional(),
});
export type NetworkDef = z.infer<typeof networkDefSchema>;
