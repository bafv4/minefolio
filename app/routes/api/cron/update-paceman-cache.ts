/**
 * PaceManキャッシュ更新用APIエンドポイント
 * Cron Triggerまたは外部サービスから定期的に呼び出される
 */

import { createDb } from "@/lib/db";
import { users } from "@/lib/schema";
import { isNotNull } from "drizzle-orm";
import { fetchRecentRunsForUsers } from "@/lib/paceman";
import { cachePacemanPaces } from "@/lib/paceman-cache";

export async function loader({ context, request }: { request: Request; context: any }) {
  // セキュリティ: Vercel Cron認証
  // Vercel Cronは自動的にAuthorizationヘッダーを設定する
  // 環境変数CRON_SECRETと一致する必要がある
  const authHeader = request.headers.get("authorization");
  const expectedToken = context.env?.CRON_SECRET || process.env.CRON_SECRET;

  // 本番環境ではトークン認証を必須にする
  if (expectedToken && authHeader !== `Bearer ${expectedToken}`) {
    console.warn("Unauthorized cron request attempt");
    return new Response("Unauthorized", { status: 401 });
  }

  console.log("PaceMan cache update started:", new Date().toISOString());

  try {
    const db = createDb();

    // MCIDを持つすべてのユーザーを取得
    const usersWithMcid = await db
      .select({ mcid: users.mcid })
      .from(users)
      .where(isNotNull(users.mcid));

    const registeredMcids = usersWithMcid.map((u) => u.mcid!.toLowerCase());

    console.log(`Found ${registeredMcids.length} users with MCID`);

    if (registeredMcids.length === 0) {
      return Response.json({
        success: true,
        message: "No users with MCID found",
        cachedPaces: 0,
        timestamp: new Date().toISOString(),
      });
    }

    // PaceMan APIから過去1週間のデータを取得
    const recentPaces = await fetchRecentRunsForUsers(
      registeredMcids,
      168, // 1週間
      5,   // 最低5回のプレイ
      100  // 最大100件
    );

    console.log(`Fetched ${recentPaces.length} paces from PaceMan`);

    if (recentPaces.length > 0) {
      // DBキャッシュに保存
      await cachePacemanPaces(recentPaces);
      console.log(`Successfully cached ${recentPaces.length} paces`);
    }

    return Response.json({
      success: true,
      message: "PaceMan cache updated successfully",
      usersCount: registeredMcids.length,
      cachedPaces: recentPaces.length,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Failed to update PaceMan cache:", error);

    return Response.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}
