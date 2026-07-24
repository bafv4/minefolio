// Twitch VODキャッシュ更新用のCronエンドポイント
// Vercel Cronで30分毎に実行: 新しいVODの取得 + 保持期間超過分のクリーンアップ
// 8時間毎: VODの存在確認（Twitch VODは配信者設定により14〜60日で自動削除されるため）

import { getEnv } from "@/lib/env.server";
import {
  fetchAndCacheNewVods,
  verifyVodsExistence,
  cleanupOldVods,
} from "@/lib/twitch-vod-cache";

export async function loader({ request }: { request: Request }) {
  const env = getEnv();

  // Vercel Cron認証（youtube-update と同パターン）。
  // CRON_SECRET が未設定なら認証不能。フェイルクローズして処理を拒否する
  const authHeader = request.headers.get("Authorization");
  const expectedToken = process.env.CRON_SECRET;

  if (!expectedToken) {
    return Response.json(
      { error: "Cron authentication is not configured" },
      { status: 503 }
    );
  }

  if (authHeader !== `Bearer ${expectedToken}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

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

    // 新しいVODの取得 + 保持期間超過分のクリーンアップ（30分毎に実行）
    const result = await fetchAndCacheNewVods(clientId, clientSecret);
    const cleaned = await cleanupOldVods();

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
