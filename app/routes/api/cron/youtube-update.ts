// YouTube動画キャッシュ更新用のCronエンドポイント
// Vercel Cronで2時間毎に実行: 新しい動画の取得
// 半日に1回: 動画の存在確認
// 5分毎: ライブ配信の確認

import { getEnv } from "@/lib/env.server";
import {
  fetchAndCacheNewVideos,
  verifyVideosExistence,
  getRegisteredYouTubeChannels,
  fetchAndCacheLiveStreams,
  cleanupOldLiveCache,
} from "@/lib/youtube-cache";

export async function loader({ request, context }: { request: Request; context: any }) {
  const env = context.env ?? getEnv();

  // Vercel CronからのリクエストかAPIキーで認証
  const authHeader = request.headers.get("Authorization");
  const cronSecret = env.CRON_SECRET;

  // 認証チェック（CRON_SECRETが設定されている場合）
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const apiKey = env.YOUTUBE_API_KEY;
  if (!apiKey) {
    return Response.json({ error: "YouTube API key not configured" }, { status: 500 });
  }

  const url = new URL(request.url);
  const action = url.searchParams.get("action") || "update";

  try {
    if (action === "verify") {
      // 動画の存在確認（半日に1回実行）
      const result = await verifyVideosExistence(apiKey);
      return Response.json({
        success: true,
        action: "verify",
        verified: result.verified,
        removed: result.removed,
      });
    } else if (action === "live") {
      // ライブ配信の確認（5分毎に実行）
      const channels = await getRegisteredYouTubeChannels();

      if (channels.length === 0) {
        return Response.json({
          success: true,
          action: "live",
          message: "No channels to check",
          live: 0,
          upcoming: 0,
          ended: 0,
        });
      }

      const result = await fetchAndCacheLiveStreams(apiKey, channels);

      // 古いキャッシュをクリーンアップ
      const cleaned = await cleanupOldLiveCache();

      return Response.json({
        success: true,
        action: "live",
        channels: channels.length,
        live: result.live,
        upcoming: result.upcoming,
        ended: result.ended,
        cleaned,
      });
    } else {
      // 新しい動画の取得（2時間毎に実行）
      const channels = await getRegisteredYouTubeChannels();

      if (channels.length === 0) {
        return Response.json({
          success: true,
          action: "update",
          message: "No channels to update",
          added: 0,
          updated: 0,
        });
      }

      const result = await fetchAndCacheNewVideos(apiKey, channels);
      return Response.json({
        success: true,
        action: "update",
        channels: channels.length,
        added: result.added,
        updated: result.updated,
      });
    }
  } catch (error) {
    console.error("YouTube cache update failed:", error);
    return Response.json(
      { error: "Update failed", message: String(error) },
      { status: 500 }
    );
  }
}
