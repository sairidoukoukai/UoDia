/**
 * ダイヤグラムの器（仕様書 §6.2.5、T-24）。
 *
 * React が持つのは `<canvas>` の場所だけである。**中身は React の外で描く**
 * （`canvasHost.ts`）。状態が変わるたびに React を通すと、1 秒に 60 回の
 * 再描画が仮想 DOM の差分計算を引き連れてくる。
 */

import { useEffect, useRef, type ReactElement } from 'react';
import { useAppStore } from '@/store';
import { attachDiagram } from './canvasHost';
import { DiagramControls } from './DiagramControls';
import { attachSelectionControls } from './selectionControls';
import { attachViewportControls } from './viewportControls';
import type { SceneTheme } from './scene';

/** 画面のテーマから描画に使う色を読む（仕様書 §9.4）。 */
function readTheme(element: Element): SceneTheme {
  const style = getComputedStyle(element);
  const read = (name: string, fallback: string): string =>
    style.getPropertyValue(name).trim() || fallback;

  return {
    background: read('--color-bg', '#ffffff'),
    axis: read('--color-border', '#cccccc'),
    grid: read('--color-grid', '#e4e4e4'),
    gridFaint: read('--color-grid-faint', '#f0f0f0'),
    label: read('--color-fg-muted', '#666666'),
    lane: read('--color-bg-accent', '#f4f4f4'),
  };
}

export function DiagramCanvas(): ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;

    // **色は繋ぐときに 1 度だけ読む。** `attachDiagram` がその参照を毎フレーム
    // 使い回すため、場面の組み立てが無駄に走らない（`selectDiagramScene`）。
    // テーマの切り替えに追随させるのは T-39 の仕事である。
    const theme = readTheme(canvas);
    const detachDiagram = attachDiagram({ canvas, store: useAppStore, theme });
    // **送りを先に繋ぐ。** 押し下げは登録した順に届く。送りの側が先に受け取って
    // `preventDefault` を立てることで、選択の側が譲れる（`selectionControls.ts`）。
    const detachViewport = attachViewportControls({ canvas, store: useAppStore, theme });
    const detachSelection = attachSelectionControls({ canvas, store: useAppStore, theme });

    return () => {
      detachSelection();
      detachViewport();
      detachDiagram();
    };
  }, []);

  return (
    <div className="diagram">
      <DiagramControls />
      {/*
        **焦点を受け取れるようにする。** スペース + 引きずりと Ctrl+0 は
        キーボードの出来事であり、焦点の無い要素には届かない。押した時点で
        焦点を移す（`viewportControls.ts`）。
      */}
      <canvas ref={canvasRef} className="diagram__canvas" aria-label="ダイヤグラム" tabIndex={0} />
    </div>
  );
}
