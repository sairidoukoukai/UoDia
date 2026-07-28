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

import { useCallback, useMemo, useState, type ReactElement } from 'react';
import { suggestBlockId } from '@/domain/block';
import type { DirectionId, Trip } from '@/domain/model';
import type { NetworkIndex } from '@/domain/network';
import {
  addTrip,
  changeTripsPattern,
  copyTripsToService,
  createPullIn,
  createPullOut,
  defaultPatternId,
  duplicateTrips,
  removeTrips,
  shiftTrips,
  sortTripsByOrigin,
  tripIdMinter,
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
import { TimetableGrid, type CommitResult } from './TimetableGrid';
import { TimetableToolbar } from './TimetableToolbar';

const DIRECTIONS: readonly DirectionId[] = [0, 1];

/** 操作が成り立たなかったときに出す言葉。 */
const CANNOT = {
  add: '便を追加できません（この方向の既定パターンがありません）',
  duplicate: '複製できません（時刻が 0:00〜47:55 を外れます）',
  shift: 'ずらせません（時刻が 0:00〜47:55 を外れるか、5 分の倍数ではありません）',
  pattern: 'そのパターンには変えられません',
  copy: '複製できません',
  depot:
    '車庫との行き来を作れません（時刻が 0:00〜47:55 を外れるか、繋がる回送が定義にありません）',
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

  /**
   * 升目の入力を便に反映する。
   *
   * 書き換えるのは 1 便だけであり、他の升目は計算し直さない。**時刻は
   * アンカーから導かれる純粋な関数**であるため（T-08）、便が変われば同じ列の
   * 表示は次の描画でひとりでに揃う。
   */
  const handleCommit = useCallback(
    (at: CellPosition, text: string): CommitResult => {
      if (network === null || timetable === null) return { ok: false, reason: 'notEditable' };

      const outcome = commitCellInput(timetable, at, text, network);
      if (!outcome.ok) return { ok: false, reason: outcome.reason };

      const trip = withSuggestedBlockId(
        outcome.trip,
        timetable.columns[at.column]?.trip,
        serviceTrips,
        network,
      );
      editProject(
        '時刻の入力',
        (project) => {
          for (const service of project.services) {
            const index = service.trips.findIndex((t) => t.tripId === trip.tripId);
            if (index >= 0) service.trips[index] = trip;
          }
        },
        // 同じ升目への打ち直しは 1 回の取り消しでまとめて戻す（仕様書 §6.7）。
        `time:${trip.tripId}:${String(at.row)}`,
      );
      return { ok: true, rounded: outcome.rounded };
    },
    [network, timetable, editProject, serviceTrips],
  );

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

  const handleAdd = (): void => {
    const patternId = network === null ? null : defaultPatternId(network, direction);
    const result =
      network === null || patternId === null
        ? null
        : addTrip(serviceTrips, patternId, network, allTrips());
    if (result === null) {
      setMessage(CANNOT.add);
      return;
    }

    replaceTrips(activeServiceId, '便の追加', result.trips);
    // 追加した便を選んでおく。続けてパターンを変える・複製する、という流れが
    // そのまま繋がる。
    setSelection(result.added.map((trip) => trip.tripId));
    setMessage(null);
  };

  const handleDuplicate = (minutes: number): void => {
    const result =
      network === null
        ? null
        : duplicateTrips(serviceTrips, selectedTripIds, minutes, network, allTrips());
    if (result === null) {
      setMessage(CANNOT.duplicate);
      return;
    }

    replaceTrips(activeServiceId, '便の複製', result.trips);
    setSelection(result.added.map((trip) => trip.tripId));
    setMessage(null);
  };

  const handleRemove = (): void => {
    replaceTrips(activeServiceId, '便の削除', removeTrips(serviceTrips, selectedTripIds));
    clearSelection();
    setMessage(null);
  };

  const handleShift = (minutes: number): void => {
    const next =
      network === null ? null : shiftTrips(serviceTrips, selectedTripIds, minutes, network);
    if (next === null) {
      setMessage(CANNOT.shift);
      return;
    }

    replaceTrips(activeServiceId, '一括シフト', next);
    setMessage(null);
  };

  const handleChangePattern = (patternId: string): void => {
    const next =
      network === null
        ? null
        : changeTripsPattern(serviceTrips, selectedTripIds, patternId, network);
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
   * 既にあれば消し、無ければ作る。作る回送に決めるものは無い——経路は接する
   * 停留所から、時刻は 0 分折返しから、運用番号は営業便から決まる。
   */
  const toggleDepotLink = (
    tripId: string,
    side: 'previous' | 'next',
    create: (trip: Trip, network: NetworkIndex, newId: string) => Trip | null,
    label: string,
  ): void => {
    const existing = links.get(tripId)?.[side];
    if (existing?.kind === 'depot') {
      replaceTrips(
        activeServiceId,
        `${label}の取り消し`,
        removeTrips(serviceTrips, [existing.tripId]),
      );
      setMessage(null);
      return;
    }

    const trip = serviceTrips.find((t) => t.tripId === tripId);
    const created =
      network === null || trip === undefined
        ? null
        : create(trip, network, tripIdMinter(allTrips())());
    if (created === null) {
      setMessage(CANNOT.depot);
      return;
    }

    replaceTrips(activeServiceId, label, [...serviceTrips, created]);
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

  const handleDirection = (id: DirectionId): void => {
    // 見えていない便を操作させない。方向を切り替えたら選択は解く。
    clearSelection();
    setMessage(null);
    // 方向の切り替えは編集であり、取り消せる（保存される設定のため）。
    editProject('方向の切り替え', (project) => {
      project.view.activeDirection = id;
    });
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
        selectedPatternId={commonPatternId(selectedTrips)}
        patterns={patterns}
        otherServices={services.filter((service) => service.serviceId !== activeServiceId)}
        onAdd={handleAdd}
        onDuplicate={handleDuplicate}
        onRemove={handleRemove}
        onChangePattern={handleChangePattern}
        onShift={handleShift}
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
          tripNumbers={tripNumbers}
          onTogglePullOut={(tripId) => {
            toggleDepotLink(tripId, 'previous', createPullOut, '出区');
          }}
          onTogglePullIn={(tripId) => {
            toggleDepotLink(tripId, 'next', createPullIn, '入区');
          }}
        />
      )}
    </section>
  );
}

/**
 * 便に運用番号を提案する（仕様書 §6.1.5、T-23）。
 *
 * 提案するのは、**その便に初めて時刻が入り、運用番号がまだ空欄のとき**だけで
 * ある。仕様書の言う「新規便の作成時」がここに当たる。便を追加した時点では
 * 時刻が無く（`anchor: null`）、始発時刻を要する提案アルゴリズムを走らせようが
 * ないためである。
 *
 * 時刻を打ち直すたびに提案し直さないのは、利用者が消した運用番号を勝手に
 * 書き戻さないためである。提案値は普通の編集と同じように上書きでき、自動で
 * 付いたことは画面上で区別しない（§6.1.5）。
 */
function withSuggestedBlockId(
  trip: Trip,
  before: Trip | undefined,
  trips: readonly Trip[],
  network: NetworkIndex,
): Trip {
  if (before?.anchor != null || trip.blockId !== '') return trip;

  const blockId = suggestBlockId(trip, trips, network);
  return blockId === '' ? trip : { ...trip, blockId };
}

/**
 * 選択中の便に共通するパターン。混ざっていれば空文字。
 *
 * 混在を「先頭の便のパターン」と表示すると、選び直していないのに違うパターンへ
 * 変わったように見える。
 */
function commonPatternId(selectedTrips: readonly Trip[]): string {
  const patternIds = new Set(selectedTrips.map((trip) => trip.patternId));
  const [only] = patternIds;
  return patternIds.size === 1 && only !== undefined ? only : '';
}
