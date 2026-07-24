// twitch_vod_cache テーブルを追加する一回限りのスクリプト。
//
// 背景: Twitch配信アーカイブ（VOD）を youtube_video_cache と同様に cron で蓄積するための
// 専用テーブル。`pnpm db:push` はローカルDBとのドリフト（api_cache の索引名不一致）で
// 無関係な DDL まで巻き込んで失敗するため、必要な CREATE TABLE / INDEX のみを手動 DDL で適用する。
// DDL は `pnpm gen:test-schema`（drizzle-kit export）の出力と同一。
//
// 新規テーブルの追加のみで既存データは変更しない。
//
// 実行:
//   pnpm exec tsx scripts/add-twitch-vod-cache.ts                   # ローカル（.env）に dry-run
//   pnpm exec tsx scripts/add-twitch-vod-cache.ts --apply           # ローカルに適用
//   pnpm exec tsx scripts/add-twitch-vod-cache.ts --remote          # リモート（.env.remote）に dry-run
//   pnpm exec tsx scripts/add-twitch-vod-cache.ts --remote --apply  # リモートに適用（要ユーザー承認）
import { createClient } from "@libsql/client";
import { loadDbEnv } from "./lib/db-env";

const { url, authToken } = loadDbEnv();

const apply = process.argv.includes("--apply");
const client = createClient({ url, authToken });

console.log(`モード: ${apply ? "APPLY（実際に適用します）" : "DRY-RUN（表示のみ・変更なし）"}`);

const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS \`twitch_vod_cache\` (
	\`id\` text PRIMARY KEY NOT NULL,
	\`vod_id\` text NOT NULL,
	\`user_login\` text NOT NULL,
	\`title\` text NOT NULL,
	\`thumbnail_url\` text,
	\`channel_title\` text,
	\`duration_seconds\` integer,
	\`published_at\` integer NOT NULL,
	\`last_verified_at\` integer NOT NULL,
	\`is_available\` integer DEFAULT true NOT NULL,
	\`created_at\` integer NOT NULL,
	\`updated_at\` integer NOT NULL
)`,
  "CREATE UNIQUE INDEX IF NOT EXISTS `twitch_vod_cache_vod_id_unique` ON `twitch_vod_cache` (`vod_id`)",
  "CREATE INDEX IF NOT EXISTS `idx_twitch_vod_cache_vod_id` ON `twitch_vod_cache` (`vod_id`)",
  "CREATE INDEX IF NOT EXISTS `idx_twitch_vod_cache_user_login` ON `twitch_vod_cache` (`user_login`)",
  "CREATE INDEX IF NOT EXISTS `idx_twitch_vod_cache_published` ON `twitch_vod_cache` (`published_at`)",
  "CREATE INDEX IF NOT EXISTS `idx_twitch_vod_cache_available` ON `twitch_vod_cache` (`is_available`)",
];

async function tableExists(name: string) {
  const res = await client.execute({
    sql: "SELECT name FROM sqlite_master WHERE type='table' AND name=?;",
    args: [name],
  });
  return res.rows.length > 0;
}

const already = await tableExists("twitch_vod_cache");

if (already) {
  console.log("ℹ️  twitch_vod_cache は既に存在します（インデックスのみ IF NOT EXISTS で確認します）。");
}

if (apply) {
  for (const stmt of STATEMENTS) {
    await client.execute(stmt);
  }
  const created = await tableExists("twitch_vod_cache");
  if (!created) {
    console.error("❌ テーブルの作成に失敗しました。");
    process.exit(1);
  }
  console.log("✅ 適用完了（twitch_vod_cache + インデックス4件 + UNIQUE索引）。");
} else {
  console.log("実行予定のSQL:");
  for (const stmt of STATEMENTS) {
    console.log(`  ${stmt.replace(/\n\s*/g, " ")};`);
  }
  console.log("ℹ️  dry-run のため変更していません（--apply 付きで実行すると適用します）。");
}

process.exit(0);
