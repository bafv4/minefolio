// Twitch VODキャッシュ更新用のCronエンドポイント
// Vercel Cronで30分毎に実行: 新しいVODの取得 + 保持期間超過分のクリーンアップ
// 8時間毎: VODの存在確認（Twitch VODは配信者設定により14〜60日で自動削除されるため）

import { getEnv } from "@/lib/env.server";
import { requireCronAuth } from "@/lib/cron-auth.server";
import {
  fetchAndCacheNewVods,
  verifyVodsExistence,
  cleanupOldVods,
} from "@/lib/twitch-vod-cache";

export async function loader({ request }: { request: Request }) {
  const env = getEnv();

  const authError = requireCronAuth(request);
  if (authError) return authError;

  const clientId = env.TWITCH_CLIENT_ID;
  const clientSecret = env.TWITCH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return Response.json(
      { error: "Twitch credentials not configured" },
      { status: 500 }
    );
  }

  const url = new URL(request.url);
  const action = url.searchParams.get("action") || "update";

  try {
    if (action === "verify") {
      // VODの存在確認（8時間毎に実行）
      const result = await verifyVodsExistence(clientId, clientSecret);
      return Response.json({
        success: true,
        action: "verify",
        verified: result.verified,
        removed: result.removed,
      });
    }

    // 新しいVODの取得 + 保持期間超過分のクリーンアップ（30分毎に実行。両者は独立なので並列）
    const [result, cleaned] = await Promise.all([
      fetchAndCacheNewVods(clientId, clientSecret),
      cleanupOldVods(),
    ]);

    return Response.json({
      success: true,
      action: "update",
      channels: result.channels,
      added: result.added,
      updated: result.updated,
      cleaned,
    });
  } catch (error) {
    console.error("Twitch VOD cache update failed:", error);
    return Response.json(
      { error: "Update failed", message: String(error) },
      { status: 500 }
    );
  }
}
