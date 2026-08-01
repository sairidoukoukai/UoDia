/**
 * サイドパネル（仕様書 §6.4、T-33）。
 *
 * ダイヤグラムと時刻表の**左に立ち、両方に効く**。どちらを見ているかによらず
 * 同じダイヤ・同じ表示設定を指しているためである（§6.4）。
 *
 * 節の順は「何を編集しているか（ダイヤ）→ 何が描かれるか（パターン・運用）→
 * どう描かれるか（表示）」とした。上から順に読むと、画面に出ているものが
 * 決まっていく。
 */

import type { ReactElement } from 'react';
import { BlockList } from './BlockList';
import { DisplayFilters } from './DisplayFilters';
import { PatternList } from './PatternList';
import { ServiceList } from './ServiceList';

export function SidePanel(): ReactElement {
  return (
    <div className="panel" aria-label="サイドパネル">
      <ServiceList />
      <PatternList />
      <BlockList />
      <DisplayFilters />
    </div>
  );
}
