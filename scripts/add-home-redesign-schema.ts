// ホーム改修用のスキーマ追加の一回限りのスクリプト。
//
// 内容:
//   1. ranked_elo_snapshots テーブル（Ranked レートの日次スナップショット）＋索引2件
//   2. twitch_vod_cache.game_name 列（nullable、既存行は null のまま）
//
// 背景: `pnpm db:push` はローカルDBの式インデックス/索引名ドリフトで失敗することがあるため、
// 必要な DDL のみを手動で適用する。DDL は `pnpm gen:test-schema`（drizzle-kit export）の出力と同一。
// 既存データは変更しない（テーブル新設と nullable 列の追加のみ）。
//
// 実行:
//   pnpm exec tsx scripts/add-home-redesign-schema.ts                   # ローカル（.env）に dry-run
//   pnpm exec tsx scripts/add-home-redesign-schema.ts --apply           # ローカルに適用
//   pnpm exec tsx scripts/add-home-redesign-schema.ts --remote          # リモート（.env.remote）に dry-run
//   pnpm exec tsx scripts/add-home-redesign-schema.ts --remote --apply  # リモートに適用（要ユーザー承認）
import { createClient } from "@libsql/client";
import { loadDbEnv } from "./lib/db-env";

const { url, authToken } = loadDbEnv();

const apply = process.argv.includes("--apply");
const client = createClient({ url, authToken });

console.log(`モード: ${apply ? "APPLY（実際に適用します）" : "DRY-RUN（表示のみ・変更なし）"}`);

const TABLE_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS \`ranked_elo_snapshots\` (
	\`id\` text PRIMARY KEY NOT NULL,
	\`user_id\` text NOT NULL,
	\`snapshot_date\` text NOT NULL,
	\`elo_rate\` integer NOT NULL,
	\`created_at\` integer NOT NULL,
	\`updated_at\` integer NOT NULL,
	FOREIGN KEY (\`user_id\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE cascade
)`,
  "CREATE UNIQUE INDEX IF NOT EXISTS `ranked_elo_snapshots_user_date_uniq` ON `ranked_elo_snapshots` (`user_id`,`snapshot_date`)",
  "CREATE INDEX IF NOT EXISTS `idx_ranked_elo_snapshots_date` ON `ranked_elo_snapshots` (`snapshot_date`)",
];
const ADD_COLUMN = "ALTER TABLE `twitch_vod_cache` ADD `game_name` text";

async function tableExists(name: string) {
  const res = await client.execute({
    sql: "SELECT name FROM sqlite_master WHERE type='table' AND name=?;",
    args: [name],
  });
  return res.rows.length > 0;
}

async function columnExists(table: string, column: string) {
  const res = await client.execute(`PRAGMA table_info(\`${table}\`)`);
  return res.rows.some((r) => r.name === column);
}

const vodTable = await tableExists("twitch_vod_cache");
if (!vodTable) {
  console.error("❌ twitch_vod_cache が存在しません（先に add-twitch-vod-cache.ts を適用してください）。");
  process.exit(1);
}
const hasColumn = await columnExists("twitch_vod_cache", "game_name");
const hasTable = await tableExists("ranked_elo_snapshots");

if (hasTable) console.log("ℹ️  ranked_elo_snapshots は既に存在します（索引のみ IF NOT EXISTS で確認します）。");
if (hasColumn) console.log("ℹ️  twitch_vod_cache.game_name は既に存在します（スキップ）。");

const statements = [...TABLE_STATEMENTS, ...(hasColumn ? [] : [ADD_COLUMN])];

if (apply) {
  for (const stmt of statements) {
    await client.execute(stmt);
  }
  if (!(await tableExists("ranked_elo_snapshots")) || !(await columnExists("twitch_vod_cache", "game_name"))) {
    console.error("❌ 適用の確認に失敗しました。");
    process.exit(1);
  }
  console.log("✅ 適用完了（ranked_elo_snapshots + 索引2件、twitch_vod_cache.game_name）。");
} else {
  console.log("実行予定のSQL:");
  for (const stmt of statements) {
    console.log(`  ${stmt.replace(/\n\s*/g, " ")};`);
  }
  console.log("ℹ️  dry-run のため変更していません（--apply 付きで実行すると適用します）。");
}

process.exit(0);
