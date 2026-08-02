/**
 * スジの右クリックメニュー（仕様書 §6.3.4、T-31）。
 *
 * **規則はドメインにある。** 複製も削除もパターン変更も、時刻表が呼ぶのと同じ
 * 純関数を通る（`domain/service/operations.ts`）。ここにあるのは「押されたら
 * 何を呼ぶか」だけであり、画面が 2 つあっても起きることは 1 つである。
 *
 * ## 出すのは選ばれている便に対してである
 *
 * 右クリックした時点で、そのスジは選ばれている（`tripControls`）。複数選んで
 * いれば**まとめて効く**——1 本だけに効かせると、選んだ意味が消える。
 */

import { useEffect, useRef, type ReactElement } from 'react';
import type { Trip } from '@/domain/model';
import { changeTripsPattern, pasteTrips, removeTrips } from '@/domain/service';
import { focusTripColumn } from '@/features/timetable';
import { selectActiveService, selectNetwork, selectSelectedTrips, useAppStore } from '@/store';

/** メニューを出す場所（canvas の左上を原点とする px）。 */
export interface MenuPosition {
  readonly x: number;
  readonly y: number;
}

/** 閉じ方。 */
export interface CloseOptions {
  /**
   * 焦点をダイヤグラムへ返さない。
   *
   * **「時刻表へジャンプ」だけが真になる。** 焦点を移すことがその項目の中身で
   * あり、閉じる処理が canvas へ引き戻しては、押した意味が消える。
   */
  readonly keepFocus?: boolean;
}

export interface TripContextMenuProps {
  readonly at: MenuPosition;
  /** 閉じる。既定では焦点をダイヤグラムへ返す（呼び出し側の仕事）。 */
  readonly onClose: (options?: CloseOptions) => void;
}

export function TripContextMenu(props: TripContextMenuProps): ReactElement | null {
  const { at, onClose } = props;
  const network = useAppStore(selectNetwork);
  const service = useAppStore(selectActiveService);
  const selected = useAppStore(selectSelectedTrips);
  const editProject = useAppStore((state) => state.editProject);
  const setSelection = useAppStore((state) => state.selectTrips);
  const clearSelection = useAppStore((state) => state.clearSelection);

  const menuRef = useRef<HTMLDivElement>(null);

  // 開いたら先頭へ焦点を移す。キーボードだけでも辿れる（§9.4）。
  useEffect(() => {
    menuRef.current?.querySelector('button')?.focus();
  }, []);

  // 外を押したら閉じる。**押した先の操作は通す**——閉じるためだけの
  // 空振りを 1 回挟むと、続けて何かを押すのに 2 回押すことになる。
  useEffect(() => {
    const onPointerDown = (event: Event): void => {
      // 窓そのものを指す出来事もある（要素の外で離したときなど）。
      const target = event.target instanceof Node ? event.target : null;
      if (target !== null && menuRef.current?.contains(target) === true) return;
      onClose();
    };
    window.addEventListener('pointerdown', onPointerDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
    };
  }, [onClose]);

  if (network === null || service === null || selected.length === 0) return null;

  const first = selected[0];
  if (first === undefined) return null;

  const tripIds = selected.map((trip) => trip.tripId);
  const allTrips = (): readonly Trip[] =>
    useAppStore.getState().project?.services.flatMap((item) => item.trips) ?? [];

  /** そのダイヤの便を丸ごと入れ替える。 */
  const replace = (label: string, next: readonly Trip[]): void => {
    editProject(label, (project) => {
      const target = project.services.find((item) => item.serviceId === service.serviceId);
      if (target !== undefined) target.trips = next as Trip[];
    });
  };

  const duplicate = (): void => {
    const result = pasteTrips(service.trips, selected, allTrips());
    if (result === null) return;

    replace('便の複製', result.trips);
    // 複製したものを選んでおく。続けてずらす、という流れがそのまま繋がる。
    setSelection(result.added.map((trip) => trip.tripId));
    onClose();
  };

  const remove = (): void => {
    replace('便の削除', removeTrips(service.trips, tripIds));
    clearSelection();
    onClose();
  };

  const changePattern = (patternId: string): void => {
    const next = changeTripsPattern(service.trips, tripIds, patternId, network);
    // できないパターンには変えない（アンカーの置き場所が無い等）。
    if (next !== null) replace('パターンの変更', next);
    onClose();
  };

  const changeBlockId = (blockId: string): void => {
    editProject(
      '運用番号の変更',
      (project) => {
        for (const item of project.services) {
          for (const trip of item.trips) {
            if (tripIds.includes(trip.tripId)) trip.blockId = blockId;
          }
        }
      },
      // 打っている間の 1 文字ずつを 1 回の取り消しでまとめて戻す（§6.7）。
      `block:${tripIds.join(',')}`,
    );
  };

  const jump = (): void => {
    // 選択は既に移っている。時刻表は選択に追随して列を画面へ入れるため
    // （T-38）、ここでするのは**焦点を移すこと**だけである。
    focusTripColumn(first.tripId);
    onClose({ keepFocus: true });
  };

  // 回送は選択肢に出さない。出区・入区の切り替えでしか作らない（§6.1.7）。
  const direction = network.patternIndex(first.patternId)?.pattern.directionId;
  const patterns = network.def.patterns.filter(
    (pattern) => pattern.directionId === direction && !pattern.isDeadhead,
  );

  // **同じパターン・同じ運用番号のときだけ、その値を出す。** 揃っていない選択に
  // 1 つの値を出すと、開いただけで揃ってしまったように見える。
  const commonPattern = selected.every((trip) => trip.patternId === first.patternId)
    ? first.patternId
    : '';
  const commonBlockId = selected.every((trip) => trip.blockId === first.blockId)
    ? first.blockId
    : '';

  return (
    <div
      ref={menuRef}
      className="trip-menu"
      role="menu"
      aria-label="スジの操作"
      style={{ left: at.x, top: at.y }}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        onClose();
      }}
    >
      <p className="trip-menu__title">
        {selected.length === 1 ? '1 便' : `${String(selected.length)} 便`}
      </p>

      <button type="button" role="menuitem" onClick={duplicate}>
        複製
      </button>
      <button type="button" role="menuitem" onClick={remove}>
        削除
      </button>

      <label className="trip-menu__field">
        パターン{' '}
        <select
          value={commonPattern}
          onChange={(event) => {
            changePattern(event.target.value);
          }}
        >
          {commonPattern === '' && <option value="">（まちまち）</option>}
          {patterns.map((pattern) => (
            <option key={pattern.patternId} value={pattern.patternId}>
              {pattern.patternId}
            </option>
          ))}
        </select>
      </label>

      <label className="trip-menu__field">
        運用{' '}
        <input
          className="trip-menu__block"
          value={commonBlockId}
          onChange={(event) => {
            changeBlockId(event.target.value);
          }}
        />
      </label>

      <button type="button" role="menuitem" onClick={jump}>
        時刻表へジャンプ
      </button>
    </div>
  );
}
