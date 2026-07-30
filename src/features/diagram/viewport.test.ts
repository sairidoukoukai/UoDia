/**
 * 座標変換の検証（T-24、仕様書 §6.2.1）。
 *
 * **往復して元に戻ることを確かめる。** 掴む・引きずるという操作は、画面の座標を
 * 時刻に戻せることの上に成り立つ（T-27・T-28）。戻せなければ、掴んだ場所と
 * 動いた先が食い違う。
 */

import { describe, expect, it } from 'vitest';
import { fromHM, MAX_SECONDS } from '@/domain/time';
import {
  AXIS_LABEL_WIDTH,
  DIAGRAM_END_TIME,
  DIAGRAM_START_TIME,
  TIME_LABEL_HEIGHT,
  axisToY,
  fitBackingStore,
  isTimeVisible,
  plotXRange,
  timeToX,
  viewportEndAxis,
  viewportEndTime,
  viewportOf,
  xToTime,
  yToAxis,
  type Viewport,
} from './viewport';

/** 既定の表示設定（7:00 から、1 分 3px、軸 1 単位 6px）に近い視野。 */
const viewport: Viewport = viewportOf(
  { pxPerMinute: 3, pxPerAxisUnit: 6, scrollTime: fromHM(7, 0), scrollAxis: 0 },
  1000,
  600,
);

describe('時刻 → x', () => {
  it('**左端は表示開始時刻**（縦軸ラベルのぶんだけ内側）', () => {
    expect(timeToX(fromHM(7, 0), viewport)).toBe(AXIS_LABEL_WIDTH);
  });

  it('1 分あたり pxPerMinute だけ進む', () => {
    expect(timeToX(fromHM(7, 10), viewport)).toBe(AXIS_LABEL_WIDTH + 30);
    expect(timeToX(fromHM(8, 0), viewport)).toBe(AXIS_LABEL_WIDTH + 180);
  });

  it('表示開始より前は左に出る', () => {
    expect(timeToX(fromHM(6, 50), viewport)).toBe(AXIS_LABEL_WIDTH - 30);
  });

  it('拡大率を上げると間隔が広がる', () => {
    const zoomed = { ...viewport, pxPerMinute: 6 };
    expect(timeToX(fromHM(7, 10), zoomed)).toBe(AXIS_LABEL_WIDTH + 60);
  });
});

describe('軸位置 → y', () => {
  it('**上端は表示開始の軸位置**（横軸ラベルのぶんだけ内側）', () => {
    expect(axisToY(0, viewport)).toBe(TIME_LABEL_HEIGHT);
  });

  it('軸位置 1 単位あたり pxPerAxisUnit だけ下がる', () => {
    // 豊中学舎 0 → 箕面学舎 20 → 工学部前 40。
    expect(axisToY(20, viewport)).toBe(TIME_LABEL_HEIGHT + 120);
    expect(axisToY(40, viewport)).toBe(TIME_LABEL_HEIGHT + 240);
  });

  it('**方向によって反転しない**（両方向を 1 枚に重ねる。§6.2.1）', () => {
    // 上下は軸位置だけで決まる。便の方向は関わらない。
    expect(axisToY(0, viewport)).toBeLessThan(axisToY(40, viewport));
  });
});

describe('往復', () => {
  it('**時刻 → x → 時刻で元に戻る**', () => {
    for (const time of [fromHM(7, 0), fromHM(8, 35), fromHM(21, 55), fromHM(0, 0)]) {
      expect(xToTime(timeToX(time, viewport), viewport)).toBe(time);
    }
  });

  it('**軸位置 → y → 軸位置で元に戻る**', () => {
    for (const axis of [0, 20, 33, 40, 52]) {
      expect(yToAxis(axisToY(axis, viewport), viewport)).toBe(axis);
    }
  });

  it('x → 時刻 → x でも元に戻る', () => {
    for (const x of [0, AXIS_LABEL_WIDTH, 500, 999]) {
      expect(timeToX(xToTime(x, viewport) as never, viewport)).toBeCloseTo(x, 9);
    }
  });

  it('**5 分に丸めない**（丸めるかは使う側が決める）', () => {
    // 1 分 3px なら 1px は 20 秒。丸めていれば 0 か 300 になる。
    expect(xToTime(AXIS_LABEL_WIDTH + 1, viewport) - fromHM(7, 0)).toBe(20);
  });
});

describe('視野の端', () => {
  it('右端の時刻は幅と拡大率から決まる', () => {
    // (幅 − 縦軸ラベル)px ÷ 3px/分。**5 分の倍数にならない**ため、`Seconds`
    // ではなく素の秒数で比べる。
    const minutes = (1000 - AXIS_LABEL_WIDTH) / 3;
    expect(viewportEndTime(viewport)).toBe(fromHM(7, 0) + minutes * 60);
  });

  it('**表せる範囲（47:55）を超えない**', () => {
    const far = { ...viewport, startTime: fromHM(47, 0), pxPerMinute: 3 };
    expect(viewportEndTime(far)).toBe(MAX_SECONDS);
  });

  it('下端の軸位置は高さと拡大率から決まる', () => {
    // (600 − 24)px ÷ 6px/単位 = 96。
    expect(viewportEndAxis(viewport)).toBe(96);
  });
});

describe('横方向のカリング', () => {
  it('視野の中は描く', () => {
    expect(isTimeVisible(fromHM(9, 0), viewport)).toBe(true);
  });

  it('視野の外は描かない', () => {
    expect(isTimeVisible(fromHM(6, 0), viewport)).toBe(false);
    expect(isTimeVisible(fromHM(20, 0), viewport)).toBe(false);
  });

  it('**端でちょうど切れるものは残す**（1 目盛の余裕を持つ）', () => {
    expect(isTimeVisible(fromHM(6, 55), viewport)).toBe(true);
    // 右端は 11:45:20。その 5 分後までは描く。
    expect(isTimeVisible(fromHM(11, 50), viewport)).toBe(true);
    expect(isTimeVisible(fromHM(11, 55), viewport)).toBe(false);
  });
});

describe('表示範囲（仕様書 §6.2.1）', () => {
  it('7:00〜22:00 である', () => {
    expect(DIAGRAM_START_TIME).toBe(fromHM(7, 0));
    expect(DIAGRAM_END_TIME).toBe(fromHM(22, 0));
  });

  it('罫線を引く範囲は描画領域と表示範囲の重なり', () => {
    // 既定では左端が 7:00 のため、描画領域の左端から右端まで。
    expect(plotXRange(viewport)).toEqual({ left: AXIS_LABEL_WIDTH, right: 1000 });
  });

  it('**22:00 より先は空ける**', () => {
    // 20:00 から 1 分 3px なら 22:00 は 144 + 360px。
    expect(plotXRange({ ...viewport, startTime: fromHM(20, 0) })).toEqual({
      left: AXIS_LABEL_WIDTH,
      right: AXIS_LABEL_WIDTH + 360,
    });
  });

  it('**7:00 より前も空ける**', () => {
    // 6:00 から 1 分 3px なら 7:00 は 144 + 180px。
    expect(plotXRange({ ...viewport, startTime: fromHM(6, 0) })?.left).toBe(AXIS_LABEL_WIDTH + 180);
  });

  it('表示範囲が視野から外れたら描く範囲が無い', () => {
    // 左へ出た場合（22:00 が描画領域の左端より左）。
    expect(plotXRange({ ...viewport, startTime: fromHM(22, 0) })).toBeNull();
    // 右へ出た場合（7:00 が canvas の右端より右）。
    expect(plotXRange({ ...viewport, startTime: fromHM(0, 0) })).toBeNull();
  });
});

describe('canvas の裏側の解像度', () => {
  it('**CSS の大きさ × 画素密度に合わせる**（これがぼやけない理由）', () => {
    const canvas = { width: 300, height: 150, clientWidth: 800, clientHeight: 600 };

    expect(fitBackingStore(canvas, 2)).toBe(true);
    expect(canvas).toMatchObject({ width: 1600, height: 1200 });
  });

  it('画素密度が 1 なら CSS の大きさと同じ', () => {
    const canvas = { width: 0, height: 0, clientWidth: 800, clientHeight: 600 };
    fitBackingStore(canvas, 1);
    expect(canvas).toMatchObject({ width: 800, height: 600 });
  });

  it('**既に合っていれば触らない**（代入すると描いた中身が消える）', () => {
    const canvas = { width: 1600, height: 1200, clientWidth: 800, clientHeight: 600 };
    expect(fitBackingStore(canvas, 2)).toBe(false);
  });

  it('端数のある画素密度は丸める', () => {
    const canvas = { width: 0, height: 0, clientWidth: 801, clientHeight: 601 };
    fitBackingStore(canvas, 1.5);
    expect(canvas).toMatchObject({ width: 1202, height: 902 });
  });
});
