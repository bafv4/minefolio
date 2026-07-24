// 動画一覧（/videos）の遅延ロード・無限スクロール用API
// クエリパラメータ: offset, limit（ページング）, q, platform, from, to（検索条件）
// レスポンスはユーザー非依存（「自分の動画を隠す」設定はクライアント側で適用）。
// CDNキャッシュ（s-maxage + stale-while-revalidate）でエッジ配信し、オリジン到達を最小化する。

import type { Route } from "./+types/videos";
import { createDb } from "@/lib/db";
import { getPublicVideoFeed, parseVideoSearchParams } from "@/lib/videos-feed.server";

const DEFAULT_LIMIT = 24;
const MAX_LIMIT = 60;

export async function loader({ request }: Route.LoaderArgs) {
  const db = createDb();

  const url = new URL(request.url);
  const offset = Math.max(0, Number.parseInt(url.searchParams.get("offset") ?? "0", 10) || 0);
  const rawLimit = Number.parseInt(url.searchParams.get("limit") ?? "", 10);
  const limit = Math.min(Math.max(Number.isNaN(rawLimit) ? DEFAULT_LIMIT : rawLimit, 1), MAX_LIMIT);
  const filters = parseVideoSearchParams(url.searchParams);

  const { items } = await getPublicVideoFeed(db, filters);
  const videos = items.slice(offset, offset + limit);

  return Response.json(
    {
      videos,
      total: items.length,
      hasMore: offset + videos.length < items.length,
    },
    {
      headers: {
        // データ鮮度はcron更新間隔（YouTube 2時間 / Twitch 30分）で決まるため5分で十分
        "Cache-Control": "public, s-maxage=300, stale-while-revalidate=3600",
      },
    },
  );
}
