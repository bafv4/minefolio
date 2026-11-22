// ペース一覧（/paces）の遅延ロード・無限スクロール用API
// クエリパラメータ: page（1始まりのページ番号。use-infinite-scroll フックの規約）,
// q, split, from, to, maxTime（検索条件）, sort（"time"=タイム順。未指定は新しい順）
// レスポンスはユーザー非依存（「自分のペースを隠す」設定はクライアント側で適用）。
// CDNキャッシュ（s-maxage + stale-while-revalidate）でエッジ配信し、オリジン到達を最小化する。

import type { Route } from "./+types/paces";
import { getPublicPaceFeed, parsePaceSearchParams, withPaceProfiles } from "@/lib/paces-feed.server";

export const PACES_PAGE_SIZE = 60;

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const page = Math.max(1, Number.parseInt(url.searchParams.get("page") ?? "1", 10) || 1);
  const filters = parsePaceSearchParams(url.searchParams);

  const { items: allItems, userData } = await getPublicPaceFeed(filters);
  const start = (page - 1) * PACES_PAGE_SIZE;
  // 走者情報（uuid・表示名・スキン）はこのページの分だけ各ペースに添える（全ユーザー分は送らない）
  const items = withPaceProfiles(allItems.slice(start, start + PACES_PAGE_SIZE), userData);

  return Response.json(
    {
      items,
      page,
      total: allItems.length,
      hasMore: start + items.length < allItems.length,
    },
    {
      headers: {
        "Cache-Control": "public, s-maxage=30, stale-while-revalidate=300",
      },
    },
  );
}
