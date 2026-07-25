/**
 * 時刻表エディタの時刻入力を解析する（仕様書 §6.1.2）。
 *
 * | 入力    | 解釈 |
 * | ------- | ---- |
 * | `830`   | 8:30 |
 * | `8:30`  | 8:30 |
 * | `2530`  | 25:30（翌 1:30） |
 * | `45`    | 分のみ。時は直前の便から補完し、その値以下なら +1 時間する。 |
 *
 * 不正な入力では例外を投げず `null` を返す。入力途中の文字列が常に例外を
 * 起こすようでは、セル編集の実装が煩雑になるため。
 */

import {
  MAX_HOUR,
  roundToGrain,
  SECONDS_PER_HOUR,
  SECONDS_PER_MINUTE,
  type Seconds,
} from './types';

export interface ParsedTime {
  /** 5 分に丸めた後の値。 */
  readonly value: Seconds;
  /**
   * 丸めが発生したか。
   *
   * 仕様書 §6.1.2 の「丸めが発生した場合はセルを一瞬ハイライトして知らせる」を
   * 実現するために返す。呼び出し側が丸めの有無を判定し直さずに済む。
   */
  readonly rounded: boolean;
}

/**
 * 時刻入力を解析する。
 *
 * @param text 利用者が入力した文字列。全角数字と全角コロンを受け付ける。
 * @param prevTime 同じ行の直前の便の時刻。分のみの入力を補完するために使う。
 * @returns 解析できなければ `null`。
 */
export function parseTimeInput(text: string, prevTime?: Seconds): ParsedTime | null {
  const normalized = normalize(text);
  if (normalized === '') {
    return null;
  }

  const raw = toRawSeconds(normalized, prevTime);
  if (raw === null) {
    return null;
  }

  const value = roundToGrain(raw);
  return { value, rounded: value !== raw };
}

/**
 * 全角数字を半角に、全角コロンを半角にそろえ、空白を除去する。
 *
 * 日本語入力の状態で `８３０` と打たれる場面が現実にあるため、正規化は必須。
 */
function normalize(text: string): string {
  return text
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[：]/g, ':')
    .replace(/\s/g, '');
}

/** 正規化済みの文字列を秒数に変換する。丸めは行わない。 */
function toRawSeconds(text: string, prevTime: Seconds | undefined): number | null {
  const colon = text.indexOf(':');

  if (colon >= 0) {
    const hourPart = text.slice(0, colon);
    const minutePart = text.slice(colon + 1);
    if (!isDigits(hourPart) || !isDigits(minutePart)) {
      return null;
    }
    return build(Number(hourPart), Number(minutePart));
  }

  if (!isDigits(text)) {
    return null;
  }

  switch (text.length) {
    case 1:
    case 2:
      return fromMinutesOnly(Number(text), prevTime);
    case 3:
      // `830` → 8:30
      return build(Number(text.slice(0, 1)), Number(text.slice(1)));
    case 4:
      // `2530` → 25:30
      return build(Number(text.slice(0, 2)), Number(text.slice(2)));
    default:
      return null;
  }
}

/**
 * 分のみの入力を、直前の便の時刻から補完する。
 *
 * 時刻表は左から右へ時刻が増えるため、入力された分が直前の便の分以下であれば
 * 次の時であると解釈する（仕様書 §6.1.2）。
 */
function fromMinutesOnly(minutes: number, prevTime: Seconds | undefined): number | null {
  if (prevTime === undefined) {
    return null;
  }
  if (minutes > 59) {
    return null;
  }
  const prevHour = Math.floor(prevTime / SECONDS_PER_HOUR);
  const prevMinute = Math.floor((prevTime % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE);
  const hours = minutes <= prevMinute ? prevHour + 1 : prevHour;
  return build(hours, minutes);
}

function build(hours: number, minutes: number): number | null {
  if (minutes > 59 || hours > MAX_HOUR) {
    return null;
  }
  return hours * SECONDS_PER_HOUR + minutes * SECONDS_PER_MINUTE;
}

function isDigits(text: string): boolean {
  return text.length > 0 && /^\d+$/.test(text);
}
