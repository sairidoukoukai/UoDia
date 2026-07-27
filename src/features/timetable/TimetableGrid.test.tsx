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
import { allTimes } from '@/domain/trip';
import type { CellPosition } from './editing';
import { buildTimetable, stopsForDirection } from './model';
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
    tripShortName: '',
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

/** 選択にまつわる差し替え（T-21）。省くと「何も選ばれていない」表になる。 */
interface RenderExtras {
  readonly selectedTripIds?: readonly string[];
  readonly onSelectTrip?: (tripId: string, additive: boolean) => void;
  readonly onRemoveSelection?: () => void;
}

function render(
  trips: readonly Trip[],
  onCommit: (at: CellPosition, text: string) => CommitResult = stubCommit(),
  extras: RenderExtras = {},
): void {
  const times = new Map<string, ReadonlyMap<string, Seconds>>(
    trips.map((trip) => [trip.tripId, allTimes(trip, network)]),
  );
  const timetable = buildTimetable(trips, stopsForDirection(network, 0), network, times);

  const root = createRoot(container);
  act(() => {
    root.render(
      <TimetableGrid
        timetable={timetable}
        onCommit={onCommit}
        selectedTripIds={extras.selectedTripIds ?? []}
        onSelectTrip={extras.onSelectTrip ?? (() => undefined)}
        onRemoveSelection={extras.onRemoveSelection ?? (() => undefined)}
      />,
    );
  });
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

/** 今開いている編集欄。 */
function input(): HTMLInputElement | null {
  return container.querySelector('input');
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

/** 行の見出し（停留所名）から、その行の升目の文字列を並べて返す。 */
function rowOf(stopName: string): (string | null)[] {
  const heading = [...container.querySelectorAll('tbody th')].find(
    (th) => th.textContent === stopName,
  );
  if (heading === undefined) throw new Error(`${stopName} の行がありません`);
  return [...(heading.parentElement?.querySelectorAll('td') ?? [])].map((td) => td.textContent);
}

describe('見出し', () => {
  it('パターン・行先・便番号・運用を出す', () => {
    render([makeTrip('S1', 8, 0, { tripShortName: 'E1', blockId: 'A' })]);

    const headings = [...container.querySelectorAll('thead th[scope="row"]')].map(
      (th) => th.textContent,
    );
    expect(headings).toEqual(['パターン', '行先', '便番号', '運用']);

    const cells = [...container.querySelectorAll('thead td')].map((td) => td.textContent);
    expect(cells).toEqual(['S1', '直行吹田', 'E1', 'A']);
  });

  it('便番号と運用が空なら印を出す（空欄と区別する）', () => {
    render([makeTrip('S1', 8, 0)]);
    const cells = [...container.querySelectorAll('thead td')].map((td) => td.textContent);
    expect(cells).toEqual(['S1', '直行吹田', '―', '―']);
  });

  it('**回送便の列は見出しで分かる**', () => {
    render([makeTrip('S1', 8, 0), makeTrip('DT-in', 8, 0)]);

    const tops = [...container.querySelectorAll('thead tr:first-child th[scope="col"]')];
    expect(tops.map((th) => th.textContent)).toEqual(['停留所', '1便', '2便回送']);
    expect(tops[2]?.className).toContain('deadhead');
  });

  it('参照が壊れた列は行先を「？」にし、目印を付ける', () => {
    render([makeTrip('S1', 8, 0, { patternId: '無いパターン' })]);

    expect([...container.querySelectorAll('thead td')].map((td) => td.textContent)).toEqual([
      '無いパターン',
      '？',
      '―',
      '―',
    ]);
    expect(container.querySelector('.timetable__head--broken')).not.toBeNull();
  });
});

describe('升目（受入条件）', () => {
  it('**直行便の箕面学舎は `−`、箕面経由便は時刻**', () => {
    render([makeTrip('S1', 8, 0), makeTrip('S3', 8, 30)]);
    expect(rowOf('箕面学舎')).toEqual(['−', '8:50']);
  });

  it('**アンカーの升目が目印で分かる**', () => {
    render([makeTrip('S1', 8, 0)]);

    const anchors = [...container.querySelectorAll('.timetable__cell--anchor')];
    expect(anchors).toHaveLength(1);
    expect(anchors[0]?.textContent).toBe('△8:00');
  });

  it('取扱区分の記号を時刻に添える', () => {
    // 箕面学舎は S2 では始発（乗車のみ）、M2 では終着（降車のみ）。
    render([makeTrip('S2', 8, 0), makeTrip('M2', 8, 0)]);
    expect(rowOf('箕面学舎')).toEqual(['△8:00', '▽8:20']);
  });

  it('時刻が未入力なら空欄にする（`−` とは違う）', () => {
    render([makeTrip('S1', 8, 0, { anchor: null })]);
    expect(rowOf('豊中学舎')).toEqual(['△']);
    expect(rowOf('箕面学舎')).toEqual(['−']);
  });
});

describe('並び', () => {
  it('行は縦軸の順、営業所は最後', () => {
    render([makeTrip('S1', 8, 0)]);
    expect([...container.querySelectorAll('tbody th')].map((th) => th.textContent)).toEqual([
      '豊中学舎',
      '箕面学舎',
      'コンベンションセンター前',
      '工学部前',
      '千里営業所',
    ]);
  });

  it('停留所名の列は横スクロールしても残す', () => {
    render([makeTrip('S1', 8, 0)]);
    // 位置の固定は CSS が行う。ここでは目印が付いていることだけを確かめる。
    expect(container.querySelector('tbody th')?.className).toContain('timetable__stop');
    expect(container.querySelector('.timetable__scroll')).not.toBeNull();
  });
});

describe('便が無いとき', () => {
  it('表ではなく案内を出す', () => {
    render([]);
    expect(container.querySelector('table')).toBeNull();
    expect(container.textContent).toContain('まだありません');
  });
});

describe('多数の便', () => {
  it('100 便でも全部の列を描く（間引かない）', () => {
    const trips = Array.from({ length: 100 }, (_, index) =>
      makeTrip('S1', 6 + Math.floor(index / 12), (index % 12) * 5),
    );
    render(trips);

    expect(container.querySelectorAll('thead tr:first-child th[scope="col"]')).toHaveLength(101);
    expect(rowOf('豊中学舎')).toHaveLength(100);
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
