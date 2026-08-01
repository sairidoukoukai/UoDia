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
import { cursorAt, type DiagramCursor } from './cursor';
import { viewportForCanvas } from './interaction';
import { attachSelectionReveal } from './revealControls';
import { attachTripControls } from './tripControls';
import { attachViewportControls } from './viewportControls';
import { selectDiagramScene, type SceneTheme } from './scene';

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

export interface DiagramCanvasProps {
  /**
   * カーソルが指しているものが変わったときに呼ぶ（ステータスバー、T-32）。
   *
   * **ストアには置かない。** 状態にすると、指を動かすだけで購読が動き、
   * ダイヤグラム全体が 1 秒に 60 回描き直される。指している場所は編集の対象では
   * なく、画面に出すためだけの値である。
   */
  readonly onCursor?: (cursor: DiagramCursor | null) => void;
}

export function DiagramCanvas(props: DiagramCanvasProps): ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // 繋ぎ直さずに差し替えられるようにする。繋ぎ（下の `useEffect`）は 1 度きりで
  // あり、呼び先を直接見ると、親が描き直すたびに canvas を繋ぎ直すことになる。
  const onCursorRef = useRef(props.onCursor);
  useEffect(() => {
    onCursorRef.current = props.onCursor;
  }, [props.onCursor]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;

    // **色は繋ぐときに 1 度だけ読む。** `attachDiagram` がその参照を毎フレーム
    // 使い回すため、場面の組み立てが無駄に走らない（`selectDiagramScene`）。
    // テーマの切り替えに追随させるのは T-39 の仕事である。
    const theme = readTheme(canvas);
    const detachDiagram = attachDiagram({ canvas, store: useAppStore, theme });
    // **送りを先に繋ぐ。** 押し下げは登録した順に届く。送りの側が先に受け取って
    // `preventDefault` を立てることで、選択の側が譲れる（`tripControls.ts`）。
    const detachViewport = attachViewportControls({ canvas, store: useAppStore, theme });
    const detachSelection = attachTripControls({ canvas, store: useAppStore, theme });
    // 時刻表で選ばれた便を画面に入れる（T-38）。**選択が変わったときだけ**動く。
    const detachReveal = attachSelectionReveal({ canvas, store: useAppStore, theme });

    // 指しているものが**変わったときだけ**伝える。同じ 5 分の升の中で指を
    // 動かしている間は、上の画面を描き直す理由が無い。
    let last: DiagramCursor | null = null;
    const report = (cursor: DiagramCursor | null): void => {
      if (cursor?.time === last?.time && cursor?.stopId === last?.stopId) return;
      last = cursor;
      onCursorRef.current?.(cursor);
    };

    const onPointerMove = (event: PointerEvent): void => {
      const state = useAppStore.getState();
      const view = state.project?.view.diagram;
      if (view === undefined) return;

      const rect = canvas.getBoundingClientRect();
      report(
        cursorAt(
          selectDiagramScene(state, theme),
          viewportForCanvas(view, canvas),
          event.clientX - rect.left,
          event.clientY - rect.top,
        ),
      );
    };

    const onPointerLeave = (): void => {
      report(null);
    };

    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerleave', onPointerLeave);

    return () => {
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerleave', onPointerLeave);
      detachReveal();
      detachSelection();
      detachViewport();
      detachDiagram();
    };
  }, []);

  return (
    <div className="diagram">
      {/*
        **焦点を受け取れるようにする。** スペース + 引きずりと Ctrl+0 は
        キーボードの出来事であり、焦点の無い要素には届かない。押した時点で
        焦点を移す（`viewportControls.ts`）。
      */}
      <canvas ref={canvasRef} className="diagram__canvas" aria-label="ダイヤグラム" tabIndex={0} />
    </div>
  );
}
