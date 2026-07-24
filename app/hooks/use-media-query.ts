import { useCallback, useSyncExternalStore } from "react";

interface MediaQueryEntry {
  mql: MediaQueryList;
  listeners: Set<() => void>;
  matches: boolean;
  handler: (e: MediaQueryListEvent) => void;
}

// クエリ文字列ごとに MediaQueryList を1つだけ生成して共有するレジストリ。
// 同一クエリを複数コンポーネントが購読しても、ネイティブの matchMedia 呼び出し・
// change リスナーは1つに集約される。
const registry = new Map<string, MediaQueryEntry>();

function getEntry(query: string): MediaQueryEntry | null {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return null;
  const existing = registry.get(query);
  if (existing) return existing;

  const mql = window.matchMedia(query);
  const entry: MediaQueryEntry = {
    mql,
    listeners: new Set(),
    matches: mql.matches,
    handler: () => {},
  };
  entry.handler = (e: MediaQueryListEvent) => {
    entry.matches = e.matches;
    entry.listeners.forEach((listener) => listener());
  };
  mql.addEventListener("change", entry.handler);
  registry.set(query, entry);
  return entry;
}

function subscribe(query: string, onStoreChange: () => void): () => void {
  const entry = getEntry(query);
  if (!entry) return () => {};
  entry.listeners.add(onStoreChange);
  return () => {
    entry.listeners.delete(onStoreChange);
    // 最後の購読者が抜けたらネイティブリスナーを解除しレジストリからも削除する
    if (entry.listeners.size === 0) {
      entry.mql.removeEventListener("change", entry.handler);
      registry.delete(query);
    }
  };
}

function getSnapshot(query: string): boolean {
  return getEntry(query)?.matches ?? false;
}

/**
 * メディアクエリの一致状態をリアクティブに返す。
 * SSR 時は `ssrDefault` を返し、ハイドレーション後にクライアント側で再評価する。
 * 同一クエリの MediaQueryList / change リスナーはコンポーネント間で共有される。
 */
export function useMediaQuery(query: string, ssrDefault = false): boolean {
  const subscribeToQuery = useCallback(
    (onStoreChange: () => void) => subscribe(query, onStoreChange),
    [query],
  );
  const getClientSnapshot = useCallback(() => getSnapshot(query), [query]);
  const getServerSnapshot = useCallback(() => ssrDefault, [ssrDefault]);

  return useSyncExternalStore(subscribeToQuery, getClientSnapshot, getServerSnapshot);
}
