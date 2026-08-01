/**
 * 上下 2 分割（仕様書 §6.4、T-32）。上がダイヤグラム、下が時刻表。
 *
 * **中身を知らない。** 受け取った 2 つを上下に置き、境界を動かすだけである。
 * どちらに何が入るかを知ると、ダイヤグラムの都合でレイアウトを直すことになる。
 *
 * ## 高さは比率で与える（px で持たない）
 *
 * `flex-grow` に比率をそのまま渡す。px で持つと、窓の大きさが変わるたびに
 * 持っている値を計算し直す必要があり、**保存された比率と画面の高さが食い違う**
 * 瞬間ができる。比率なら、窓がどう変わっても意味が保たれる。
 *
 * ## 引きずりの受け口は窓に張る
 *
 * 押し始めは境界でも、指が離れるのは画面のどこかである。窓で受けておかないと、
 * 外で離した引きずりが終わらないまま残る（`viewportControls.ts` と同じ）。
 */

import { useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { DEFAULT_SPLIT_RATIO, SPLIT_RATIO_LIMITS } from '@/domain/model';
import { useAppStore } from '@/store';
import {
  effectiveRatio,
  isCollapsed,
  ratioAfterKey,
  ratioAtPointer,
  ratioPercent,
  type Pane,
} from './layout';

export interface SplitLayoutProps {
  /** 上（ダイヤグラム）。 */
  readonly top: ReactNode;
  /** 下（時刻表）。 */
  readonly bottom: ReactNode;
}

const LEFT_BUTTON = 0;

export function SplitLayout(props: SplitLayoutProps): ReactElement {
  const splitRatio = useAppStore((state) => state.project?.view.splitRatio ?? DEFAULT_SPLIT_RATIO);
  const maximized = useAppStore((state) => state.ui.maximized);
  const setSplitRatio = useAppStore((state) => state.setSplitRatio);

  const areaRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);

  const ratio = effectiveRatio(splitRatio, maximized);

  /** 引きずった位置を比率にして置く。 */
  const applyPointer = (clientY: number): void => {
    const area = areaRef.current;
    if (area === null) return;

    const rect = area.getBoundingClientRect();
    const next = ratioAtPointer(clientY, rect.top, rect.height);
    if (next !== null) setSplitRatio(next);
  };

  useEffect(() => {
    if (!dragging) return;

    const onMove = (event: PointerEvent): void => {
      applyPointer(event.clientY);
    };
    const onEnd = (): void => {
      setDragging(false);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onEnd);
    window.addEventListener('pointercancel', onEnd);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onEnd);
      window.removeEventListener('pointercancel', onEnd);
    };
    // applyPointer はストアの操作しか使っておらず、掴んでいる間は同じ働きをする。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragging]);

  const paneClass = (pane: Pane): string =>
    `split__pane split__pane--${pane}${isCollapsed(pane, maximized) ? ' split__pane--collapsed' : ''}`;

  return (
    <div className={dragging ? 'split split--dragging' : 'split'} ref={areaRef}>
      <div className={paneClass('diagram')} style={{ flexGrow: ratio }}>
        {props.top}
      </div>

      {/*
        区切り線。**掴めることと、今どこにあるかを読み上げられる形にする**
        （§9.4）。キーボードだけでも動かせる（`ratioAfterKey`）。

        最大化している間は出さない。分ける相手が画面に無く、掴んでも動かす先が
        無い。戻す手立ては最大化の押しボタンと Ctrl+1 / Ctrl+2 にある。
      */}
      {maximized === null && (
        <div
          className="split__separator"
          role="separator"
          tabIndex={0}
          aria-label="ダイヤグラムと時刻表の境界"
          aria-orientation="horizontal"
          aria-valuenow={ratioPercent(ratio)}
          aria-valuemin={ratioPercent(SPLIT_RATIO_LIMITS.min)}
          aria-valuemax={ratioPercent(SPLIT_RATIO_LIMITS.max)}
          onPointerDown={(event) => {
            if (event.button !== LEFT_BUTTON) return;
            // 文字の選択を始めさせない。引きずるたびに画面が青く塗られる。
            event.preventDefault();
            setDragging(true);
          }}
          onKeyDown={(event) => {
            const next = ratioAfterKey(ratio, event.key);
            if (next === null) return;
            event.preventDefault();
            setSplitRatio(next);
          }}
        />
      )}

      <div className={paneClass('timetable')} style={{ flexGrow: 1 - ratio }}>
        {props.bottom}
      </div>
    </div>
  );
}
