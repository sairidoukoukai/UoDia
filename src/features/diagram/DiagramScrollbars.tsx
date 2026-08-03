/**
 * ダイヤグラムの送りのつまみ（仕様書 §6.2.3、#143）。
 *
 * **どこを見ているのかを、見える形にする。** 掴んで引きずる・ホイールで送るは
 * 覚えていなければ使えない。つまみは、動かせること・いまどのあたりを見ているかを
 * それ自体で示す。
 *
 * ## 動かせないときは出さない
 *
 * 全体が画面に入っているなら、その向きに送る先は無い。押しても何も起きない
 * つまみを置くと、**動かないのは壊れているからだ**と読まれる。
 *
 * ## canvas の中身は状態である
 *
 * 時刻表と違い、ダイヤグラムには「中身の広さ」が無い。広いのは**時間の範囲**で
 * あり、いまどこを見ているかは `view.diagram` が持つ（§6.2.3）。つまみはその値を
 * 読み書きするだけの窓口であり、ここに計算を書かない（範囲は `scrollRanges`）。
 */

import type { ReactElement } from 'react';
import { formatTime, roundToGrain } from '@/domain/time';
import { selectVisibleStops, useAppStore } from '@/store';
import { axisBoundsOfStops, scrollRanges } from './interaction';
import { viewportOf } from './viewport';

/**
 * つまみの刻み。
 *
 * **刻まない。** 刻むと、端が刻みの倍数でないときに**端まで届かない**——
 * つまみを右端まで動かしても、最後の 1 分ぶんが残る。送りは 5 分の倍数に
 * 縛られていない（仕様書 §6.2.3、v4.17）。
 */
const STEP = 'any';

export interface DiagramScrollbarsProps {
  /** canvas の大きさ（CSS px）。見えている範囲を求めるのに要る。 */
  readonly width: number;
  readonly height: number;
}

export function DiagramScrollbars(props: DiagramScrollbarsProps): ReactElement | null {
  const view = useAppStore((state) => state.project?.view.diagram ?? null);
  const stops = useAppStore(selectVisibleStops);
  const setDiagramView = useAppStore((state) => state.setDiagramView);

  // 大きさが分からないうちは出さない。範囲を求められず、端がどこかも言えない。
  if (view === null || props.width <= 0 || props.height <= 0) return null;

  const ranges = scrollRanges(
    view,
    viewportOf(view, props.width, props.height),
    axisBoundsOfStops(stops),
  );
  const canScrollTime = ranges.time.max > ranges.time.min;
  const canScrollAxis = ranges.axis.max > ranges.axis.min;
  if (!canScrollTime && !canScrollAxis) return null;

  return (
    <>
      {canScrollAxis && (
        <input
          type="range"
          className="diagram__scroll diagram__scroll--axis"
          aria-label="縦の送り"
          aria-valuetext={`${stopNameAt(stops, view.scrollAxis)}のあたり`}
          min={ranges.axis.min}
          max={ranges.axis.max}
          step={STEP}
          value={view.scrollAxis}
          onChange={(event) => {
            setDiagramView({ ...view, scrollAxis: Number(event.target.value) });
          }}
        />
      )}

      {canScrollTime && (
        <input
          type="range"
          className="diagram__scroll diagram__scroll--time"
          aria-label="時間の送り"
          // **秒数のままでは読み上げても分からない。** 時刻として読ませる。
          aria-valuetext={formatTime(roundToGrain(view.scrollTime))}
          min={ranges.time.min}
          max={ranges.time.max}
          step={STEP}
          value={view.scrollTime}
          onChange={(event) => {
            setDiagramView({ ...view, scrollTime: Number(event.target.value) });
          }}
        />
      )}
    </>
  );
}

/** その位置にいちばん近い停留所の名前。読み上げのために使う。 */
function stopNameAt(
  stops: readonly { readonly shortName: string; readonly axisPosition: number }[],
  axis: number,
): string {
  let nearest = stops[0];
  for (const stop of stops) {
    if (
      nearest === undefined ||
      Math.abs(stop.axisPosition - axis) < Math.abs(nearest.axisPosition - axis)
    ) {
      nearest = stop;
    }
  }
  return nearest?.shortName ?? '';
}
