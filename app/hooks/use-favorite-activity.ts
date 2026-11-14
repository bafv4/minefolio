import { useEffect, useState } from "react";
import { useFavorites } from "@/hooks/use-favorites";
import type { FavoriteActivityResult } from "@/lib/home-favorite-activity.server";

export type FavoriteActivityState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "done"; data: FavoriteActivityResult };

/**
 * お気に入りの動きを `POST /api/home-favorite-activity` から取得する（ホーム欄と /favorites/activity で共用）。
 * ログイン済み: サーバーのお気に入りを使う（slugs は空で送る）。未ログイン: ブラウザのお気に入りを本文で送る（URL に載せない）。
 * 期間・件数はサーバー側でクランプされる。
 */
export function useFavoriteActivity({
  isRegistered,
  windowDays,
  limit,
}: {
  isRegistered: boolean;
  windowDays?: number;
  limit?: number;
}) {
  const { favorites, isLoading: favoritesLoading } = useFavorites();
  const favoritesKey = favorites.join(",");
  const [state, setState] = useState<FavoriteActivityState>({ status: "loading" });
  const [retryNonce, setRetryNonce] = useState(0);

  const shouldFetch = isRegistered || favorites.length > 0;

  useEffect(() => {
    if (!shouldFetch) return;
    let cancelled = false;
    setState((s) => (s.status === "done" ? s : { status: "loading" }));
    fetch("/api/home-favorite-activity", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // ログイン済みはサーバー側のお気に入りが使われる（slugs は無視される）
      body: JSON.stringify({ slugs: isRegistered ? [] : favorites, windowDays, limit }),
    })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<FavoriteActivityResult>;
      })
      .then((data) => {
        if (!cancelled) setState({ status: "done", data });
      })
      .catch((err) => {
        console.error("Failed to fetch favorite activity:", err);
        if (!cancelled) setState({ status: "error" });
      });
    return () => {
      cancelled = true;
    };
    // favorites は配列の同一性ではなく内容（favoritesKey）で再取得する
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldFetch, isRegistered, favoritesKey, windowDays, limit, retryNonce]);

  return {
    state,
    /** ブラウザのお気に入りが 1 件以上、またはログイン済み（取得対象がある） */
    shouldFetch,
    /** お気に入りの読み込み中（未ログインで localStorage を読む前など） */
    favoritesLoading,
    retry: () => setRetryNonce((n) => n + 1),
  };
}
