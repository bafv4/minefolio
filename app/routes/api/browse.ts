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

export async function loader({ context, request }: LoaderFunctionArgs) {
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

  return Response.json({
    items: players,
    hasMore,
    totalCount,
    totalPages,
    page: args.page,
  });
}
