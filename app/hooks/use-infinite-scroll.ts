// 汎用無限スクロールフック。
// useFetcher + IntersectionObserver で追加ロードし、外部 props でも「もっと読み込む」ボタンから同じハンドラを呼べる。
// SSR で 1 ページ目を受け取り、クライアントで append していくモデル。
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFetcher, useSearchParams } from "react-router";

interface UseInfiniteScrollOptions<T> {
  /** SSR で受け取った初期データ */
  initialItems: T[];
  /** 初期ページ番号（通常 1） */
  initialPage: number;
  /** 追加ロード可能フラグの初期値 */
  initialHasMore: boolean;
  /** 取得先のリソースルート URL（例: "/api/browse"） */
  endpoint: string;
  /** フィルタ/検索などの変化を検知し、変わったらリスト再構築する依存配列 */
  resetDeps: ReadonlyArray<unknown>;
}

interface FetchResponse<T> {
  items: T[];
  hasMore: boolean;
  page: number;
}

export function useInfiniteScroll<T>({
  initialItems,
  initialPage,
  initialHasMore,
  endpoint,
  resetDeps,
}: UseInfiniteScrollOptions<T>) {
  const [items, setItems] = useState<T[]>(initialItems);
  const [page, setPage] = useState(initialPage);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [addedCount, setAddedCount] = useState(0);
  const fetcher = useFetcher<FetchResponse<T>>();
  const [searchParams] = useSearchParams();
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  // 検索/フィルタ/ソートが変わったらリセット
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    setItems(initialItems);
    setPage(initialPage);
    setHasMore(initialHasMore);
    setAddedCount(0);
    // resetDeps は呼び出し側責任
    // 依存配列は呼び出し側から展開して渡す
  }, [initialItems, initialPage, initialHasMore, ...resetDeps]);

  // fetcher 完了時に items に append
  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    const data = fetcher.data;
    const newItems = data.items;
    if (newItems.length === 0 && !data.hasMore) {
      setHasMore(false);
      return;
    }
    setItems((prev) => [...prev, ...newItems]);
    setPage(data.page);
    setHasMore(data.hasMore);
    setAddedCount(newItems.length);
  }, [fetcher.state, fetcher.data]);

  const loadMore = useCallback(() => {
    if (!hasMore || fetcher.state !== "idle") return;
    const nextPage = page + 1;
    const params = new URLSearchParams(searchParams);
    params.set("page", String(nextPage));
    fetcher.load(`${endpoint}?${params.toString()}`);
  }, [hasMore, fetcher, page, searchParams, endpoint]);

  // IntersectionObserver: センチネルが可視化したら loadMore
  useEffect(() => {
    if (!sentinelRef.current || !hasMore) return;
    const el = sentinelRef.current;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          loadMore();
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMore, loadMore]);

  const isLoadingMore = fetcher.state !== "idle";

  // 通知用テキスト（aria-live で読み上げる）
  const liveMessage = useMemo(() => {
    if (isLoadingMore) return "追加読み込み中…";
    if (addedCount > 0) return `${addedCount}件を追加で読み込みました`;
    return "";
  }, [isLoadingMore, addedCount]);

  return {
    items,
    hasMore,
    isLoadingMore,
    loadMore,
    sentinelRef,
    liveMessage,
  };
}
