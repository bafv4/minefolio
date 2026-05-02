import { useEffect, useState } from "react";

/**
 * メディアクエリの一致状態をリアクティブに返す。
 * SSR 時は `ssrDefault` を返し、ハイドレーション後にクライアント側で再評価する。
 */
export function useMediaQuery(query: string, ssrDefault = false): boolean {
  const [matches, setMatches] = useState(ssrDefault);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(query);
    const apply = (next: boolean) => {
      setMatches((prev) => (prev === next ? prev : next));
    };
    apply(mq.matches);
    const handler = (e: MediaQueryListEvent) => apply(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [query]);

  return matches;
}
