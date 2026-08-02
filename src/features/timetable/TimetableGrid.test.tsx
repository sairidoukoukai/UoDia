// @vitest-environment jsdom

/**
 * 時刻表グリッドの描画の検証（T-19、仕様書 §6.1.1）。
 *
 * 中身の組み立ては `model.test.ts` が受け持つ。ここで固定するのは
 * **画面に何が見えるか**である。経由しない升目の `−`・アンカーの目印・
 * 停留所名の列が残ること——いずれも間違えても型検査を通ってしまう。
 */

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// jsdom 環境では `import.meta.url` がファイルの場所を指さないため、node:fs で
// 読めない。Vite の生読み込みに任せる。
import routeJson from '../../../data/route.json?raw';
import type { Trip } from '@/domain/model';
import { loadNetworkDef, type NetworkIndex } from '@/domain/network';
import { fromHM, type Seconds } from '@/domain/time';
import { allTimes, numberTrips } from '@/domain/trip';
import type { CellPosition } from './editing';
import {
  blockColorsOf,
  buildTimetable,
  buildTripLinks,
  stopsForDirection,
  type TripLinks,
} from './model';
import { TimetableGrid, type CommitResult } from './TimetableGrid';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const loaded = loadNetworkDef(routeJson);
if (!loaded.ok) throw new Error('route.json を読み込めません');
const network: NetworkIndex = loaded.network;

let counter = 0;

function makeTrip(
  patternId: string,
  hours: number,
  minutes: number,
  extra: Partial<Trip> = {},
): Trip {
  const pattern = network.patternIndex(patternId);
  if (pattern === undefined) throw new Error(`パターン ${patternId} がありません`);
  counter += 1;
  return {
    tripId: `t${String(counter)}`,
    patternId,
    anchor: { stopId: pattern.originStopId, time: fromHM(hours, minutes) },
    blockId: '',
    pullOut: false,
    pullIn: false,
    ...extra,
  };
}

let container: HTMLDivElement;

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
});

afterEach(() => {
  container.remove();
});

/** 確定の呼び出しを記録し、決めておいた結果を返す。 */
function stubCommit(result: CommitResult = { ok: true, rounded: false }) {
  return vi.fn<(at: CellPosition, text: string) => CommitResult>(() => result);
}

/** 選択と運用にまつわる差し替え（T-21・T-22）。省くと素の表になる。 */
interface RenderExtras {
  readonly selectedTripIds?: readonly string[];
  readonly onSelectTrip?: (tripId: string, additive: boolean) => void;
  readonly onRemoveSelection?: () => void;
  readonly onChangeBlockId?: (tripId: string, blockId: string) => void;
  readonly links?: ReadonlyMap<string, TripLinks>;
  /**
   * 前後の繋がりと便番号を求めるときに見る便。既定は表に出す便。
   *
   * 回送便を列にしないのはセレクタの役目であり（`selectTripsByDirection`）、
   * 表は渡されたものをそのまま描く。回送や別方向の便を繋がりに入れたいときは、
   * ここへ渡す。
   */
  readonly allTrips?: readonly Trip[];
  readonly onTogglePullOut?: (tripId: string) => void;
  readonly onTogglePullIn?: (tripId: string) => void;
  readonly onChangePattern?: (tripId: string, patternId: string) => void;
  readonly onClearTime?: (tripId: string) => void;
  /**
   * 便の右に並べる空の列の数（T-52）。
   *
   * 既定は 0 とする。**空の列そのものを試す場合以外は邪魔になる**ためであり、
   * 実際の画面では `EMPTY_COLUMNS` が使われる。
   */
  readonly emptyColumns?: number;
}

function render(
  trips: readonly Trip[],
  onCommit: (at: CellPosition, text: string) => CommitResult = stubCommit(),
  extras: RenderExtras = {},
): void {
  const times = new Map<string, ReadonlyMap<string, Seconds>>(
    trips.map((trip) => [trip.tripId, allTimes(trip, network)]),
  );
  const all = extras.allTrips ?? trips;
  const numbers = numberTrips(all, network);
  const timetable = buildTimetable(
    trips,
    stopsForDirection(network, 0),
    network,
    times,
    extras.links ?? buildTripLinks(all, network, numbers),
    extras.emptyColumns ?? 0,
  );

  const root = createRoot(container);
  act(() => {
    root.render(
      <TimetableGrid
        timetable={timetable}
        direction={0}
        onCommit={onCommit}
        selectedTripIds={extras.selectedTripIds ?? []}
        onSelectTrip={extras.onSelectTrip ?? (() => undefined)}
        onRemoveSelection={extras.onRemoveSelection ?? (() => undefined)}
        blockColors={blockColorsOf(trips)}
        onChangeBlockId={extras.onChangeBlockId ?? (() => undefined)}
        tripNumbers={numbers}
        patterns={network.def.patterns.filter((p) => p.directionId === 0 && !p.isDeadhead)}
        onChangePattern={extras.onChangePattern ?? (() => undefined)}
        onClearTime={extras.onClearTime ?? (() => undefined)}
        onTogglePullOut={extras.onTogglePullOut ?? (() => undefined)}
        onTogglePullIn={extras.onTogglePullIn ?? (() => undefined)}
      />,
    );
  });
}

/**
 * 見出しの升目の中身（パターン・運用の 2 行）。運用は記入欄（T-22）であるため
 * その値を読む。便番号は列見出しであり、{@link columnHeaders} で読む。
 */
function headTexts(): (string | null)[] {
  return [...container.querySelectorAll('thead td')].map((td) => {
    const field = td.querySelector('input, select');
    return field === null ? td.textContent : (field as HTMLInputElement | HTMLSelectElement).value;
  });
}

/** 停留所の行の見出し。前運用・後運用の行（T-50）は除く。 */
function stopHeadings(): (string | null)[] {
  return [...container.querySelectorAll('tbody .timetable__stop')].map((th) => th.textContent);
}

/** 列見出し（便番号）の文字列。先頭は隅の「停留所」。 */
function columnHeaders(): (string | null)[] {
  return [...container.querySelectorAll('thead tr:first-child th')].map((th) => th.textContent);
}

/** 運用番号の記入欄。 */
function blockField(index: number): HTMLInputElement {
  const fields = container.querySelectorAll<HTMLInputElement>('.timetable__block');
  const field = fields[index];
  if (field === undefined) throw new Error(`${String(index)} 列目の運用番号欄がありません`);
  return field;
}

/** 列見出しの押しボタン。 */
function columnButton(index: number): HTMLButtonElement {
  const buttons = container.querySelectorAll<HTMLButtonElement>('thead .timetable__column');
  const button = buttons[index];
  if (button === undefined) throw new Error(`${String(index)} 列目の見出しがありません`);
  return button;
}

/** 位置から升目の要素を引く。 */
function cell(row: number, column: number): HTMLElement {
  const element = container.querySelector<HTMLElement>(
    `[data-cell="${String(row)}:${String(column)}"]`,
  );
  if (element === null) throw new Error(`升目 ${String(row)}:${String(column)} がありません`);
  return element;
}

/** 今 focus を持っている升目の位置。 */
function focused(): string | null {
  return document.activeElement?.getAttribute('data-cell') ?? null;
}

function press(key: string, init: KeyboardEventInit = {}): void {
  const target = document.activeElement ?? container;
  act(() => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...init }));
  });
}

function click(row: number, column: number): void {
  const target = cell(row, column);
  act(() => {
    target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  });
}

/** 今開いている時刻の編集欄。運用番号の欄（T-22）と取り違えないよう絞る。 */
function input(): HTMLInputElement | null {
  return container.querySelector('.timetable__input');
}

function type(text: string): void {
  const field = input();
  if (field === null) throw new Error('編集欄が開いていません');
  act(() => {
    // React が値の変化を拾えるよう、ネイティブの setter を通す。React は
    // 前回の値を覚えており、そのまま代入すると変化として扱われない。
    const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    const setValue = descriptor?.set?.bind(field);
    setValue?.(text);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

/** 吹田方面の行: 豊中・箕面・コンベ・工学部・車庫。 */
const ROW = { toyonaka: 0, minoh: 1, engineering: 3 } as const;

/** 行の見出し（停留所の略称）から、その行の升目の文字列を並べて返す。 */
function rowOf(shortName: string): (string | null)[] {
  const heading = [...container.querySelectorAll('tbody th')].find(
    (th) => th.textContent === shortName,
  );
  if (heading === undefined) throw new Error(`${shortName} の行がありません`);
  return [...(heading.parentElement?.querySelectorAll('td') ?? [])].map((td) => td.textContent);
}

/**
 * どちらの方向を見ているか（#136）。
 *
 * タブは表の外にあり、升目を追っているあいだは視野から外れる。**表そのものが
 * 名乗る。**
 */
describe('表の名前', () => {
  it('**方向を出す**（目を落とした先に手がかりを置く）', () => {
    render([makeTrip('S1', 8, 0)]);

    expect(container.querySelector('caption')?.textContent).toContain('吹田方面');
  });

  it('**起点と終点を添える**（行が上から下へどちらへ進むのか）', () => {
    render([makeTrip('S1', 8, 0)]);

    expect(container.querySelector('caption')?.textContent).toContain('豊中 → 工学部');
  });

  it('便が 1 つも無くても名乗る', () => {
    render([]);

    expect(container.querySelector('caption')?.textContent).toContain('吹田方面');
  });
});

describe('見出し', () => {
  it('**見出しは 3 行**（列見出し = 便番号・パターン・運用。T-47）', () => {
    render([makeTrip('S1', 8, 0, { blockId: 'A' })]);

    // 左の列は行の名前を並べる。**3 行すべてに名前がある**（T-55）。
    const headings = [...container.querySelectorAll('thead th[scope="row"]')].map(
      (th) => th.textContent,
    );
    expect(headings).toEqual(['便番号', 'パターン', '運用']);
    expect(columnHeaders()).toEqual(['便番号', 'E1']);
    expect(headTexts()).toEqual(['S1', 'A']);
  });

  it('**行先は行を割かず、パターンの手掛かりとして残す**', () => {
    render([makeTrip('S1', 8, 0)]);

    const pattern = container.querySelector('thead tr:nth-child(2) td');
    expect(pattern?.querySelector('select')?.value).toBe('S1');
    expect(pattern?.getAttribute('title')).toBe('直行吹田');
  });

  it('**パターンは一覧から選ぶ**（打ち込めないものは選べない。T-52）', () => {
    const onChangePattern = vi.fn<(tripId: string, patternId: string) => void>();
    const trips = [makeTrip('S1', 8, 0)];
    render(trips, undefined, { onChangePattern });

    const select = container.querySelector<HTMLSelectElement>('.timetable__pattern');
    // 出るのはその方向の営業パターンだけ。回送は無い（§6.1.7）。
    expect([...(select?.options ?? [])].map((option) => option.value)).toEqual([
      'S1',
      'S3',
      'S2',
      'M2',
    ]);

    act(() => {
      const descriptor = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
      descriptor?.set?.bind(select)('S3');
      select?.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(onChangePattern).toHaveBeenCalledWith(trips[0]?.tripId, 'S3');
  });

  it('便番号が付かない便は印を出す（空欄と区別する）', () => {
    // 時刻が未入力の便には番号が付かない（仕様書 §6.1.6）。
    render([makeTrip('S1', 8, 0, { anchor: null })]);
    expect(columnHeaders()).toEqual(['便番号', '―']);
    expect(headTexts()).toEqual(['S1', '']);
    // 運用は記入欄であるため、空であることを薄い印で見せる（§6.1.3）。
    expect(blockField(0).placeholder).toBe('―');
  });

  it('**列になるのは営業便だけ**（回送は前運用・後運用の欄に出る。T-51）', () => {
    render([makeTrip('S1', 8, 0, { pullOut: true }), makeTrip('S1', 9, 0)]);
    expect(columnHeaders()).toEqual(['便番号', 'E1', 'E2']);
  });

  it('参照が壊れた列は目印を付ける', () => {
    render([makeTrip('S1', 8, 0, { patternId: '無いパターン' })]);

    expect(headTexts()).toEqual(['無いパターン', '']);
    expect(container.querySelector('thead tr:nth-child(2) td')?.getAttribute('title')).toBe(
      '参照が壊れています',
    );
    expect(container.querySelector('.timetable__head--broken')).not.toBeNull();
  });
});

describe('升目（受入条件）', () => {
  it('**直行便の箕面は `−`、箕面経由便は時刻**', () => {
    render([makeTrip('S1', 8, 0), makeTrip('S3', 8, 30)]);
    expect(rowOf('箕面')).toEqual(['−', '8:50']);
  });

  it('**アンカーの升目が目印で分かる**', () => {
    render([makeTrip('S1', 8, 0)]);

    const anchors = [...container.querySelectorAll('.timetable__cell--anchor')];
    expect(anchors).toHaveLength(1);
    expect(anchors[0]?.textContent).toBe('8:00');
  });

  it('**取扱区分の記号は出さない**（T-54、仕様書 §6.1.1）', () => {
    // 箕面学舎は S2 では始発（乗車のみ）、M2 では終着（降車のみ）。
    // どちらも時刻だけを出す——列を見れば始発か終着かは分かる。
    render([makeTrip('S2', 8, 0), makeTrip('M2', 8, 0)]);
    expect(rowOf('箕面')).toEqual(['8:00', '8:20']);
  });

  it('時刻が未入力なら空欄にする（`−` とは違う）', () => {
    render([makeTrip('S1', 8, 0, { anchor: null })]);
    expect(rowOf('豊中')).toEqual(['']);
    expect(rowOf('箕面')).toEqual(['−']);
  });
});

describe('並び', () => {
  it('行は縦軸の順。**営業所の行は無い**（T-50）', () => {
    render([makeTrip('S1', 8, 0)]);
    // **略称で出す**（#116）。正式名を出すと左の固定列がそのぶん太り、時刻の
    // 列を押しのける。
    expect(stopHeadings()).toEqual(['豊中', '箕面', 'コンベ前', '工学部']);
  });

  it('停留所名の列は横スクロールしても残す', () => {
    render([makeTrip('S1', 8, 0)]);
    // 位置の固定は CSS が行う。ここでは目印が付いていることだけを確かめる。
    expect(container.querySelector('tbody .timetable__stop')).not.toBeNull();
    expect(container.querySelector('tbody th')?.className).toContain('timetable__link-head');
    expect(container.querySelector('.timetable__scroll')).not.toBeNull();
  });
});

describe('便が無いとき', () => {
  it('**便が 0 本でも表を出す**（空の列に打てば便になる。T-52）', () => {
    render([], undefined, { emptyColumns: 3 });

    expect(container.querySelector('table')).not.toBeNull();
    expect(columnHeaders()).toEqual(['便番号', '', '', '']);
    // どの升目にも打てる。`−`（経由しない）は出さない。
    expect(rowOf('豊中')).toEqual(['', '', '']);
  });
});

describe('多数の便', () => {
  it('100 便でも全部の列を描く（間引かない）', () => {
    const trips = Array.from({ length: 100 }, (_, index) =>
      makeTrip('S1', 6 + Math.floor(index / 12), (index % 12) * 5),
    );
    render(trips);

    // 列見出し（便番号）は 100 本。左端の行見出しは scope="row" であり含まない。
    expect(container.querySelectorAll('thead tr:first-child th[scope="col"]')).toHaveLength(100);
    expect(rowOf('豊中')).toHaveLength(100);
  });
});

describe('焦点の移動（受入条件）', () => {
  it('押した升目に焦点が移る', () => {
    render([makeTrip('S1', 8, 0), makeTrip('S1', 9, 0)]);
    click(ROW.toyonaka, 1);
    expect(focused()).toBe('0:1');
  });

  it('**矢印キーだけで動ける**', () => {
    render([makeTrip('S1', 8, 0), makeTrip('S1', 9, 0)]);
    click(ROW.toyonaka, 0);

    press('ArrowDown');
    expect(focused()).toBe('1:0');
    press('ArrowRight');
    expect(focused()).toBe('1:1');
    press('ArrowUp');
    expect(focused()).toBe('0:1');
    press('ArrowLeft');
    expect(focused()).toBe('0:0');
  });

  it('Tab は右へ動かす（表の外へ出ない）', () => {
    render([makeTrip('S1', 8, 0), makeTrip('S1', 9, 0)]);
    click(ROW.toyonaka, 0);

    press('Tab');
    expect(focused()).toBe('0:1');
    press('Tab', { shiftKey: true });
    expect(focused()).toBe('0:0');
  });

  it('焦点を持てる升目は 1 つだけ（Tab で表を通り抜けられる）', () => {
    render([makeTrip('S1', 8, 0), makeTrip('S1', 9, 0)]);
    click(ROW.toyonaka, 0);

    const reachable = [...container.querySelectorAll('[data-cell]')].filter(
      (el) => el.getAttribute('tabindex') === '0',
    );
    expect(reachable).toHaveLength(1);
  });

  it('読み込んだだけでは焦点を奪わない', () => {
    render([makeTrip('S1', 8, 0)]);
    expect(focused()).toBeNull();
  });
});

describe('編集の開始', () => {
  it('**数字を打つと、その文字から上書き入力が始まる**', () => {
    render([makeTrip('S1', 8, 0)]);
    click(ROW.toyonaka, 0);
    press('8');

    expect(input()?.value).toBe('8');
  });

  it('Enter は今の時刻を打ち直せる形で開く', () => {
    render([makeTrip('S1', 8, 5)]);
    click(ROW.toyonaka, 0);
    press('Enter');

    expect(input()?.value).toBe('8:05');
  });

  it('**経由しない升目では編集が始まらない**', () => {
    render([makeTrip('S1', 8, 0)]);
    click(ROW.minoh, 0);
    press('8');

    expect(input()).toBeNull();
  });

  it('Ctrl を伴う打鍵では始まらない（ショートカットを潰さない）', () => {
    render([makeTrip('S1', 8, 0)]);
    click(ROW.toyonaka, 0);
    press('z', { ctrlKey: true });

    expect(input()).toBeNull();
  });
});

describe('編集の確定（受入条件）', () => {
  it('**Enter で確定し、下の升目へ移る**', () => {
    const commit = stubCommit();
    render([makeTrip('S1', 8, 0)], commit);

    click(ROW.toyonaka, 0);
    press('8');
    type('830');
    press('Enter');

    expect(commit).toHaveBeenCalledWith({ row: 0, column: 0 }, '830');
    expect(input()).toBeNull();
    expect(focused()).toBe('1:0');
  });

  it('**Tab で確定し、右の升目へ移る**', () => {
    const commit = stubCommit();
    render([makeTrip('S1', 8, 0), makeTrip('S1', 9, 0)], commit);

    click(ROW.toyonaka, 0);
    press('9');
    press('Tab');

    expect(commit).toHaveBeenCalledWith({ row: 0, column: 0 }, '9');
    expect(focused()).toBe('0:1');
  });

  it('**キーボードだけで次々に入力できる**', () => {
    const commit = stubCommit();
    render([makeTrip('S1', 8, 0), makeTrip('S1', 9, 0)], commit);

    click(ROW.toyonaka, 0);
    press('8');
    type('800');
    press('Tab');
    // 焦点が移った先で、そのまま打ち始められる。
    press('9');
    type('900');
    press('Enter');

    expect(commit.mock.calls).toEqual([
      [{ row: 0, column: 0 }, '800'],
      [{ row: 0, column: 1 }, '900'],
    ]);
    expect(focused()).toBe('1:1');
  });

  it('Escape で取り消す（確定しない）', () => {
    const commit = stubCommit();
    render([makeTrip('S1', 8, 0)], commit);

    click(ROW.toyonaka, 0);
    press('8');
    press('Escape');

    expect(commit).not.toHaveBeenCalled();
    expect(input()).toBeNull();
    expect(focused()).toBe('0:0');
  });

  it('編集欄から離れたら確定する', () => {
    const commit = stubCommit();
    render([makeTrip('S1', 8, 0)], commit);

    click(ROW.toyonaka, 0);
    press('8');
    const field = input();
    act(() => {
      // React の onBlur は、泡立つ focusout に対応している。
      field?.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    });

    expect(commit).toHaveBeenCalledWith({ row: 0, column: 0 }, '8');
  });
});

describe('受け付けられない入力', () => {
  it('**編集状態を保ったまま警告する**（打った内容を消さない）', () => {
    render([makeTrip('S1', 8, 0)], stubCommit({ ok: false, reason: 'unparsable' }));

    click(ROW.toyonaka, 0);
    press('あ');
    press('Enter');

    expect(input()?.value).toBe('あ');
    expect(input()?.getAttribute('aria-invalid')).toBe('true');
    expect(cell(ROW.toyonaka, 0).className).toContain('timetable__cell--invalid');
  });

  it('打ち直すと警告が消える', () => {
    render([makeTrip('S1', 8, 0)], stubCommit({ ok: false, reason: 'unparsable' }));

    click(ROW.toyonaka, 0);
    press('あ');
    press('Enter');
    type('830');

    expect(cell(ROW.toyonaka, 0).className).not.toContain('timetable__cell--invalid');
  });

  it('空のまま確定したら、警告せずに閉じる', () => {
    render([makeTrip('S1', 8, 0)], stubCommit({ ok: false, reason: null }));

    click(ROW.toyonaka, 0);
    press('Enter');
    type('');
    press('Enter');

    expect(input()).toBeNull();
    expect(cell(ROW.toyonaka, 0).className).not.toContain('timetable__cell--invalid');
  });
});

describe('丸めの知らせ（受入条件）', () => {
  it('**丸めが起きた升目を一時的に目立たせる**', () => {
    vi.useFakeTimers();
    try {
      render([makeTrip('S1', 8, 0)], stubCommit({ ok: true, rounded: true }));

      click(ROW.toyonaka, 0);
      press('8');
      press('Enter');
      expect(cell(ROW.toyonaka, 0).className).toContain('timetable__cell--rounded');

      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(cell(ROW.toyonaka, 0).className).not.toContain('timetable__cell--rounded');
    } finally {
      vi.useRealTimers();
    }
  });

  it('丸めが起きなければ目立たせない', () => {
    render([makeTrip('S1', 8, 0)], stubCommit({ ok: true, rounded: false }));

    click(ROW.toyonaka, 0);
    press('8');
    press('Enter');
    expect(cell(ROW.toyonaka, 0).className).not.toContain('timetable__cell--rounded');
  });
});

describe('便の選択（T-21）', () => {
  it('列見出しを押すと、その便が選ばれる', () => {
    const onSelectTrip = vi.fn<(tripId: string, additive: boolean) => void>();
    const trips = [makeTrip('S1', 8, 0), makeTrip('S3', 9, 0)];
    render(trips, undefined, { onSelectTrip });

    act(() => {
      columnButton(1).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onSelectTrip).toHaveBeenCalledWith(trips[1]?.tripId, false);
  });

  it('**Ctrl を押しながらなら選択に加える**', () => {
    const onSelectTrip = vi.fn<(tripId: string, additive: boolean) => void>();
    const trips = [makeTrip('S1', 8, 0)];
    render(trips, undefined, { onSelectTrip });

    act(() => {
      columnButton(0).dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }));
    });
    expect(onSelectTrip).toHaveBeenCalledWith(trips[0]?.tripId, true);
  });

  it('選ばれている列が見て分かる', () => {
    const trips = [makeTrip('S1', 8, 0), makeTrip('S3', 9, 0)];
    render(trips, undefined, { selectedTripIds: [trips[1]?.tripId ?? ''] });

    expect(columnButton(0).getAttribute('aria-pressed')).toBe('false');
    expect(columnButton(1).getAttribute('aria-pressed')).toBe('true');
    expect(cell(ROW.toyonaka, 0).className).not.toContain('timetable__cell--selected');
    expect(cell(ROW.toyonaka, 1).className).toContain('timetable__cell--selected');
  });

  it('**列見出しの上で Delete を押すと削除を求める**', () => {
    const onRemoveSelection = vi.fn<() => void>();
    render([makeTrip('S1', 8, 0)], undefined, { onRemoveSelection });

    act(() => {
      columnButton(0).dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
    });
    expect(onRemoveSelection).toHaveBeenCalledTimes(1);
  });

  it('**升目の上の Delete では消えない**（時刻を消す操作と紛れない）', () => {
    const onRemoveSelection = vi.fn<() => void>();
    render([makeTrip('S1', 8, 0)], undefined, { onRemoveSelection });

    click(ROW.toyonaka, 0);
    press('Delete');
    expect(onRemoveSelection).not.toHaveBeenCalled();
  });
});

describe('運用番号欄（T-22、受入条件）', () => {
  it('便番号の下に記入欄が並ぶ', () => {
    render([makeTrip('S1', 8, 0, { blockId: 'A' }), makeTrip('S3', 9, 0, { blockId: 'B' })]);

    expect(blockField(0).value).toBe('A');
    expect(blockField(1).value).toBe('B');
    expect(blockField(0).getAttribute('aria-label')).toBe('1便の運用番号');
  });

  it('書き換えを伝える', () => {
    const onChangeBlockId = vi.fn<(tripId: string, blockId: string) => void>();
    const trips = [makeTrip('S1', 8, 0)];
    render(trips, undefined, { onChangeBlockId });

    const field = blockField(0);
    act(() => {
      const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
      descriptor?.set?.bind(field)('C');
      field.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(onChangeBlockId).toHaveBeenCalledWith(trips[0]?.tripId, 'C');
  });

  it('**同じ運用番号の便が同じ色になる**', () => {
    render([
      makeTrip('S1', 8, 0, { blockId: 'A' }),
      makeTrip('S3', 9, 0, { blockId: 'B' }),
      makeTrip('S1', 10, 0, { blockId: 'A' }),
    ]);

    const shadows = [0, 1, 2].map((i) => blockField(i).parentElement?.style.boxShadow ?? '');
    expect(shadows[0]).toBe(shadows[2]);
    expect(shadows[0]).not.toBe(shadows[1]);
    expect(shadows[0]).not.toBe('');
  });

  it('**空欄は未割当**（空欄どうしが繋がらない）', () => {
    render([makeTrip('S1', 8, 0), makeTrip('S3', 9, 0)]);

    expect(blockField(0).parentElement?.style.boxShadow).toBe('');
    expect(blockField(1).parentElement?.style.boxShadow).toBe('');
  });

  it('**焦点を当てると、同じ運用の列が強調される**', () => {
    render([
      makeTrip('S1', 8, 0, { blockId: 'A' }),
      makeTrip('S3', 9, 0, { blockId: 'B' }),
      makeTrip('S1', 10, 0, { blockId: 'A' }),
    ]);

    act(() => {
      blockField(0).focus();
    });
    expect(cell(ROW.toyonaka, 0).className).toContain('timetable__cell--sameBlock');
    expect(cell(ROW.toyonaka, 1).className).not.toContain('timetable__cell--sameBlock');
    expect(cell(ROW.toyonaka, 2).className).toContain('timetable__cell--sameBlock');

    act(() => {
      blockField(0).blur();
    });
    expect(cell(ROW.toyonaka, 2).className).not.toContain('timetable__cell--sameBlock');
  });

  it('未割当の欄に焦点を当てても、他の未割当は光らない', () => {
    render([makeTrip('S1', 8, 0), makeTrip('S3', 9, 0)]);

    act(() => {
      blockField(0).focus();
    });
    expect(container.querySelector('.timetable__cell--sameBlock')).toBeNull();
  });
});

describe('空の列（T-52、仕様書 §6.1.1）', () => {
  it('**便の右に空の列が並ぶ**', () => {
    render([makeTrip('S1', 8, 0)], undefined, { emptyColumns: 2 });

    expect(columnHeaders()).toEqual(['便番号', 'E1', '', '']);
    // 直行便は箕面学舎を経由しないが、空の列は `−` を出さない。
    expect(rowOf('箕面')).toEqual(['−', '', '']);
  });

  it('**空の列は便ではない**（選べず、パターンも運用も無い）', () => {
    render([makeTrip('S1', 8, 0)], undefined, { emptyColumns: 2 });

    expect(container.querySelectorAll('.timetable__column')).toHaveLength(1);
    expect(container.querySelectorAll('.timetable__pattern')).toHaveLength(1);
    expect(container.querySelectorAll('.timetable__block')).toHaveLength(1);
  });

  it('空の列の升目にも打てる', () => {
    const onCommit = stubCommit();
    render([makeTrip('S1', 8, 0)], onCommit, { emptyColumns: 2 });

    click(ROW.toyonaka, 1);
    press('F2');
    type('9:30');
    press('Enter');

    expect(onCommit).toHaveBeenCalledWith({ row: ROW.toyonaka, column: 1 }, '9:30');
  });

  it('矢印キーは空の列へも動ける', () => {
    render([makeTrip('S1', 8, 0)], undefined, { emptyColumns: 2 });

    click(ROW.toyonaka, 0);
    press('ArrowRight');
    expect(focused()).toBe(`${String(ROW.toyonaka)}:1`);
  });
});

describe('時刻を消す（T-52、仕様書 §6.1.2）', () => {
  it('**升目の Delete でその便の時刻が消える**', () => {
    const onClearTime = vi.fn<(tripId: string) => void>();
    const trips = [makeTrip('S1', 8, 0)];
    render(trips, undefined, { onClearTime });

    click(ROW.toyonaka, 0);
    press('Delete');

    expect(onClearTime).toHaveBeenCalledWith(trips[0]?.tripId);
  });

  it('空の列では何も起きない', () => {
    const onClearTime = vi.fn<(tripId: string) => void>();
    render([], undefined, { onClearTime, emptyColumns: 2 });

    click(ROW.toyonaka, 0);
    press('Delete');

    expect(onClearTime).not.toHaveBeenCalled();
  });

  it('**編集中の Delete は文字を消す**（便の時刻は消さない）', () => {
    const onClearTime = vi.fn<(tripId: string) => void>();
    render([makeTrip('S1', 8, 0)], undefined, { onClearTime });

    click(ROW.toyonaka, 0);
    press('F2');
    press('Delete');

    expect(onClearTime).not.toHaveBeenCalled();
  });
});

describe('前運用・後運用（T-51、仕様書 §6.1.7）', () => {
  /** 前運用・後運用の欄。 */
  function linkCells(title: string): (string | null)[] {
    return [...container.querySelectorAll<HTMLElement>(`[aria-label$="の${title}"]`)].map(
      (button) => button.textContent,
    );
  }

  it('**上端が前運用、下端が後運用**', () => {
    render([makeTrip('S1', 8, 0)]);
    const headings = [...container.querySelectorAll('tbody th')].map((th) => th.textContent);
    expect(headings[0]).toBe('前運用');
    expect(headings.at(-1)).toBe('後運用');
  });

  it('**出区・入区が付いていれば車庫側の時刻を出す**', () => {
    // 豊中 8:00 発・工学部前 8:30 着。車庫はその 20 分前と 20 分後。
    render([makeTrip('S1', 8, 0, { pullOut: true, pullIn: true })]);

    expect(linkCells('前運用')).toEqual(['7:40']);
    expect(linkCells('後運用')).toEqual(['8:50']);
  });

  it('**運用番号が空欄でも時刻が出る**（出区の表示は運用に依らない。T-51）', () => {
    render([makeTrip('S1', 8, 0, { blockId: '', pullOut: true })]);
    expect(linkCells('前運用')).toEqual(['7:40']);
  });

  it('**時刻が未入力の便では空欄のまま**（入力の途中を異常として見せない）', () => {
    const empty: Trip = { ...makeTrip('S1', 8, 0, { pullOut: true }), anchor: null };
    render([empty]);
    expect(linkCells('前運用')).toEqual(['']);
  });

  it('**車庫側の時刻を表せなければ空欄にせず知らせる**（V-04）', () => {
    // 0:10 発の便の出区は前日 23:50 となり、表せない。
    render([makeTrip('S1', 0, 10, { pullOut: true })]);
    expect(linkCells('前運用')).toEqual(['!']);
  });

  it('**営業便が繋がっていれば便番号を出す**', () => {
    // S1（豊中 8:00 → 工学部前 8:30）の次に T1（工学部前 8:40 → 豊中 9:10）。
    const trip = makeTrip('S1', 8, 0, { blockId: 'A' });
    const westbound = makeTrip('T1', 8, 40, { blockId: 'A' });
    render([trip], undefined, { allTrips: [trip, westbound] });

    // 表に出るのは吹田方面の便だけ。その後運用に豊中方面の便番号が出る。
    expect(linkCells('後運用')).toEqual(['W1']);
    expect(linkCells('前運用')).toEqual(['']);
  });

  it('繋がっていなければ空欄', () => {
    render([makeTrip('S1', 8, 0)]);
    expect(linkCells('前運用')).toEqual(['']);
    expect(linkCells('後運用')).toEqual(['']);
  });

  it('**押すと出区・入区を切り替える**', () => {
    const onTogglePullOut = vi.fn<(tripId: string) => void>();
    const onTogglePullIn = vi.fn<(tripId: string) => void>();
    const trips = [makeTrip('S1', 8, 0)];
    render(trips, undefined, { onTogglePullOut, onTogglePullIn });

    const press = (title: string): void => {
      const button = container.querySelector<HTMLElement>(`[aria-label$="の${title}"]`);
      act(() => {
        button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
    };
    press('前運用');
    press('後運用');

    expect(onTogglePullOut).toHaveBeenCalledWith(trips[0]?.tripId);
    expect(onTogglePullIn).toHaveBeenCalledWith(trips[0]?.tripId);
  });

  it('出区が付いている欄は押された状態で示す', () => {
    render([makeTrip('S1', 8, 0, { pullOut: true })]);

    const before = container.querySelector('[aria-label$="の前運用"]');
    const after = container.querySelector('[aria-label$="の後運用"]');
    expect(before?.getAttribute('aria-pressed')).toBe('true');
    expect(after?.getAttribute('aria-pressed')).toBe('false');
  });

  it('**繋がる営業便が出ている欄も押せる**（そこから車庫へ帰す。仕様書 §6.1.7）', () => {
    const onTogglePullIn = vi.fn<(tripId: string) => void>();
    const trip = makeTrip('S1', 8, 0, { blockId: 'A' });
    const westbound = makeTrip('T1', 8, 40, { blockId: 'A' });
    render([trip], undefined, { allTrips: [trip, westbound], onTogglePullIn });

    const after = container.querySelector<HTMLButtonElement>('[aria-label$="の後運用"]');
    expect(after?.disabled).toBe(false);
    act(() => {
      after?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onTogglePullIn).toHaveBeenCalledWith(trip.tripId);
  });
});
