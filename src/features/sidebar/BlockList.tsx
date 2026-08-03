/**
 * 運用の一覧（仕様書 §5.8、§6.2.4、T-33）。
 *
 * 運用は**導出値**である（`deriveBlocks`）。ここに出ているものはどれも保存されて
 * おらず、便の運用番号を打ち替えれば数も並びも変わる。色も一覧上の位置から
 * 決まっており（`assignBlockColors`）、ダイヤグラムの「運用で着色」と同じ道具を
 * 使うことで、**一覧とスジの色が必ず一致する。**
 *
 * 稼働時間帯は出庫から入庫までである。出入区が付いていない運用では、先頭便の
 * 始発と末尾便の終着になる（`Block.trips` は時刻順であり、回送も展開済み）。
 */

import { useMemo, type ReactElement } from 'react';
import { formatTime } from '@/domain/time';
import { blockColorsOf } from '@/features/timetable';
import { selectBlocks, selectTrips, selectView, useAppStore } from '@/store';
import { withHidden } from './filters';

/** 空の一覧。**毎回作らない**——参照が変わると購読が動く。 */
const NO_IDS: readonly string[] = [];

/** 色を 1 つも選んでいない状態。 */
const NO_COLORS: Readonly<Record<string, string>> = Object.freeze({});

export function BlockList(): ReactElement {
  const derivation = useAppStore(selectBlocks);
  const trips = useAppStore(selectTrips);
  // 必要な項目だけを購読する（T-40）。送りのたびに描き直さないためである。
  const hidden = useAppStore((state) => selectView(state)?.hiddenBlockIds ?? NO_IDS);
  const chosen = useAppStore((state) => selectView(state)?.blockColors ?? NO_COLORS);
  const editProject = useAppStore((state) => state.editProject);

  const blocks = derivation?.blocks ?? [];

  // 運用番号 → 色。**時刻表・ダイヤグラムと同じ道具で割り当てる**（`blockColorsOf`）。
  // ここで数え直すと、同じ規則を 3 か所に書くことになり、いつか食い違う。
  const colors = useMemo(() => blockColorsOf(trips, chosen), [trips, chosen]);

  const toggle = (blockId: string, show: boolean): void => {
    editProject('運用の表示の変更', (project) => {
      project.view.hiddenBlockIds = withHidden(
        project.view.hiddenBlockIds,
        blockId,
        show,
      ) as string[];
    });
  };

  /**
   * 運用の色を選ぶ（#148）。`null` で自動に戻す。
   *
   * **プロジェクトの編集として履歴に載る。** 着色モードやフィルタと同じで、
   * ファイルに保存される見え方だからである（§5.10、§6.7）。
   */
  const choose = (blockId: string, color: string | null): void => {
    editProject('運用の色の変更', (project) => {
      if (color === null) {
        // 選んでいない状態に戻す。**空の色を覚えない**——覚えると、次に運用を
        // 足したときに「選んだ色」として扱われる。
        const { [blockId]: _removed, ...rest } = project.view.blockColors;
        project.view.blockColors = rest;
      } else {
        project.view.blockColors = { ...project.view.blockColors, [blockId]: color };
      }
    });
  };

  const unassigned = derivation?.unassigned.length ?? 0;

  return (
    <section className="panel__section">
      <h2 className="panel__title">運用</h2>

      {blocks.length === 0 ? (
        <p className="panel__empty">
          {trips.length === 0 ? '便がありません' : '運用番号が付いた便がありません'}
        </p>
      ) : (
        <ul className="panel__list">
          {blocks.map((block) => {
            // 数えるのは営業便だけである。回送は営業便から展開された線であり
            // （§6.1.7）、数に入れると「2 便の運用」が 4 便に見える。
            const revenue = block.trips.filter((entry) => !entry.isDeadhead).length;
            const from = block.pullOutTime ?? block.trips[0].originTime;
            // 運用は必ず 1 便以上である（`BlockTrips`）。末尾が取れない場合は無い。
            const to = block.pullInTime ?? (block.trips.at(-1) ?? block.trips[0]).terminalTime;

            return (
              <li key={block.blockId} className="panel__row">
                <input
                  type="checkbox"
                  aria-label={`運用 ${block.blockId} を表示`}
                  checked={!hidden.includes(block.blockId)}
                  onChange={(event) => {
                    toggle(block.blockId, event.target.checked);
                  }}
                />
                {/*
                  色を選ぶ（#148）。選んでいない運用は並び順から自動で決まり、
                  **選んだものだけを覚える**ため、運用を足しても動かない。
                */}
                <input
                  type="color"
                  className="panel__color"
                  aria-label={`運用 ${block.blockId} の色`}
                  value={colors.get(block.blockId) ?? '#000000'}
                  onChange={(event) => {
                    choose(block.blockId, event.target.value);
                  }}
                />
                <span className="panel__id">{block.blockId}</span>
                <span className="panel__note">
                  {formatTime(from)}–{formatTime(to)}
                </span>
                <span className="panel__count">{revenue} 便</span>
                {/* 選んだ色があるときだけ出す。押しても何も起きない印を並べない。 */}
                {chosen[block.blockId] !== undefined && (
                  <button
                    type="button"
                    className="panel__reset"
                    title={`運用 ${block.blockId} の色を自動に戻す`}
                    aria-label={`運用 ${block.blockId} の色を自動に戻す`}
                    onClick={() => {
                      choose(block.blockId, null);
                    }}
                  >
                    ↺
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/* 運用番号が空欄の便は運用に入らない（検証の V-07）。数だけ伝える。 */}
      {unassigned > 0 && <p className="panel__empty">運用番号が空欄の便が {unassigned} 件</p>}
    </section>
  );
}
