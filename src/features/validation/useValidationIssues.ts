/**
 * 検証をデバウンスして走らせる（仕様書 §6.6、T-34）。
 *
 * **打っている間は検証しない。** 時刻を 1 文字打つたびに全便を検証すると、
 * 途中の（まだ意味を成さない）状態について指摘が現れては消える。**手が止まって
 * から 300ms** で 1 回だけ走らせる。
 *
 * 検証そのものは同期的で、100 便規模なら数 ms で終わる（§6.6）。遅らせるのは
 * 計算が重いからではなく、**利用者の手が動いている最中に画面を書き換えない**
 * ためである。
 *
 * 結果を状態に持たないのはこれまでどおりである（`selectValidation` は導出値）。
 * ここが持つのは「いつ計算し直したか」だけである。
 */

import { useEffect, useState } from 'react';
import type { ValidationIssue } from '@/domain/validation';
import { selectNetwork, selectTrips, selectValidation, useAppStore } from '@/store';

/** 手が止まってから検証するまでの間（ms）。仕様書 §6.6。 */
export const VALIDATION_DEBOUNCE_MS = 300;

const NO_ISSUES: readonly ValidationIssue[] = [];

/**
 * 今の指摘。編集が止まってから {@link VALIDATION_DEBOUNCE_MS} 後に更新される。
 *
 * @param delayMs 待つ長さ。テストから短くできるようにしてある
 */
export function useValidationIssues(delayMs = VALIDATION_DEBOUNCE_MS): readonly ValidationIssue[] {
  // 便と路線図が変わったときだけ計算し直す。送りや選択では動かない。
  const trips = useAppStore(selectTrips);
  const network = useAppStore(selectNetwork);
  const [issues, setIssues] = useState<readonly ValidationIssue[]>(NO_ISSUES);

  useEffect(() => {
    const timer = setTimeout(() => {
      // **その時点の状態から計算する。** 閉じ込めた `trips` を使うと、待っている
      // 間に起きた別の変更（ダイヤの切り替えなど）を取りこぼす。
      setIssues(selectValidation(useAppStore.getState()));
    }, delayMs);

    return () => {
      clearTimeout(timer);
    };
  }, [trips, network, delayMs]);

  return issues;
}
