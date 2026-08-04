/**
 * 折返しの接続線の検証（T-62、#167、仕様書 v1.1 §5.3）。
 *
 * 確かめるのは 2 つ。**繋がっていない便を繋がないこと**と、**同じ停留所に
 * 複数の運用が留まっても線が重ならないこと**である。
 */

import { describe, expect, it } from 'vitest';
import { fromHM } from '@/domain/time';
import { buildBlockLinks, type AxisPositions, type BlockLinkEntry } from './blockLinks';

/** 豊中 0 / 箕面 20 / 工学部 40。中点は 20。 */
const AXIS: AxisPositions = {
  of: (stopId) => ({ toyonaka: 0, mino: 20, kogaku: 40 })[stopId],
  midpoint: 20,
};

const COLOR = (blockId: string): string | undefined => (blockId === '' ? undefined : `#${blockId}`);

function entry(
  blockId: string,
  from: [string, number, number],
  to: [string, number, number],
): BlockLinkEntry {
  return {
    blockId,
    originStopId: from[0],
    originTime: fromHM(from[1], from[2]),
    terminalStopId: to[0],
    terminalTime: fromHM(to[1], to[2]),
    onAxis: true,
  };
}

/** 豊中 → 工学部（下り）と 工学部 → 豊中（上り）を繋いだ 1 運用。 */
function roundTrip(blockId: string, outbound: number, inbound: number): BlockLinkEntry[] {
  return [
    entry(blockId, ['toyonaka', outbound, 0], ['kogaku', outbound, 30]),
    entry(blockId, ['kogaku', inbound, 0], ['toyonaka', inbound, 30]),
  ];
}

describe('接続線を引く条件', () => {
  it('**折返しで時間が空いていれば繋ぐ**', () => {
    const links = buildBlockLinks(roundTrip('A', 8, 9), COLOR, AXIS);

    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({
      blockId: 'A',
      stopId: 'kogaku',
      from: fromHM(8, 30),
      to: fromHM(9, 0),
      color: '#A',
    });
  });

  it('**折返し 0 分では引かない**（長さ 0 の線は描いても見えない）', () => {
    const links = buildBlockLinks(
      [
        entry('A', ['toyonaka', 8, 0], ['kogaku', 8, 30]),
        entry('A', ['kogaku', 8, 30], ['toyonaka', 9, 0]),
      ],
      COLOR,
      AXIS,
    );

    expect(links).toEqual([]);
  });

  it('**停留所が一致しなければ引かない**（V-01。繋がっていない）', () => {
    const links = buildBlockLinks(
      [
        entry('A', ['toyonaka', 8, 0], ['kogaku', 8, 30]),
        entry('A', ['mino', 9, 0], ['toyonaka', 9, 30]),
      ],
      COLOR,
      AXIS,
    );

    expect(links).toEqual([]);
  });

  it('**折返しが負なら引かない**（V-02。破綻したダイヤを繋がっているように見せない）', () => {
    const links = buildBlockLinks(
      [
        entry('A', ['toyonaka', 8, 0], ['kogaku', 8, 30]),
        entry('A', ['kogaku', 8, 20], ['toyonaka', 8, 50]),
      ],
      COLOR,
      AXIS,
    );

    expect(links).toEqual([]);
  });

  it('**縦軸に無い停留所（営業所）では引かない**', () => {
    const offAxis = roundTrip('A', 8, 9).map((e) => ({ ...e, onAxis: false }));
    expect(buildBlockLinks(offAxis, COLOR, AXIS)).toEqual([]);
  });

  it('**運用番号が空欄の便には引かない**（繋ぐ相手が定義されていない）', () => {
    expect(buildBlockLinks(roundTrip('', 8, 9), COLOR, AXIS)).toEqual([]);
  });

  it('運用が違えば繋がない', () => {
    const links = buildBlockLinks(
      [
        entry('A', ['toyonaka', 8, 0], ['kogaku', 8, 30]),
        entry('B', ['kogaku', 9, 0], ['toyonaka', 9, 30]),
      ],
      COLOR,
      AXIS,
    );

    expect(links).toEqual([]);
  });

  it('色を引けない運用には引かない', () => {
    expect(buildBlockLinks(roundTrip('A', 8, 9), () => undefined, AXIS)).toEqual([]);
  });

  it('軸位置を引けない停留所には引かない', () => {
    expect(buildBlockLinks(roundTrip('A', 8, 9), COLOR, { ...AXIS, of: () => undefined })).toEqual(
      [],
    );
  });

  it('並びが前後していても始発時刻の順に繋ぐ', () => {
    const [outbound, inbound] = roundTrip('A', 8, 9);
    if (outbound === undefined || inbound === undefined) throw new Error('用意できません');

    expect(buildBlockLinks([inbound, outbound], COLOR, AXIS)).toHaveLength(1);
  });
});

describe('重なりを段に振り分ける', () => {
  /** 豊中で `from`〜`to` に留まる運用。 */
  function dwellAtToyonaka(blockId: string, from: number, to: number): BlockLinkEntry[] {
    return [
      entry(blockId, ['kogaku', from - 1, 0], ['toyonaka', from, 0]),
      entry(blockId, ['toyonaka', to, 0], ['kogaku', to + 1, 0]),
    ];
  }

  it('**1 台だけなら段 0**（停留所の位置に正直に載る）', () => {
    const links = buildBlockLinks(dwellAtToyonaka('A', 8, 9), COLOR, AXIS);
    expect(links[0]?.level).toBe(0);
  });

  it('**同時に留まる 3 台は 0・1・2 段に積む**', () => {
    const links = buildBlockLinks(
      [
        ...dwellAtToyonaka('A', 8, 12),
        ...dwellAtToyonaka('B', 9, 13),
        ...dwellAtToyonaka('C', 10, 14),
      ],
      COLOR,
      AXIS,
    );

    expect(links.map((l) => l.level).toSorted()).toEqual([0, 1, 2]);
  });

  it('**時間帯が交わらなければ同じ段でよい**（留まっていない時間まで段を占めない）', () => {
    const links = buildBlockLinks(
      [...dwellAtToyonaka('A', 8, 9), ...dwellAtToyonaka('B', 10, 11)],
      COLOR,
      AXIS,
    );

    expect(links.map((l) => l.level)).toEqual([0, 0]);
  });

  it('停留所が違えば重ならない', () => {
    const links = buildBlockLinks(
      [
        ...dwellAtToyonaka('A', 8, 12),
        entry('B', ['toyonaka', 8, 0], ['kogaku', 8, 30]),
        entry('B', ['kogaku', 9, 0], ['toyonaka', 9, 30]),
      ],
      COLOR,
      AXIS,
    );

    expect(links.map((l) => l.level)).toEqual([0, 0]);
  });

  it('**ずらす向きは軸の外側**（豊中は上、工学部は下）', () => {
    const links = buildBlockLinks(
      [...dwellAtToyonaka('A', 8, 12), ...roundTrip('B', 9, 10)],
      COLOR,
      AXIS,
    );

    expect(links.find((l) => l.stopId === 'toyonaka')?.direction).toBe(-1);
    expect(links.find((l) => l.stopId === 'kogaku')?.direction).toBe(1);
  });

  it('**運用番号を打ち替えても段の付き方は変わらない**（時刻順に割り当てる）', () => {
    const early = dwellAtToyonaka('Z', 8, 12);
    const late = dwellAtToyonaka('A', 9, 13);
    const links = buildBlockLinks([...early, ...late], COLOR, AXIS);

    // 段 0 は先に留まり始めたほう（Z）である。番号順なら A が 0 になる。
    expect(links.find((l) => l.level === 0)?.blockId).toBe('Z');
  });
});
