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
  cleanupOldVideos,
} from "@/lib/youtube-cache";

export async function loader({ request }: { request: Request }) {
  const env = getEnv();

  // Vercel Cron認証。CRON_SECRET は getEnv() の返却に含まれないため
  // paceman/rankings と同様に process.env から直接参照する。
  const authHeader = request.headers.get("Authorization");
  const expectedToken = process.env.CRON_SECRET;

  // CRON_SECRET が未設定なら認証不能。フェイルクローズして処理を拒否する
  // （スキップすると未認証の呼び出しで YouTube Data API のクォータを消費できてしまう）。
  if (!expectedToken) {
    return Response.json(
      { error: "Cron authentication is not configured" },
      { status: 503 }
    );
  }

  // CRON_SECRET が設定済みの場合は正しい Bearer トークンを必須とする
  if (authHeader !== `Bearer ${expectedToken}`) {
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
      // 保持期間（90日）を超えた動画キャッシュを削除
      const cleaned = await cleanupOldVideos();
      return Response.json({
        success: true,
        action: "update",
        channels: channels.length,
        added: result.added,
        updated: result.updated,
        cleaned,
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
