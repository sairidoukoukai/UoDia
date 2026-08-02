/**
 * 時刻表（仕様書 §6.1）。方向タブ・操作列・グリッドをストアに繋ぐ。
 *
 * 表示中の方向は `project.view.activeDirection` に持つ（仕様書 §5.10）。
 * 画面の状態としてここに持たないのは、ファイルに保存される設定だからである。
 * 両方に置くと、どちらが正かを決める規則が要る（`store/types.ts`）。
 *
 * ## 便の操作は「作ってから入れ替える」
 *
 * 追加も複製も削除も、`domain/service/operations.ts` の純関数で**次の便の並びを
 * 作ってから**ストアへ入れる（T-21）。Immer の下書きの上で書き換えないのは、
 * できなかったときに履歴へ空の 1 段を積まないためである。操作が成り立つか
 * どうかは、状態に触れる前に分かる。
 */

import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { withSuggestedBlockId } from '@/domain/block';
import type { DirectionId, Trip } from '@/domain/model';
import type { NetworkIndex } from '@/domain/network';
import { diffMinutes } from '@/domain/time';
import { originTime } from '@/domain/trip';
import {
  changeTripsPattern,
  createTrip,
  copyTripsToService,
  patternForStop,
  removeTrips,
  shiftTrips,
  sortTripsByOrigin,
} from '@/domain/service';
import {
  selectActiveDirection,
  selectActiveService,
  selectAllTripTimes,
  selectNetwork,
  selectSelectedTrips,
  selectServices,
  selectTripNumbers,
  selectTrips,
  selectTripsByDirection,
  useAppStore,
} from '@/store';
import { commitCellInput, type CellPosition } from './editing';
import {
  DIRECTION_LABEL,
  blockColorsOf,
  buildTimetable,
  buildTripLinks,
  stopsForDirection,
  type TripLinks,
} from './model';
import { directionToShow } from './sync';
import { TimetableGrid, type CommitResult } from './TimetableGrid';
import { TimetableToolbar } from './TimetableToolbar';

const DIRECTIONS: readonly DirectionId[] = [0, 1];

/** 操作が成り立たなかったときに出す言葉。 */
const CANNOT = {
  create: 'この升目には便を作れません（時刻が 0:00〜47:55 を外れます）',
  shift: 'ずらせません（選んだ便のどれかが 0:00〜47:55 を外れます）',
  pattern: 'そのパターンには変えられません',
  copy: '複製できません',
} as const;

export function Timetable(): ReactElement {
  const network = useAppStore(selectNetwork);
  const direction = useAppStore(selectActiveDirection);
  const shownTrips = useAppStore((state) => selectTripsByDirection(state, direction));
  const times = useAppStore(selectAllTripTimes);
  const editProject = useAppStore((state) => state.editProject);

  // 操作の対象は編集中のダイヤの**全便**である。表に出ているのは片方向だけだが、
  // 便の並びは方向で分かれていない。
  const serviceTrips = useAppStore(selectTrips);
  const activeServiceId = useAppStore((state) => selectActiveService(state)?.serviceId ?? null);
  const services = useAppStore(selectServices);
  const tripNumbers = useAppStore(selectTripNumbers);
  const setSelection = useAppStore((state) => state.selectTrips);
  const setActiveDirection = useAppStore((state) => state.setActiveDirection);
  const clearSelection = useAppStore((state) => state.clearSelection);

  /**
   * 選択中の便の ID。**今あるものだけ**を数える。
   *
   * 選択は履歴に載らないため（`store/store.ts`）、便を追加して取り消すと、
   * 消えた便の ID が選択に残る。生の `ui.selectedTripIds` をそのまま使うと
   * 「2 便を選択中」と出ているのに表が空、という状態になる。
   */
  const selectedTrips = useAppStore(selectSelectedTrips);
  const selectedTripIds = useMemo(() => selectedTrips.map((trip) => trip.tripId), [selectedTrips]);

  const [message, setMessage] = useState<string | null>(null);

  /**
   * 選ばれた便の方向を開く（仕様書 §6.3.1、T-38）。
   *
   * ダイヤグラムで豊中方面のスジを選んだのに時刻表が吹田方面のままでは、
   * 「該当列がハイライトされる」約束が果たせない。
   *
   * **循環しない。** 方向を切り替えても選択は変わらず、切り替えたあとは
   * `directionToShow` が `null` を返すため、1 回で止まる。
   */
  useEffect(() => {
    if (network === null) return;
    const next = directionToShow(selectedTrips, direction, network);
    if (next !== null) setActiveDirection(next);
  }, [selectedTrips, direction, network, setActiveDirection]);

  // 色はダイヤの全便から決める。片方向だけで割り当てると、方向をまたぐ運用が
  // 方向によって違う色になる（仕様書 §5.8）。
  const blockColors = useMemo(() => blockColorsOf(serviceTrips), [serviceTrips]);

  // 前運用・後運用はダイヤの全便から決まる。運用は方向をまたぐため、表示中の
  // 方向だけを見ると繋がりの半分を見失う（仕様書 §6.1.7）。
  const links = useMemo<ReadonlyMap<string, TripLinks>>(
    () =>
      network === null
        ? new Map<string, TripLinks>()
        : buildTripLinks(serviceTrips, network, tripNumbers),
    [serviceTrips, network, tripNumbers],
  );

  const timetable = useMemo(() => {
    if (network === null) return null;
    return buildTimetable(shownTrips, stopsForDirection(network, direction), network, times, links);
  }, [network, shownTrips, direction, times, links]);

  /** ダイヤの便を丸ごと入れ替える。 */
  const replaceTrips = (serviceId: string | null, label: string, next: readonly Trip[]): void => {
    editProject(label, (project) => {
      const service = project.services.find((s) => s.serviceId === serviceId);
      if (service === undefined) return;
      // **写しを作らない。** 何も変わらなかった操作は同じ配列を返してくる
      // （`domain/service/operations.ts`）。ここで複製すると、その約束が
      // 台無しになり、履歴に空の 1 段が積まれる。
      service.trips = next as Trip[];
    });
  };

  /** ID の重複を避けるために見る、プロジェクト全体の便。 */
  const allTrips = (): readonly Trip[] =>
    useAppStore.getState().project?.services.flatMap((service) => service.trips) ?? [];

  /**
   * 升目の入力を便に反映する（仕様書 §6.1.2）。
   *
   * 3 つの場合がある。
   *
   * | 打った先 | 起きること |
   * | --- | --- |
   * | 便の升目 | その便のアンカーがその停留所へ移る |
   * | **空の列** | **その時刻でその停留所を通る便ができる** |
   * | 便の升目・複数選択中 | 選んだ便が**同じ差分だけ**動く（一括シフトの置き換え） |
   *
   * 書き換えた便以外の升目は計算し直さない。**時刻はアンカーから導かれる純粋な
   * 関数**であるため（T-08）、便が変われば同じ列の表示は次の描画でひとりでに揃う。
   */
  const handleCommit = (at: CellPosition, text: string): CommitResult => {
    if (network === null || timetable === null) return { ok: false, reason: 'notEditable' };

    const outcome = commitCellInput(timetable, at, text, network);
    if (!outcome.ok) return { ok: false, reason: outcome.reason };

    if (outcome.kind === 'create') {
      const patternId = patternForStop(network, direction, outcome.stopId);
      const result =
        patternId === null
          ? null
          : createTrip(serviceTrips, patternId, outcome.stopId, outcome.time, network, allTrips());
      if (result === null) {
        setMessage(CANNOT.create);
        return { ok: false, reason: 'unrepresentable' };
      }

      replaceTrips(activeServiceId, '便の入力', result.trips);
      setMessage(null);
      return { ok: true, rounded: outcome.rounded };
    }

    const before = timetable.columns[at.column]?.trip;
    const trip = withSuggestedBlockId(outcome.trip, before, serviceTrips, network);

    // 選択中の便がまとめて動く（§6.1.2）。打った便は打った時刻になり、
    // ほかは同じ差分だけ動く。**1 便でも範囲を外れるなら何も動かさない。**
    const others = selectedTripIds.filter((id) => id !== trip.tripId);
    const moved =
      before === undefined || others.length === 0 || !selectedTripIds.includes(trip.tripId)
        ? serviceTrips
        : shiftTrips(serviceTrips, others, shiftMinutes(before, trip, network), network);
    if (moved === null) {
      setMessage(CANNOT.shift);
      return { ok: false, reason: 'unrepresentable' };
    }

    editProject(
      '時刻の入力',
      (project) => {
        for (const service of project.services) {
          if (service.serviceId === activeServiceId) service.trips = moved as Trip[];
          const index = service.trips.findIndex((t) => t.tripId === trip.tripId);
          if (index >= 0) service.trips[index] = trip;
        }
      },
      // 同じ升目への打ち直しは 1 回の取り消しでまとめて戻す（仕様書 §6.7）。
      `time:${trip.tripId}:${String(at.row)}`,
    );
    setMessage(null);
    return { ok: true, rounded: outcome.rounded };
  };

  /** その便に時刻を消す（仕様書 §6.1.2）。便は残る。 */
  const handleClearTime = (tripId: string): void => {
    editProject('時刻を消す', (project) => {
      for (const service of project.services) {
        const trip = service.trips.find((t) => t.tripId === tripId);
        if (trip !== undefined) trip.anchor = null;
      }
    });
    setMessage(null);
  };

  const handleRemove = (): void => {
    replaceTrips(activeServiceId, '便の削除', removeTrips(serviceTrips, selectedTripIds));
    clearSelection();
    setMessage(null);
  };

  const handleChangePattern = (tripId: string, patternId: string): void => {
    const next =
      network === null ? null : changeTripsPattern(serviceTrips, [tripId], patternId, network);
    if (next === null) {
      setMessage(CANNOT.pattern);
      return;
    }

    replaceTrips(activeServiceId, 'パターンの変更', next);
    setMessage(null);
  };

  const handleSort = (): void => {
    if (network === null) return;
    replaceTrips(activeServiceId, '始発時刻順に並べ替え', sortTripsByOrigin(serviceTrips, network));
    setMessage(null);
  };

  const handleCopyTo = (serviceId: string): void => {
    const target = services.find((service) => service.serviceId === serviceId);
    const result =
      target === undefined ? null : copyTripsToService(serviceTrips, target.trips, selectedTripIds);
    if (target === undefined || result === null) {
      setMessage(CANNOT.copy);
      return;
    }

    replaceTrips(serviceId, 'ダイヤ間コピー', result.trips);
    // 写した先は今の画面に出ていない。起きたことを言葉で伝えるほかない。
    setMessage(`${target.serviceName} へ ${String(result.added.length)} 便を複製しました`);
  };

  const handleChangeBlockId = (tripId: string, blockId: string): void => {
    editProject(
      '運用番号の変更',
      (project) => {
        for (const service of project.services) {
          const trip = service.trips.find((t) => t.tripId === tripId);
          if (trip !== undefined) trip.blockId = blockId;
        }
      },
      // 打っている間の 1 文字ずつを 1 回の取り消しでまとめて戻す（仕様書 §6.7）。
      `block:${tripId}`,
    );
  };

  /**
   * 出区・入区を切り替える（仕様書 §6.1.7）。
   *
   * **書き換えるのは真偽値 1 つだけ**である。回送便は保存されず、この値から
   * 展開される（`domain/trip/deadhead.ts`）。経路も時刻も運用番号も、営業便が
   * 決まっていれば決まる（0 分折返し）。
   */
  const toggleDepotLink = (tripId: string, side: 'pullOut' | 'pullIn', label: string): void => {
    editProject(label, (project) => {
      for (const service of project.services) {
        const trip = service.trips.find((t) => t.tripId === tripId);
        if (trip !== undefined) trip[side] = !trip[side];
      }
    });
    setMessage(null);
  };

  const handleSelectTrip = (tripId: string, additive: boolean): void => {
    if (!additive) {
      setSelection([tripId]);
      return;
    }
    setSelection(
      selectedTripIds.includes(tripId)
        ? selectedTripIds.filter((id) => id !== tripId)
        : [...selectedTripIds, tripId],
    );
  };

  /**
   * 方向タブを押した（仕様書 §6.1.1）。
   *
   * **押して切り替えたときだけ選択を解く。** 見えていない便を一括シフトの
   * 巻き添えにしないためである。選択に追随して切り替わる場合（下の効果）は
   * 解かない——そちらは「選ばれた便を見せる」ための切り替えである。
   */
  const handleDirection = (id: DirectionId): void => {
    clearSelection();
    setMessage(null);
    setActiveDirection(id);
  };

  const patterns = useMemo(
    () =>
      network === null
        ? []
        : // 回送は選択肢に出さない。出区・入区の切り替えでしか作らない（§6.1.7）。
          network.def.patterns.filter(
            (pattern) => pattern.directionId === direction && !pattern.isDeadhead,
          ),
    [network, direction],
  );

  return (
    <section className="timetable-pane">
      <div className="timetable__tabs" role="tablist" aria-label="方向">
        {DIRECTIONS.map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={id === direction}
            className={
              id === direction ? 'timetable__tab timetable__tab--active' : 'timetable__tab'
            }
            onClick={() => {
              handleDirection(id);
            }}
          >
            {DIRECTION_LABEL[id]}
          </button>
        ))}
      </div>

      <TimetableToolbar
        selectedCount={selectedTripIds.length}
        otherServices={services.filter((service) => service.serviceId !== activeServiceId)}
        onSort={handleSort}
        onCopyTo={handleCopyTo}
        message={message}
      />

      {timetable === null ? (
        <p className="timetable__empty">ネットワーク定義を読み込んでいます…</p>
      ) : (
        <TimetableGrid
          timetable={timetable}
          onCommit={handleCommit}
          selectedTripIds={selectedTripIds}
          onSelectTrip={handleSelectTrip}
          onRemoveSelection={handleRemove}
          blockColors={blockColors}
          onChangeBlockId={handleChangeBlockId}
          patterns={patterns}
          onChangePattern={handleChangePattern}
          onClearTime={handleClearTime}
          tripNumbers={tripNumbers}
          onTogglePullOut={(tripId) => {
            toggleDepotLink(tripId, 'pullOut', '出区の切り替え');
          }}
          onTogglePullIn={(tripId) => {
            toggleDepotLink(tripId, 'pullIn', '入区の切り替え');
          }}
        />
      )}
    </section>
  );
}

/** 打ち直しで便が動いた分（分）。一括シフトに使う（仕様書 §6.1.2）。 */
function shiftMinutes(before: Trip, after: Trip, network: NetworkIndex): number {
  const from = originTime(before, network);
  const to = originTime(after, network);
  // 時刻が入っていなかった便は「動いた」とは言えない。ほかの便は動かさない。
  return from === null || to === null ? 0 : diffMinutes(to, from);
}
