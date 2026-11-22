// /browse 用の追加読み込みリソースルート。
// 同じクエリビルダーを使い、useFetcher による「もっと読み込む」/ IntersectionObserver で呼ばれる。
import type { LoaderFunctionArgs } from "react-router";
import { createDb } from "@/lib/db";
import { createAuth } from "@/lib/auth";
import { getEnv } from "@/lib/env.server";
import { getOptionalSession } from "@/lib/session";
import {
  countBrowse,
  loadBrowsePage,
  parseBrowseSearchParams,
  getViewerFavoriteSlugs,
} from "@/lib/browse-query.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const env = getEnv();
  const db = createDb();

  const url = new URL(request.url);
  const args = parseBrowseSearchParams(url.searchParams);

  // ?count=1: 件数のみ（フィルタダイアログの「{n}件を表示」用）。一覧と同じ条件解釈で count(*) だけ数える。
  // お気に入り順に依存しないためセッションは見ず、ログイン有無に関わらず CDN キャッシュ可。
  if (url.searchParams.get("count") === "1") {
    const total = await countBrowse(db, args);
    return Response.json(
      { total },
      { headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=300" } },
    );
  }

  const auth = createAuth(db, env);
  const session = await getOptionalSession(request, auth);

  // お気に入り取得は loadBrowsePage 内で count と並行して解決される
  const favoriteSlugs = getViewerFavoriteSlugs(db, session?.user?.id ?? null);
  const { players, hasMore, totalCount, totalPages } = await loadBrowsePage(
    db,
    args,
    favoriteSlugs,
  );

  // favoriteSlugs はお気に入り優先ソートに影響するためレスポンスはユーザー非依存にできない。
  // セッションの有無で Cache-Control を出し分け、匿名分は CDN でキャッシュさせる
  // （ログイン中は private/no-store。同一URLでのcookie変種混同を避けるため、
  // URL 側の分離は browse.tsx コンポーネントが useInfiniteScroll の extraParams で
  // 追加読み込みの fetch リクエストURLにのみ auth=1 を付与する形で行う）。
  const cacheControl = session
    ? "private, no-store"
    : "public, s-maxage=30, stale-while-revalidate=300";

  return Response.json(
    {
      items: players,
      hasMore,
      totalCount,
      totalPages,
      page: args.page,
    },
    { headers: { "Cache-Control": cacheControl } },
  );
}
