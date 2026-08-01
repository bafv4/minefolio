// ページビュー集計テーブル（page_view_stats）を追加する一回限りのスクリプト。
//
// 背景: Vercel Web Analytics から cron（/api/cron/update-page-views）が取得する
// 直近7日のパス別PVスナップショットを保持するテーブル。
// `pnpm db:push` はローカルDBとのドリフト（api_cache の索引名不一致）で
// 無関係な DDL まで巻き込んで失敗するため、必要な CREATE TABLE / INDEX のみを
// 手動 DDL で適用する（add-like-tables.ts と同じ方式）。
// DDL は `pnpm gen:test-schema`（drizzle-kit export）の出力と同一で、再実行に備えて
// IF NOT EXISTS のみ付け足している。
//
// 新規テーブルの追加のみで既存データは変更しない。
//
// 実行:
//   pnpm exec tsx scripts/add-page-view-stats-table.ts                   # ローカル（.env）に dry-run
//   pnpm exec tsx scripts/add-page-view-stats-table.ts --apply           # ローカルに適用
//   pnpm exec tsx scripts/add-page-view-stats-table.ts --remote          # リモート（.env.remote）に dry-run
//   pnpm exec tsx scripts/add-page-view-stats-table.ts --remote --apply  # リモートに適用（要ユーザー承認）
import { createClient } from "@libsql/client";
import { loadDbEnv } from "./lib/db-env";

const { url, authToken } = loadDbEnv();

const apply = process.argv.includes("--apply");
const client = createClient({ url, authToken });

console.log(`モード: ${apply ? "APPLY（実際に適用します）" : "DRY-RUN（表示のみ・変更なし）"}`);

const TABLE = "page_view_stats";

const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS \`page_view_stats\` (
	\`id\` text PRIMARY KEY NOT NULL,
	\`target_type\` text NOT NULL,
	\`target_id\` text NOT NULL,
	\`pageviews\` integer DEFAULT 0 NOT NULL,
	\`window_start\` integer NOT NULL,
	\`window_end\` integer NOT NULL,
	\`fetched_at\` integer NOT NULL
)`,
  "CREATE UNIQUE INDEX IF NOT EXISTS `page_view_stats_target_uniq` ON `page_view_stats` (`target_type`,`target_id`)",
];

async function tableExists(name: string) {
  const res = await client.execute({
    sql: "SELECT name FROM sqlite_master WHERE type='table' AND name=?;",
    args: [name],
  });
  return res.rows.length > 0;
}

if (await tableExists(TABLE)) {
  console.log(`ℹ️  ${TABLE} は既に存在します（インデックスのみ IF NOT EXISTS で確認します）。`);
}

if (apply) {
  for (const stmt of STATEMENTS) {
    await client.execute(stmt);
  }
  if (!(await tableExists(TABLE))) {
    console.error(`❌ ${TABLE} の作成に失敗しました。`);
    process.exit(1);
  }
  console.log("✅ 適用完了（page_view_stats + UNIQUE索引）。");
} else {
  console.log("実行予定のSQL:");
  for (const stmt of STATEMENTS) {
    console.log(`  ${stmt.replace(/\n\s*/g, " ")};`);
  }
  console.log("ℹ️  dry-run のため変更していません（--apply 付きで実行すると適用します）。");
}

process.exit(0);
