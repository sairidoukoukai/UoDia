/**
 * 選ばれたスジを画面に入れる検証（T-38、仕様書 §6.3.1）。
 *
 * 受入条件のうち「**スクロールが無限ループしない**」は、ここで**べき等**として
 * 確かめる——一度寄せた結果をもう一度渡すと `null` が返る。往復して揺れ続ける
 * 経路が存在しないことが、この 1 つの性質から言える。
 */

import { describe, expect, it } from 'vitest';
import type { DiagramView } from '@/domain/model';
import { fromHM, seconds } from '@/domain/time';
import { DEFAULT_DIAGRAM_VIEW, type AxisBounds } from './interaction';
import { REVEAL_LEAD_MINUTES, viewToReveal } from './reveal';
import type { DiagramScene, SceneStop, SceneTrip, SceneTheme } from './scene';
import { viewportOf, type Viewport } from './viewport';

const THEME: SceneTheme = {
  background: '#fff',
  axis: '#000',
  grid: '#ccc',
  gridFaint: '#eee',
  label: '#333',
  lane: '#f4f4f4',
};

const BOUNDS: AxisBounds = { min: 0, max: 52 };

function stop(stopId: string, axisPosition: number): SceneStop {
  return { stopId, stopName: stopId, axisPosition, gridStyle: 'normal', isDepot: false };
}

const STOPS: readonly SceneStop[] = [stop('a', 0), stop('b', 20), stop('c', 40), stop('depot', 52)];

/** `a` を出て `b` に着く便。 */
function trip(tripId: string, hours: number, minutes = 0): SceneTrip {
  return {
    tripId,
    sourceTripId: tripId,
    patternId: 'S1',
    color: '#000',
    lineDash: [],
    directionId: 0,
    isDeadhead: false,
    blockId: 'A',
    tripNumber: '1',
    points: [
      { stopId: 'a', time: fromHM(hours, minutes) },
      { stopId: 'b', time: seconds(fromHM(hours, minutes) + 1200) },
    ],
  };
}

function sceneOf(trips: readonly SceneTrip[], selected: readonly string[]): DiagramScene {
  return {
    stops: STOPS,
    trips,
    selectedTripIds: new Set(selected),
    selectionRect: null,
    tripShift: null,
    theme: THEME,
  };
}

const VIEW: DiagramView = DEFAULT_DIAGRAM_VIEW;
/** 既定の視野（7:00 から、1 分 3px）で 1000×420 の画面。右端はおよそ 11:45。 */
const VIEWPORT: Viewport = viewportOf(VIEW, 1000, 420);

describe('見えているなら動かさない', () => {
  it('選ばれたスジが画面にあるとき、視野はそのまま', () => {
    const scene = sceneOf([trip('t1', 8)], ['t1']);
    expect(viewToReveal(scene, VIEWPORT, VIEW, BOUNDS)).toBeNull();
  });

  it('何も選ばれていなければ動かさない', () => {
    const scene = sceneOf([trip('t1', 8)], []);
    expect(viewToReveal(scene, VIEWPORT, VIEW, BOUNDS)).toBeNull();
  });

  it('**一部でも見えていれば動かさない**（長い便で縮尺の合わない位置へ飛ばない）', () => {
    // 6:50 発の便。始発は画面の左外だが、終点（7:10）は見えている。
    const scene = sceneOf([trip('t1', 6, 50)], ['t1']);
    expect(viewToReveal(scene, VIEWPORT, VIEW, BOUNDS)).toBeNull();
  });

  it('描く大きさが無いうちは動かさない', () => {
    const scene = sceneOf([trip('t1', 20)], ['t1']);
    const empty = viewportOf(VIEW, 0, 0);
    expect(viewToReveal(scene, empty, VIEW, BOUNDS)).toBeNull();
  });
});

describe('見えていないなら寄せる', () => {
  it('右の外にある便まで送る。**少し手前から見せる**', () => {
    // 画面は 7:00〜11:45。12:00 の便は右の外にある。
    const scene = sceneOf([trip('t1', 12)], ['t1']);
    const next = viewToReveal(scene, VIEWPORT, VIEW, BOUNDS);

    expect(next?.scrollTime).toBe(fromHM(12, 0) - REVEAL_LEAD_MINUTES * 60);
  });

  it('拡大率は変えない（見え方まで勝手に変えない）', () => {
    const scene = sceneOf([trip('t1', 12)], ['t1']);
    const next = viewToReveal(scene, VIEWPORT, VIEW, BOUNDS);

    expect(next?.pxPerMinute).toBe(VIEW.pxPerMinute);
    expect(next?.pxPerAxisUnit).toBe(VIEW.pxPerAxisUnit);
  });

  it('**見えている向きは動かさない**（横だけ外れたら縦は据え置き）', () => {
    // 縦に拡げて（1 単位 20px）軸 5〜24 だけが見えている状態にする。便が通る
    // 軸 0〜20 のうち一部は見えているため、縦は動かす理由が無い。
    const scrolled: DiagramView = { ...VIEW, pxPerAxisUnit: 20, scrollAxis: 5 };
    const scene = sceneOf([trip('t1', 12)], ['t1']);
    const next = viewToReveal(scene, viewportOf(scrolled, 1000, 420), scrolled, BOUNDS);

    expect(next?.scrollTime).toBeLessThan(fromHM(12, 0));
    expect(next?.scrollAxis).toBe(5);
  });

  it('縦に外れていれば縦も寄せる', () => {
    // 画面の下端よりさらに下（軸 52 の営業所）だけを通る便。
    const depotTrip: SceneTrip = {
      ...trip('t1', 8),
      points: [
        { stopId: 'depot', time: fromHM(8, 0) },
        { stopId: 'c', time: fromHM(8, 20) },
      ],
    };
    // 縦に 1 単位 20px まで拡げると、画面には軸 0〜19 しか入らない。
    const zoomed: DiagramView = { ...VIEW, pxPerAxisUnit: 20 };
    const viewport = viewportOf(zoomed, 1000, 420);
    const next = viewToReveal(sceneOf([depotTrip], ['t1']), viewport, zoomed, BOUNDS);

    expect(next?.scrollAxis).toBeGreaterThan(0);
  });

  it('**表示範囲の外にある便へは送らない**（送っても画面に入らない）', () => {
    // 4:00 の便。表示範囲（7:00〜22:00）より前にあり、送り先が無い。
    const scene = sceneOf([trip('t1', 4)], ['t1']);

    expect(viewToReveal(scene, VIEWPORT, VIEW, BOUNDS)).toBeNull();
  });

  it('回送スジも一緒に見せる（選択は保存されている便を指す）', () => {
    const deadhead: SceneTrip = {
      ...trip('t1#out', 12),
      sourceTripId: 't1',
      isDeadhead: true,
    };
    const next = viewToReveal(sceneOf([deadhead], ['t1']), VIEWPORT, VIEW, BOUNDS);

    expect(next).not.toBeNull();
  });
});

describe('循環しない', () => {
  it('**一度寄せたら、もう動かない**（受入条件）', () => {
    const scene = sceneOf([trip('t1', 12)], ['t1']);
    const next = viewToReveal(scene, VIEWPORT, VIEW, BOUNDS);
    if (next === null) throw new Error('寄せられていません');

    const again = viewToReveal(scene, viewportOf(next, 1000, 420), next, BOUNDS);
    expect(again).toBeNull();
  });

  it('**送りきれない便でも 1 回で止まる**（22:00 より後ろの便）', () => {
    // 表示範囲（〜22:00）より後ろにある便。送りは端で頭打ちになり、画面には
    // 入らない。それでも「動かせるところまで動かして、そこで止まる」。
    const scene = sceneOf([trip('t1', 25)], ['t1']);
    const first = viewToReveal(scene, VIEWPORT, VIEW, BOUNDS);
    if (first === null) throw new Error('寄せられていません');

    expect(viewToReveal(scene, viewportOf(first, 1000, 420), first, BOUNDS)).toBeNull();
  });
});
