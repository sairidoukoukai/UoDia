/** 時刻の整形。 */

import { toHM, type Seconds } from './types';

/**
 * `H:MM` 形式に整形する。24 時を超える時刻はそのまま `25:30` と表示する
 * （仕様書 §2.1）。
 *
 * 時の桁は 0 埋めしない。時刻表とダイヤグラムの表示幅を抑えるため。
 */
export function formatTime(value: Seconds): string {
  const { hours, minutes } = toHM(value);
  return `${String(hours)}:${String(minutes).padStart(2, '0')}`;
}

/**
 * `HH:MM` 形式に整形する。桁が揃うため、等幅で並べる場面に用いる。
 */
export function formatTimePadded(value: Seconds): string {
  const { hours, minutes } = toHM(value);
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

/**
 * 分数を「N 分」の形に整形する。折返し時分やシフト量の表示に用いる。
 * 正の値には符号を付ける（例: `+15 分`）。
 */
export function formatMinutesSigned(minutes: number): string {
  const sign = minutes > 0 ? '+' : '';
  return `${sign}${String(minutes)} 分`;
}
