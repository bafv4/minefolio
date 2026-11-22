import { useState, type Dispatch, type SetStateAction } from "react";
import { jsonEqual, resolveSyncedDraft } from "@/lib/loader-synced-draft";

/**
 * loader の値（source）から作る画面ローカルの下書き。
 *
 * source が変わったとき、下書きが未変更（前回の基準値と同じ）の間だけ新しい値で置き換える。
 * 編集済みなら下書きを残し、基準値（base）だけを新しい値へ進める。
 * `syncToken` には「最後に成功した保存の結果」の参照を渡す（失敗の結果・未保存は null）。
 * 未消費のトークンがある状態で source が変わったレンダーでは、編集済みでも置き換える
 * （サーバーの正規化後の値・採番済み ID に合わせるため）。消費済みのトークンは state に記録するので、
 * 保存結果と loader の再取得結果が同じコミットで届いても別々に届いても、強制はちょうど 1 回だけ効く。
 * 失敗した保存の後の再検証・タブ復帰の再検証（トークンが変わらない／null）では効かない。
 *
 * `resetKey` は下書きの持ち主（編集先プリセットの id など）。変わったときは編集済みでも必ず置き換える
 * （別のプリセットの内容を、新しいプリセットへ保存させないため）。
 *
 * source は参照が安定していること（useMemo など）。レンダー中に同期するので、
 * 置き換えの 1 フレーム前に古い値が描かれることはない。
 */
export function useLoaderSyncedDraft<T>(
  source: T,
  options: { isEqual?: (a: T, b: T) => boolean; resetKey?: unknown; syncToken?: unknown } = {},
): {
  draft: T;
  setDraft: Dispatch<SetStateAction<T>>;
  /** 最後に取り込んだ loader の値。未保存の判定はこれとの比較で行う */
  base: T;
} {
  const { isEqual = jsonEqual, resetKey, syncToken = null } = options;
  const [draft, setDraft] = useState<T>(source);
  const [base, setBase] = useState<T>(source);
  const [key, setKey] = useState(resetKey);
  // 強制置き換えに使い終えたトークン（マウント時のトークンは使用済み扱い）
  const [consumedToken, setConsumedToken] = useState<unknown>(syncToken);

  if (source !== base || resetKey !== key) {
    const force = syncToken !== null && syncToken !== consumedToken;
    setBase(source);
    setKey(resetKey);
    setDraft(
      resolveSyncedDraft({ draft, prevBase: base, nextBase: source, force, prevKey: key, nextKey: resetKey, isEqual }),
    );
    if (force) setConsumedToken(syncToken);
  }

  return { draft, setDraft, base };
}

/**
 * `syncToken` に渡す値を作る。fetcher.data が「成功した保存の結果」ならその参照、
 * 失敗・未保存なら null（参照が変わるたびに 1 回だけ強制置き換えが効く）。
 */
export function successfulSaveToken(data: unknown): unknown {
  return data != null && typeof data === "object" && "success" in data && (data as { success?: unknown }).success === true
    ? data
    : null;
}
