/**
 * ステータスバー（仕様書 §6.4、T-32）。
 *
 * 出すのは**今の画面について問われそうなこと**だけである——指している場所、
 * 便の数、運用の数、保存の状態。どれも状態から導ける値であり、ここでは数えて
 * 並べるだけにする（`store/selectors.ts`）。
 *
 * カーソルの位置だけはストアを通さず、ダイヤグラムから直接受け取る。状態に
 * 置くと、指を動かすだけで購読が動き、ダイヤグラムが描き直される
 * （`DiagramCanvas.tsx`）。
 */

import type { ReactElement } from 'react';
import { formatTime } from '@/domain/time';
import type { DiagramCursor } from '@/features/diagram';
import { selectBlocks, selectIsDirty, selectTrips, useAppStore, type DiagramTool } from '@/store';

/** 作図の道具の呼び名（仕様書 §6.3.3）。メニューの項目名と同じ言葉を使う。 */
const TOOL_LABEL: Record<DiagramTool, string> = {
  select: '選択',
  draw: 'スジ作成',
};

export interface StatusBarProps {
  /** ダイヤグラムのカーソルが指しているもの。外にあれば `null`。 */
  readonly cursor: DiagramCursor | null;
  /** 起動時の読込など、今伝えたいこと。無ければ `null`。 */
  readonly message: string | null;
}

export function StatusBar(props: StatusBarProps): ReactElement {
  const trips = useAppStore(selectTrips);
  const blocks = useAppStore(selectBlocks);
  const dirty = useAppStore(selectIsDirty);
  const tool = useAppStore((state) => state.ui.tool);
  const { cursor } = props;

  return (
    <div className="status-bar">
      {/*
        位置は幅を決めた枠に入れる。指を動かすたびに幅が変わると、右にある
        便数と運用数が揺れて読めない。
      */}
      <span className="status-bar__item status-bar__item--cursor">
        {cursor === null ? '—' : `${formatTime(cursor.time)} ／ ${cursor.shortName}`}
      </span>
      {/*
        いまどちらの道具を持っているか（§6.3.3、#144）。**出さないと、押しても
        何も起きない・押した覚えのない便ができる、のどちらかが起きる。** ツール
        バーを畳んだため（メニューへ集約）、常に見えている場所はここになった。
      */}
      <span className="status-bar__item status-bar__item--tool">{TOOL_LABEL[tool]}</span>
      <span className="status-bar__item status-bar__item--trips">{trips.length} 便</span>
      <span className="status-bar__item status-bar__item--blocks">
        {blocks?.blocks.length ?? 0} 運用
      </span>
      <span className="status-bar__item status-bar__item--save">
        {dirty ? '未保存' : '保存済み'}
      </span>

      {/* 起きたことを伝える欄。読み上げにも届くようにする（§9.4）。 */}
      <span className="status-bar__message" role="status">
        {props.message ?? ''}
      </span>
    </div>
  );
}
