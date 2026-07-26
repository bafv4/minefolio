// 汎用無限スクロールフック。
// useFetcher + IntersectionObserver で追加ロードし、外部 props でも「もっと読み込む」ボタンから同じハンドラを呼べる。
// SSR で 1 ページ目を受け取り、クライアントで append していくモデル。
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFetcher, useSearchParams } from "react-router";
import { useT } from "@/hooks/use-locale";

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
  /**
   * fetcher リクエストにのみ付与する追加パラメータ（例: CDN キャッシュキーの
   * URL空間分離用に `{ auth: "1" }` を渡す）。ドキュメント側の searchParams
   * には反映されない＝アドレスバー・共有リンクには乗らない。
   */
  extraParams?: Record<string, string>;
}

interface FetchResponse<T> {
  items: T[];
  hasMore: boolean;
  page: number;
}

/** page を除いた検索/フィルタ条件の署名（追加ロードの陳腐化判定に使う） */
function paramsSignature(sp: URLSearchParams): string {
  const p = new URLSearchParams(sp);
  p.delete("page");
  p.sort();
  return p.toString();
}

export function useInfiniteScroll<T>({
  initialItems,
  initialPage,
  initialHasMore,
  endpoint,
  resetDeps,
  extraParams,
}: UseInfiniteScrollOptions<T>) {
  const t = useT();
  const [items, setItems] = useState<T[]>(initialItems);
  const [page, setPage] = useState(initialPage);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [addedCount, setAddedCount] = useState(0);
  const fetcher = useFetcher<FetchResponse<T>>();
  const [searchParams] = useSearchParams();
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  // 進行中の追加ロードが、どの検索条件で開始されたかを記録（陳腐化判定用）
  const loadedSigRef = useRef<string | null>(null);
  // extraParams はオブジェクトの参照が呼び出しごとに変わりうるため、
  // useCallback の依存には安定な文字列キーを使う（stale closure を避ける）
  const extraParamsKey = useMemo(() => JSON.stringify(extraParams ?? {}), [extraParams]);

  // 検索/フィルタ/ソートが変わったらリセット
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    setItems(initialItems);
    setPage(initialPage);
    setHasMore(initialHasMore);
    setAddedCount(0);
    // 進行中ロードの結果は破棄（条件が変わったため）
    loadedSigRef.current = null;
    // resetDeps は呼び出し側責任
    // 依存配列は呼び出し側から展開して渡す
  }, [initialItems, initialPage, initialHasMore, ...resetDeps]);

  // fetcher 完了時に items に append
  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    // 進行中ロードが無い（null）か、開始後に検索条件が変わっていれば結果を捨てる
    // （別の検索条件のページが現在のリストへ混入するのを防ぐ）
    if (loadedSigRef.current !== paramsSignature(searchParams)) {
      return;
    }
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
    loadedSigRef.current = null;
  }, [fetcher.state, fetcher.data, searchParams]);

  const loadMore = useCallback(() => {
    if (!hasMore || fetcher.state !== "idle") return;
    const nextPage = page + 1;
    const params = new URLSearchParams(searchParams);
    params.set("page", String(nextPage));
    for (const [key, value] of Object.entries(extraParams ?? {})) {
      params.set(key, value);
    }
    // この追加ロードが開始された時点の検索条件を記録
    loadedSigRef.current = paramsSignature(searchParams);
    fetcher.load(`${endpoint}?${params.toString()}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasMore, fetcher, page, searchParams, endpoint, extraParamsKey]);

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
    if (isLoadingMore) return t("loading.more");
    if (addedCount > 0) return t("loading.moreLoaded", { count: addedCount });
    return "";
  }, [t, isLoadingMore, addedCount]);

  return {
    items,
    hasMore,
    isLoadingMore,
    loadMore,
    sentinelRef,
    liveMessage,
  };
}
