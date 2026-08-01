/**
 * ツールバー（仕様書 §6.4、T-32）。
 *
 * **メニューバーの代わりではない。** ファイル操作も取り消しもメニューに並ぶのが
 * 本来であり（T-37）、ここに出すのは「よく押すものを手の届く所に置く」ためで
 * ある。作図モードの切り替え（[選択][スジ作成]）は T-30 が足す。
 *
 * 表示の切り替えをここに置いたのは、**最大化から戻る手立てを目に見える所に
 * 残す**ためである。ショートカット（Ctrl+1 / Ctrl+2）だけだと、押してしまった
 * 利用者が元の画面に戻れない。
 */

import type { ReactElement, ReactNode } from 'react';
import {
  selectCanRedo,
  selectCanUndo,
  selectRedoLabel,
  selectUndoLabel,
  useAppStore,
} from '@/store';
import { togglePane, type Pane } from './layout';

export interface ToolbarProps {
  readonly onNew: () => void;
  readonly onOpen: () => void;
  readonly onSave: () => void;
  readonly onSaveAs: () => void;
  /** 本来の置き場所ができるまでの仮の操作（App が渡す）。 */
  readonly extra?: ReactNode;
}

const PANE_LABEL: Record<Pane, string> = {
  diagram: 'ダイヤグラム',
  timetable: '時刻表',
};

export function Toolbar(props: ToolbarProps): ReactElement {
  const undo = useAppStore((state) => state.undo);
  const redo = useAppStore((state) => state.redo);
  const canUndo = useAppStore(selectCanUndo);
  const canRedo = useAppStore(selectCanRedo);
  const undoLabel = useAppStore(selectUndoLabel);
  const redoLabel = useAppStore(selectRedoLabel);

  const maximized = useAppStore((state) => state.ui.maximized);
  const setMaximizedPane = useAppStore((state) => state.setMaximizedPane);

  return (
    <div className="toolbar" role="toolbar" aria-label="ツールバー">
      <div className="toolbar__group">
        <button type="button" onClick={props.onNew}>
          新規
        </button>
        <button type="button" onClick={props.onOpen}>
          開く
        </button>
        <button type="button" onClick={props.onSave}>
          上書き保存
        </button>
        <button type="button" onClick={props.onSaveAs}>
          名前を付けて保存
        </button>
      </div>

      <div className="toolbar__group">
        {/* 何が戻るのかを持ち手に出す。押す前に分かる（仕様書 §6.7）。 */}
        <button
          type="button"
          disabled={!canUndo}
          title={undoLabel === null ? undefined : `${undoLabel} を元に戻す`}
          onClick={() => {
            undo();
          }}
        >
          元に戻す
        </button>
        <button
          type="button"
          disabled={!canRedo}
          title={redoLabel === null ? undefined : `${redoLabel} をやり直す`}
          onClick={() => {
            redo();
          }}
        >
          やり直す
        </button>
      </div>

      <div className="toolbar__group">
        {(['diagram', 'timetable'] as const).map((pane) => (
          <button
            key={pane}
            type="button"
            aria-pressed={maximized === pane}
            title={`${PANE_LABEL[pane]}を最大化（Ctrl+${pane === 'diagram' ? '1' : '2'}）`}
            onClick={() => {
              setMaximizedPane(togglePane(maximized, pane));
            }}
          >
            {PANE_LABEL[pane]}を最大化
          </button>
        ))}
      </div>

      {props.extra}
    </div>
  );
}
