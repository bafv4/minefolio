// Cloudflare Workers Cron Triggers
// wrangler.tomlで設定されたスケジュールで実行される

import type { D1Database } from "@cloudflare/workers-types";
import { syncMcid } from "./lib/mojang";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { users } from "./lib/schema";

interface Env {
  DB: D1Database;
}

/**
 * Cloudflare Workers Cron Handler
 * @param event - スケジュールイベント
 * @param env - 環境変数とバインディング
 * @param ctx - 実行コンテキスト
 */
export default {
  async scheduled(
    event: ScheduledEvent,
    env: Env,
    ctx: ExecutionContext
  ): Promise<void> {
    const db = drizzle(env.DB);

    console.log(`Cron job started: ${event.cron}`);

    try {
      switch (event.cron) {
        case "0 0 * * *":
          // 毎日0:00 UTC - MCID同期
          await syncAllMcids(db);
          break;

        case "0 1 * * *":
          // 毎日1:00 UTC - Speedrun.com同期（将来の実装）
          console.log("Speedrun.com sync - not implemented yet");
          break;

        default:
          console.warn(`Unknown cron schedule: ${event.cron}`);
      }

      console.log(`Cron job completed: ${event.cron}`);
    } catch (error) {
      console.error(`Cron job failed: ${event.cron}`, error);
      // エラーをスローしてCloudflareにリトライを促す
      throw error;
    }
  },
};

/**
 * すべてのユーザーのMCIDを同期
 * Mojang APIからUUIDに対応する最新のMCIDを取得し、変更があれば更新
 */
async function syncAllMcids(db: ReturnType<typeof drizzle>): Promise<void> {
  console.log("Starting MCID sync for all users");

  // すべてのユーザーを取得
  const allUsers = await db.select().from(users).all();

  console.log(`Found ${allUsers.length} users to sync`);

  let updatedCount = 0;
  let errorCount = 0;

  for (const user of allUsers) {
    try {
      // UUIDから最新のMCIDを取得
      const result = await syncMcid(user.uuid, user.mcid);

      if (result.changed && result.newMcid) {
        // MCIDが変更された場合はDBを更新
        await db
          .update(users)
          .set({
            mcid: result.newMcid,
            updatedAt: new Date(),
          })
          .where(eq(users.uuid, user.uuid));

        console.log(
          `Updated MCID for user ${user.uuid}: ${user.mcid} -> ${result.newMcid}`
        );
        updatedCount++;
      }
    } catch (error) {
      console.error(`Failed to sync MCID for user ${user.uuid}:`, error);
      errorCount++;
      // エラーがあっても他のユーザーの同期は続行
    }

    // レート制限を避けるため少し待機（100ms）
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  console.log(
    `MCID sync completed: ${updatedCount} updated, ${errorCount} errors`
  );
}

/**
 * Speedrun.com からレコードを同期（将来の実装）
 */
async function syncSpeedrunRecords(
  db: ReturnType<typeof drizzle>
): Promise<void> {
  console.log("Speedrun.com sync - placeholder");
  // TODO: Speedrun.com APIと連携してレコードを自動更新
  // - ユーザーのSpeedrun.com IDを取得
  // - 最新のランを取得
  // - DBを更新
}
