// 汎用無限スクロールフック。
// fetch + IntersectionObserver で追加ロードし、外部 props でも「もっと読み込む」ボタンから同じハンドラを呼べる。
// SSR で 1 ページ目を受け取り、クライアントで append していくモデル。
// 取得は useFetcher ではなく素の fetch で行う。fetcher.load の失敗は最寄りの ErrorBoundary（共通レイアウト）へ
// 送られてページ全体がエラー表示に置き換わり、フック側で失敗を受け取れないため。失敗は loadError で返し、
// 呼び出し側が一覧の末尾に帯と再試行を出す（retry）。
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router";
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
   * 追加ロードのリクエストにのみ付与する追加パラメータ（例: CDN キャッシュキーの
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
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  // 直近の追加ロードが失敗したか（成功・リセットで false に戻る）
  const [loadError, setLoadError] = useState(false);
  const [searchParams] = useSearchParams();
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  // 応答が届いた時点の検索条件と比べるため、最新の searchParams を ref に持つ（クロージャの値は古いことがある）
  const searchParamsRef = useRef(searchParams);
  searchParamsRef.current = searchParams;
  // 進行中の追加ロード。条件のリセット・アンマウントで中断し、中断した応答は採用しない
  const abortRef = useRef<AbortController | null>(null);
  // 取得済みの最終ページと追加ロード中フラグ。state（page / isLoadingMore）は再描画まで古い値のため、
  // 読み込み完了直後に IntersectionObserver が古い loadMore を呼ぶと同じページを二重に取得し、
  // 同じ項目が重複して append される（React の key 重複警告）。判定は ref で同期的に行う
  const pageRef = useRef(initialPage);
  const inFlightRef = useRef(false);
  const hasMoreRef = useRef(initialHasMore);
  // 失敗中はセンチネルからの自動読み込みを止め、再試行は利用者の操作に任せる（失敗の繰り返しを避ける）
  const loadErrorRef = useRef(false);
  // extraParams はオブジェクトの参照が呼び出しごとに変わりうるため、
  // useCallback の依存には安定な文字列キーを使う（stale closure を避ける）
  const extraParamsKey = useMemo(() => JSON.stringify(extraParams ?? {}), [extraParams]);

  // 検索/フィルタ/ソートが変わったらリセット
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    // 進行中ロードの結果は破棄（条件が変わったため）
    abortRef.current?.abort();
    abortRef.current = null;
    setItems(initialItems);
    setPage(initialPage);
    setHasMore(initialHasMore);
    setAddedCount(0);
    setIsLoadingMore(false);
    setLoadError(false);
    pageRef.current = initialPage;
    inFlightRef.current = false;
    hasMoreRef.current = initialHasMore;
    loadErrorRef.current = false;
    // resetDeps は呼び出し側責任
    // 依存配列は呼び出し側から展開して渡す
  }, [initialItems, initialPage, initialHasMore, ...resetDeps]);

  // アンマウント時は進行中のロードを中断する
  useEffect(() => () => abortRef.current?.abort(), []);

  const loadMore = useCallback(() => {
    // ロード中の判定は inFlightRef（loadMore 〜 応答の処理が終わるまで）。クロージャ内の
    // isLoadingMore は IntersectionObserver が古い loadMore を保持していると古い値のまま残りうる
    if (!hasMoreRef.current || inFlightRef.current) return;
    inFlightRef.current = true;
    loadErrorRef.current = false;
    setLoadError(false);
    setIsLoadingMore(true);
    const nextPage = pageRef.current + 1;
    const params = new URLSearchParams(searchParams);
    params.set("page", String(nextPage));
    for (const [key, value] of Object.entries(extraParams ?? {})) {
      params.set(key, value);
    }
    // この追加ロードが開始された時点の検索条件を記録
    const startedSig = paramsSignature(searchParams);
    const controller = new AbortController();
    abortRef.current = controller;
    // 中断（リセット・アンマウント）された、または新しいロードに置き換わった応答は捨てる
    const isCurrent = () => !controller.signal.aborted && abortRef.current === controller;

    fetch(`${endpoint}?${params.toString()}`, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return (await res.json()) as FetchResponse<T>;
      })
      .then((data) => {
        if (!isCurrent()) return;
        // 開始後に検索条件が変わっていれば結果を捨てる（別の検索条件のページが現在のリストへ混入するのを防ぐ）
        if (paramsSignature(searchParamsRef.current) !== startedSig) return;
        const newItems = data.items;
        hasMoreRef.current = data.hasMore;
        if (newItems.length === 0 && !data.hasMore) {
          setHasMore(false);
          return;
        }
        pageRef.current = data.page;
        setItems((prev) => [...prev, ...newItems]);
        setPage(data.page);
        setHasMore(data.hasMore);
        setAddedCount(newItems.length);
      })
      .catch((error) => {
        if (!isCurrent()) return;
        // 失敗時は page を進めない（再試行で同じページを取り直す）
        console.error("Failed to load more items:", error);
        loadErrorRef.current = true;
        setLoadError(true);
      })
      .finally(() => {
        if (abortRef.current !== controller) return;
        abortRef.current = null;
        inFlightRef.current = false;
        setIsLoadingMore(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
    // page は値としては使わないが、追加のたびに loadMore を作り直して IntersectionObserver を
    // 登録し直す（センチネルが可視のままだと交差の変化が起きず、次のロードが発火しないため）
  }, [hasMore, page, searchParams, endpoint, extraParamsKey]);

  // IntersectionObserver: センチネルが可視化したら loadMore
  useEffect(() => {
    if (!sentinelRef.current || !hasMore) return;
    const el = sentinelRef.current;
    const observer = new IntersectionObserver(
      (entries) => {
        if (loadErrorRef.current) return;
        // 負荷が高いと複数エントリが1回にまとまって届く（[非交差, 交差] など）。entries[0] は最古で、
        // それだけを見ると最新の交差を取りこぼし、センチネルが可視のままだと以後通知が来ず停止する
        if (entries.some((entry) => entry.isIntersecting)) {
          loadMore();
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMore, loadMore]);

  // 通知用テキスト（aria-live で読み上げる）。失敗は呼び出し側の帯（role="status"）が伝える
  const liveMessage = useMemo(() => {
    if (isLoadingMore) return t("loading.more");
    // 失敗の直後に前回の「N件を読み込みました」を読み上げない
    if (loadError) return "";
    if (addedCount > 0) return t("loading.moreLoaded", { count: addedCount });
    return "";
  }, [t, isLoadingMore, addedCount, loadError]);

  return {
    items,
    hasMore,
    isLoadingMore,
    loadMore,
    sentinelRef,
    liveMessage,
    /** 直近の追加ロードが失敗したか */
    loadError,
    /** 失敗した追加ロードをやり直す（loadMore と同じ。ロード中・続きが無いときは何もしない） */
    retry: loadMore,
  };
}
