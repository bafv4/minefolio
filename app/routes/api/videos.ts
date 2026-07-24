// 動画一覧（/videos）の遅延ロード・無限スクロール用API
// クエリパラメータ: page（1始まりのページ番号。use-infinite-scroll フックの規約）,
// q, platform, from, to（検索条件）
// レスポンスはユーザー非依存（「自分の動画を隠す」設定はクライアント側で適用）。
// CDNキャッシュ（s-maxage + stale-while-revalidate）でエッジ配信し、オリジン到達を最小化する。

import type { Route } from "./+types/videos";
import { createDb } from "@/lib/db";
import { getPublicVideoFeed, parseVideoSearchParams } from "@/lib/videos-feed.server";

export const VIDEOS_PAGE_SIZE = 24;

export async function loader({ request }: Route.LoaderArgs) {
  const db = createDb();

  const url = new URL(request.url);
  const page = Math.max(1, Number.parseInt(url.searchParams.get("page") ?? "1", 10) || 1);
  const filters = parseVideoSearchParams(url.searchParams);

  const allItems = await getPublicVideoFeed(db, filters);
  const start = (page - 1) * VIDEOS_PAGE_SIZE;
  const items = allItems.slice(start, start + VIDEOS_PAGE_SIZE);

  return Response.json(
    {
      items,
      page,
      total: allItems.length,
      hasMore: start + items.length < allItems.length,
    },
    {
      headers: {
        // データ鮮度はcron更新間隔（YouTube 2時間 / Twitch 30分）で決まるため5分で十分
        "Cache-Control": "public, s-maxage=300, stale-while-revalidate=3600",
      },
    },
  );
}
