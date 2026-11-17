import { useCallback, useState, type Dispatch, type SetStateAction } from "react";
import { jsonEqual, resolveSyncedDraft } from "@/lib/loader-synced-draft";

/**
 * loader の値（source）から作る画面ローカルの下書き。
 *
 * source が変わったとき、下書きが未変更（前回の基準値と同じ）の間だけ新しい値で置き換える。
 * 編集済みなら下書きを残し、基準値（base）だけを新しい値へ進める。
 * 保存成功の直後は `syncOnNextSource()` を呼ぶと、次の source 更新では編集済みでも置き換える
 * （サーバーの正規化後の値・採番済み ID に合わせるため）。
 *
 * `resetKey` は下書きの持ち主（編集先プリセットの id など）。変わったときは編集済みでも必ず置き換える
 * （別のプリセットの内容を、新しいプリセットへ保存させないため）。
 *
 * source は参照が安定していること（useMemo など）。レンダー中に同期するので、
 * 置き換えの 1 フレーム前に古い値が描かれることはない。
 */
export function useLoaderSyncedDraft<T>(
  source: T,
  options: { isEqual?: (a: T, b: T) => boolean; resetKey?: unknown } = {},
): {
  draft: T;
  setDraft: Dispatch<SetStateAction<T>>;
  /** 最後に取り込んだ loader の値。未保存の判定はこれとの比較で行う */
  base: T;
  syncOnNextSource: () => void;
} {
  const { isEqual = jsonEqual, resetKey } = options;
  const [draft, setDraft] = useState<T>(source);
  const [base, setBase] = useState<T>(source);
  const [key, setKey] = useState(resetKey);
  const [force, setForce] = useState(false);

  if (source !== base || resetKey !== key) {
    setBase(source);
    setKey(resetKey);
    setDraft(
      resolveSyncedDraft({ draft, prevBase: base, nextBase: source, force, prevKey: key, nextKey: resetKey, isEqual }),
    );
    if (force) setForce(false);
  }

  const syncOnNextSource = useCallback(() => setForce(true), []);

  return { draft, setDraft, base, syncOnNextSource };
}
