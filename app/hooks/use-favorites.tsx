import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  getLocalFavorites,
  addLocalFavorite,
  removeLocalFavorite,
  clearLocalFavorites,
  getSessionFavorites,
  setSessionFavorites,
} from "@/lib/favorites-client";
import { useCookieConsent } from "@/components/cookie-consent";

interface FavoritesContextValue {
  favorites: string[];
  isFavorite: (slug: string) => boolean;
  toggleFavorite: (slug: string) => Promise<void>;
  needsCookieConsent: boolean;
  isLoading: boolean;
}

const FavoritesContext = createContext<FavoritesContextValue | null>(null);

interface FavoritesProviderProps {
  /** ログイン中ユーザーかどうか（_layout の user データから判定） */
  isLoggedIn: boolean;
  /** SSRで取得済みのお気に入り（ログイン中のローダーが返した DB の slug 一覧） */
  initialFavorites?: string[];
  children: ReactNode;
}

/**
 * お気に入り状態のグローバルプロバイダー。
 *
 * - ログイン中: マウント時に GET /api/favorites → sessionStorage にキャッシュ。
 *   localStorage に値があれば PUT で一括同期 → localStorage 削除。
 *   CRUD は POST /api/favorites（楽観的UI、エラー時ロールバック）。
 * - 未ログイン: localStorage 直接読み書き（Cookie同意必須）。
 * - Cookie拒否中の未ログイン: 空配列固定、toggleFavorite は no-op。
 */
export function FavoritesProvider({
  isLoggedIn,
  initialFavorites = [],
  children,
}: FavoritesProviderProps) {
  const { hasConsent } = useCookieConsent();
  const [favorites, setFavorites] = useState<string[]>(initialFavorites);
  const [isLoading, setIsLoading] = useState(false);
  const initializedRef = useRef(false);

  // 連打レース対策: 直前のリクエストの完了を待ってから次の toggle を実行（直列化）。
  // また closure ベースだとロールバック時に stale state を復元してしまうため、
  // 常に最新の favorites を参照できるよう ref も保持する。
  const toggleChainRef = useRef<Promise<void>>(Promise.resolve());
  const favoritesRef = useRef<string[]>(initialFavorites);
  useEffect(() => {
    favoritesRef.current = favorites;
  }, [favorites]);

  const needsCookieConsent = !isLoggedIn && hasConsent !== true;

  // マウント時の初期化（1回のみ）
  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    if (isLoggedIn) {
      // 1) sessionStorage キャッシュを即時表示（API応答待ちの間のチラつき軽減）
      const cached = getSessionFavorites();
      if (cached.length > 0 && initialFavorites.length === 0) {
        setFavorites(cached);
      }

      // 2) localStorage に未同期エントリがあれば PUT で一括同期
      const local = getLocalFavorites();
      const syncPromise = local.length > 0
        ? fetch("/api/favorites", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ slugs: local }),
          })
            .then((r) => (r.ok ? r.json() : null))
            .then((data) => {
              if (data && Array.isArray(data.favorites)) {
                clearLocalFavorites();
                return data.favorites as string[];
              }
              return null;
            })
            .catch(() => null)
        : Promise.resolve(null);

      // 3) GET /api/favorites で最新を取得（PUT後はそちらを優先）
      setIsLoading(true);
      syncPromise.then((synced) => {
        if (synced) {
          setFavorites(synced);
          setSessionFavorites(synced);
          setIsLoading(false);
          return;
        }
        fetch("/api/favorites")
          .then((r) => (r.ok ? r.json() : null))
          .then((data) => {
            if (data && Array.isArray(data.favorites)) {
              setFavorites(data.favorites);
              setSessionFavorites(data.favorites);
            }
          })
          .catch(() => {})
          .finally(() => setIsLoading(false));
      });
    } else {
      // 未ログイン: localStorage を読む（Cookie同意済みのみ）
      if (hasConsent === true) {
        setFavorites(getLocalFavorites());
      } else {
        setFavorites([]);
      }
    }
  }, [isLoggedIn, hasConsent, initialFavorites.length]);

  // 未ログイン状態で Cookie 同意状態が変わったら再評価
  useEffect(() => {
    if (isLoggedIn || !initializedRef.current) return;
    if (hasConsent === true) {
      setFavorites(getLocalFavorites());
    } else {
      setFavorites([]);
    }
  }, [isLoggedIn, hasConsent]);

  const isFavorite = useCallback(
    (slug: string) => favorites.includes(slug),
    [favorites],
  );

  const toggleFavorite = useCallback(
    async (slug: string) => {
      if (needsCookieConsent) return;

      // 直前のリクエストの完了を待ってから直列実行（レース回避）
      const run = toggleChainRef.current.then(async () => {
        const current = favoritesRef.current;
        const isCurrentlyFavorite = current.includes(slug);
        const action = isCurrentlyFavorite ? "remove" : "add";

        // 楽観的更新（最新 state を起点に）
        const optimistic = isCurrentlyFavorite
          ? current.filter((s) => s !== slug)
          : [slug, ...current];
        favoritesRef.current = optimistic;
        setFavorites(optimistic);

        if (isLoggedIn) {
          try {
            const r = await fetch("/api/favorites", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ slug, action }),
            });
            if (!r.ok) throw new Error("API error");
            const data = (await r.json()) as { favorites: string[] };
            favoritesRef.current = data.favorites;
            setFavorites(data.favorites);
            setSessionFavorites(data.favorites);
          } catch {
            // ロールバック: 楽観的更新の直前の state（current）に戻す
            favoritesRef.current = current;
            setFavorites(current);
          }
        } else {
          const next = isCurrentlyFavorite
            ? removeLocalFavorite(slug)
            : addLocalFavorite(slug);
          favoritesRef.current = next;
          setFavorites(next);
        }
      });

      // 失敗を握りつぶしてチェーンが切れないようにする
      toggleChainRef.current = run.catch(() => {});
      return run;
    },
    [isLoggedIn, needsCookieConsent],
  );

  const value = useMemo<FavoritesContextValue>(
    () => ({ favorites, isFavorite, toggleFavorite, needsCookieConsent, isLoading }),
    [favorites, isFavorite, toggleFavorite, needsCookieConsent, isLoading],
  );

  return <FavoritesContext.Provider value={value}>{children}</FavoritesContext.Provider>;
}

export function useFavorites(): FavoritesContextValue {
  const ctx = useContext(FavoritesContext);
  if (!ctx) {
    // Provider 外で使用された場合のフォールバック（空状態）
    return {
      favorites: [],
      isFavorite: () => false,
      toggleFavorite: async () => {},
      needsCookieConsent: false,
      isLoading: false,
    };
  }
  return ctx;
}
