// /browse 用の追加読み込みリソースルート。
// 同じクエリビルダーを使い、useFetcher による「もっと読み込む」/ IntersectionObserver で呼ばれる。
import type { LoaderFunctionArgs } from "react-router";
import { createDb } from "@/lib/db";
import { createAuth } from "@/lib/auth";
import { getEnv } from "@/lib/env.server";
import { getOptionalSession } from "@/lib/session";
import {
  loadBrowsePage,
  parseBrowseSearchParams,
  getViewerFavoriteSlugs,
} from "@/lib/browse-query.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const env = getEnv();
  const db = createDb();
  const auth = createAuth(db, env);
  const session = await getOptionalSession(request, auth);

  const url = new URL(request.url);
  const args = parseBrowseSearchParams(url.searchParams);
  const favoriteSlugs = await getViewerFavoriteSlugs(
    db,
    session?.user?.id ?? null,
  );
  const { players, hasMore, totalCount, totalPages } = await loadBrowsePage(
    db,
    args,
    favoriteSlugs,
  );

  // favoriteSlugs はお気に入り優先ソートに影響するためレスポンスはユーザー非依存にできない。
  // セッションの有無で Cache-Control を出し分け、匿名分は CDN でキャッシュさせる
  // （ログイン中は private/no-store。同一URLでのcookie変種混同を避けるため、
  // URL 側の分離は browse.tsx コンポーネントが useInfiniteScroll の extraParams で
  // fetcher リクエストURLにのみ auth=1 を付与する形で行う）。
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
