/**
 * プレイヤーランキング更新用APIエンドポイント
 * Cron Triggerまたは外部サービスから定期的に呼び出される
 *
 * 処理内容:
 * - 各MinefolioユーザーのSpeedrun.com記録を取得
 * - 各MinefolioユーザーのMCSR Ranked記録を取得
 * - DBに保存
 *
 * 1ユーザー分の実処理は app/lib/rankings-update.server.ts に集約されている
 * （targeted-refresh.server.ts の1ユーザー即時更新とロジックを共有するため）。
 */

import { createDb } from "@/lib/db";
import { users, speedrunCategories } from "@/lib/schema";
import { eq, and } from "drizzle-orm";
import { excludeViewersCondition } from "@/lib/users-filter";
import { updateUserRankings, cleanupDuplicateVerifiedRankings } from "@/lib/rankings-update.server";

export async function loader({ request }: { request: Request }) {
  // セキュリティ: Vercel Cron認証（fail closed）。
  // CRON_SECRET が未設定の場合はチェックを飛ばさず拒否する。飛ばすと、
  // 全公開ユーザーを走査してレート制限付き外部APIを叩き DB 書き込みを行う
  // この重い処理を、匿名の攻撃者が自由に起動できてしまうため。
  const authHeader = request.headers.get("authorization");
  const expectedToken = process.env.CRON_SECRET;

  if (!expectedToken) {
    console.error("CRON_SECRET is not configured; refusing cron request");
    return new Response("Service Unavailable", { status: 503 });
  }

  if (authHeader !== `Bearer ${expectedToken}`) {
    console.warn("Unauthorized cron request attempt");
    return new Response("Unauthorized", { status: 401 });
  }

  console.log("Rankings update started:", new Date().toISOString());

  try {
    const db = createDb();

    // アクティブなカテゴリを取得
    const categories = await db.query.speedrunCategories.findMany({
      where: eq(speedrunCategories.isActive, true),
    });

    // 公開ユーザーを取得（視聴者ロールは除外）
    const allUsers = await db.query.users.findMany({
      where: and(eq(users.profileVisibility, "public"), excludeViewersCondition),
      columns: {
        id: true,
        mcid: true,
        uuid: true,
        speedruncomId: true,
        speedruncomUsername: true,
      },
    });

    console.log(`Processing ${allUsers.length} users, ${categories.length} categories`);

    let speedruncomUpdates = 0;
    let rankedPbUpdates = 0;
    let rankedEloUpdates = 0;
    let speedruncomIdResolved = 0;

    for (const user of allUsers) {
      const result = await updateUserRankings(db, categories, user);
      speedruncomUpdates += result.speedruncomUpdates;
      rankedPbUpdates += result.rankedPbUpdates;
      rankedEloUpdates += result.rankedEloUpdates;
      if (result.speedruncomIdResolved) speedruncomIdResolved++;
    }

    // 重複した審査済み記録の整理（全ユーザー対象）
    const duplicatesRemoved = await cleanupDuplicateVerifiedRankings(db);

    console.log(`Rankings update completed: SRC=${speedruncomUpdates}, PB=${rankedPbUpdates}, Elo=${rankedEloUpdates}, IDs resolved=${speedruncomIdResolved}, dup removed=${duplicatesRemoved}`);

    return Response.json({
      success: true,
      message: "Rankings updated successfully",
      stats: {
        usersProcessed: allUsers.length,
        categoriesCount: categories.length,
        speedruncomUpdates,
        rankedPbUpdates,
        rankedEloUpdates,
        speedruncomIdResolved,
        duplicatesRemoved,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Failed to update rankings:", error);

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
