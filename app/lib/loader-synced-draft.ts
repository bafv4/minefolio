/**
 * loader の値が変わったときに、画面のローカル下書きをどう扱うかを決める純粋関数。
 *
 * - 下書きが前回の基準値と同じ（＝未変更）なら、新しい値で置き換える
 * - 編集済みなら下書きを残す（タブ復帰の自動再検証などで、入力中の編集を黙って消さない）
 * - `force`（保存成功の直後など）のときは、編集済みでも新しい値で置き換える
 * - 下書きの持ち主を表すキー（`prevKey` / `nextKey`。編集先プリセットの id など）が変わったときは、
 *   編集済みでも必ず置き換える。別のプリセットの内容を、新しいプリセットへ保存してしまわないため
 */
export function resolveSyncedDraft<T>(args: {
  draft: T;
  prevBase: T;
  nextBase: T;
  force?: boolean;
  prevKey?: unknown;
  nextKey?: unknown;
  isEqual?: (a: T, b: T) => boolean;
}): T {
  const { draft, prevBase, nextBase, force = false, prevKey, nextKey, isEqual = jsonEqual } = args;
  if (prevKey !== nextKey) return nextBase;
  if (force || isEqual(draft, prevBase)) return nextBase;
  return draft;
}

export function jsonEqual<T>(a: T, b: T): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
