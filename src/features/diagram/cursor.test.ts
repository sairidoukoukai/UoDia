/**
 * カーソルが指しているものの検証（T-32、仕様書 §6.4 のステータスバー）。
 *
 * 場面（`DiagramScene`）と視野（`Viewport`）だけを渡す。canvas も DOM も要らない
 * ——画面の位置から意味を取り出す計算は、どこに描いているかと関わりが無い。
 */

import { describe, expect, it } from 'vitest';
import { fromHM } from '@/domain/time';
import { cursorAt } from './cursor';
import type { DiagramScene, SceneStop, SceneTheme } from './scene';
import { AXIS_LABEL_WIDTH, TIME_LABEL_HEIGHT, type Viewport } from './viewport';

const THEME: SceneTheme = {
  background: '#fff',
  axis: '#000',
  grid: '#ccc',
  gridFaint: '#eee',
  label: '#333',
  lane: '#f4f4f4',
};

function stop(stopId: string, stopName: string, axisPosition: number): SceneStop {
  return { stopId, stopName, axisPosition, gridStyle: 'normal', isDepot: false };
}

const SCENE: DiagramScene = {
  stops: [stop('toyonaka', '豊中学舎', 0), stop('minoh', '箕面学舎', 40)],
  trips: [],
  selectedTripIds: new Set(),
  selectionRect: null,
  tripShift: null,
  theme: THEME,
};

/** 7:00 が描画領域の左端、1 分 = 3px、軸 1 単位 = 6px。 */
const VIEWPORT: Viewport = {
  startTime: fromHM(7, 0),
  startAxis: 0,
  pxPerMinute: 3,
  pxPerAxisUnit: 6,
  originX: AXIS_LABEL_WIDTH,
  originY: TIME_LABEL_HEIGHT,
  width: 800,
  height: 400,
};

describe('カーソルが指しているもの', () => {
  it('横の位置が時刻、縦の位置が停留所になる', () => {
    // 左端から 90px = 30 分後 = 7:30。上端は軸 0（豊中学舎）。
    const cursor = cursorAt(SCENE, VIEWPORT, AXIS_LABEL_WIDTH + 90, TIME_LABEL_HEIGHT);

    expect(cursor?.time).toBe(fromHM(7, 30));
    expect(cursor?.stopId).toBe('toyonaka');
    expect(cursor?.stopName).toBe('豊中学舎');
  });

  it('**5 分に丸める**（打てない時刻を出さない）', () => {
    // 7px = 2 分 20 秒。5 分刻みのこのソフトで 7:02 と出すと、そこに便を
    // 置けるように見える（仕様書 §2.1）。
    const cursor = cursorAt(SCENE, VIEWPORT, AXIS_LABEL_WIDTH + 7, TIME_LABEL_HEIGHT);

    expect(cursor?.time).toBe(fromHM(7, 0));
  });

  it('一番近い停留所を指す', () => {
    // 軸 40（箕面学舎）は上端から 240px。その少し上でも箕面学舎が近い。
    const near = cursorAt(SCENE, VIEWPORT, AXIS_LABEL_WIDTH + 90, TIME_LABEL_HEIGHT + 230);
    expect(near?.stopId).toBe('minoh');

    // 中ほど（軸 20 = 120px）より上なら豊中学舎。
    const upper = cursorAt(SCENE, VIEWPORT, AXIS_LABEL_WIDTH + 90, TIME_LABEL_HEIGHT + 100);
    expect(upper?.stopId).toBe('toyonaka');
  });

  it('**目盛の帯は指していない**（線を引く場所ではない）', () => {
    expect(cursorAt(SCENE, VIEWPORT, AXIS_LABEL_WIDTH - 1, TIME_LABEL_HEIGHT + 10)).toBeNull();
    expect(cursorAt(SCENE, VIEWPORT, AXIS_LABEL_WIDTH + 10, TIME_LABEL_HEIGHT - 1)).toBeNull();
  });

  it('表せる時刻の範囲を外れていれば何も指さない', () => {
    // 左へ送って 0:00 より前を出したとき、負の時刻を出さない。
    const scrolled: Viewport = { ...VIEWPORT, startTime: -3600 };
    expect(cursorAt(SCENE, scrolled, AXIS_LABEL_WIDTH, TIME_LABEL_HEIGHT)).toBeNull();

    const late: Viewport = { ...VIEWPORT, startTime: fromHM(47, 55) };
    expect(cursorAt(SCENE, late, AXIS_LABEL_WIDTH + 30, TIME_LABEL_HEIGHT)).toBeNull();
  });

  it('停留所が読み込まれていなければ何も指さない', () => {
    const empty: DiagramScene = { ...SCENE, stops: [] };
    expect(cursorAt(empty, VIEWPORT, AXIS_LABEL_WIDTH + 90, TIME_LABEL_HEIGHT)).toBeNull();
  });
});
