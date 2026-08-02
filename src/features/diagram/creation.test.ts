/**
 * 作図の当たり判定の検証（T-30、仕様書 §6.3.3）。
 */

import { describe, expect, it } from 'vitest';
import type { DiagramView } from '@/domain/model';
import { fromHM } from '@/domain/time';
import { STOP_LINE_TOLERANCE, creationTargetAt } from './creation';
import { DEFAULT_DIAGRAM_VIEW } from './interaction';
import type { DiagramScene, SceneStop, SceneTheme } from './scene';
import { AXIS_LABEL_WIDTH, TIME_LABEL_HEIGHT, viewportOf, type Viewport } from './viewport';

const THEME: SceneTheme = {
  background: '#fff',
  axis: '#000',
  grid: '#ccc',
  gridFaint: '#eee',
  label: '#333',
};

function stop(stopId: string, axisPosition: number): SceneStop {
  return { stopId, shortName: stopId, axisPosition, gridStyle: 'normal' };
}

// 営業所は縦軸に並ばない（#118）。引ける線は営業停留所だけである。
const SCENE: DiagramScene = {
  stops: [stop('a', 0), stop('b', 20)],
  trips: [],
  selectedTripIds: new Set(),
  selectionRect: null,
  tripShift: null,
  theme: THEME,
};

const VIEW: DiagramView = DEFAULT_DIAGRAM_VIEW;
/** 7:00 が左端、1 分 3px、軸 1 単位 8px。 */
const VIEWPORT: Viewport = viewportOf(VIEW, 1000, 420);

/** 停留所 `b`（軸 20 = 上端から 160px）の線の上。 */
const ON_B = { x: AXIS_LABEL_WIDTH + 180, y: TIME_LABEL_HEIGHT + 160 };

describe('停留所線を押す', () => {
  it('押した停留所と時刻を返す', () => {
    const target = creationTargetAt(SCENE, VIEWPORT, ON_B.x, ON_B.y);

    expect(target?.stopId).toBe('b');
    // 左端から 180px = 60 分後 = 8:00。
    expect(target?.time).toBe(fromHM(8, 0));
  });

  it('**5 分に丸める**（打てない時刻の便を作らない）', () => {
    const target = creationTargetAt(SCENE, VIEWPORT, ON_B.x + 7, ON_B.y);
    expect(target?.time).toBe(fromHM(8, 0));

    const later = creationTargetAt(SCENE, VIEWPORT, ON_B.x + 9, ON_B.y);
    expect(later?.time).toBe(fromHM(8, 5));
  });

  it('線から少し外れていても拾う', () => {
    const above = creationTargetAt(SCENE, VIEWPORT, ON_B.x, ON_B.y - (STOP_LINE_TOLERANCE - 1));
    expect(above?.stopId).toBe('b');
  });

  it('**離れていれば何も起きない**（覚えのない便を作らない）', () => {
    const far = creationTargetAt(SCENE, VIEWPORT, ON_B.x, ON_B.y - (STOP_LINE_TOLERANCE + 5));
    expect(far).toBeNull();
  });

  it('近いほうの停留所を選ぶ', () => {
    // 軸 0 と 20 のちょうど中間より少し上なら `a`。
    const upper = creationTargetAt(SCENE, VIEWPORT, ON_B.x, TIME_LABEL_HEIGHT + 8, 100);
    expect(upper?.stopId).toBe('a');
  });

  it('**営業所の帯には引かせない**（車庫発は出区として作る。§6.1.7）', () => {
    const onDepot = creationTargetAt(SCENE, VIEWPORT, ON_B.x, TIME_LABEL_HEIGHT + 52 * 6);
    expect(onDepot).toBeNull();
  });

  it('目盛の帯では作らない', () => {
    expect(creationTargetAt(SCENE, VIEWPORT, AXIS_LABEL_WIDTH - 1, ON_B.y)).toBeNull();
    expect(creationTargetAt(SCENE, VIEWPORT, ON_B.x, TIME_LABEL_HEIGHT - 1)).toBeNull();
  });

  it('表せる時刻の範囲を外れていれば作らない', () => {
    const before: Viewport = { ...VIEWPORT, startTime: -7200 };
    expect(creationTargetAt(SCENE, before, AXIS_LABEL_WIDTH + 1, ON_B.y)).toBeNull();

    const after: Viewport = { ...VIEWPORT, startTime: fromHM(47, 55) };
    expect(creationTargetAt(SCENE, after, AXIS_LABEL_WIDTH + 30, ON_B.y)).toBeNull();
  });

  it('停留所が無ければ作らない', () => {
    expect(creationTargetAt({ ...SCENE, stops: [] }, VIEWPORT, ON_B.x, ON_B.y)).toBeNull();
  });
});
