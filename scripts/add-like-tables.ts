// いいね用テーブル（guide_likes / search_craft_template_likes）を追加する一回限りのスクリプト。
//
// 背景: ガイドとサーチクラフトテンプレートの「いいね」を保持する結合テーブル。
// `pnpm db:generate` / `db:migrate` は drizzle の journal が現行スキーマから乖離しているため使えず
// （twitch_vod_cache が snapshot に無い）、`pnpm db:push` もローカルDBとのドリフト
// （api_cache の索引名不一致）で無関係な DDL まで巻き込んで失敗する。
// そのため必要な CREATE TABLE / INDEX のみを手動 DDL で適用する。
// DDL は `pnpm gen:test-schema`（drizzle-kit export）の出力と同一で、再実行に備えて
// IF NOT EXISTS のみ付け足している。
//
// 新規テーブルの追加のみで既存データは変更しない。
//
// 実行:
//   pnpm exec tsx scripts/add-like-tables.ts                   # ローカル（.env）に dry-run
//   pnpm exec tsx scripts/add-like-tables.ts --apply           # ローカルに適用
//   pnpm exec tsx scripts/add-like-tables.ts --remote          # リモート（.env.remote）に dry-run
//   pnpm exec tsx scripts/add-like-tables.ts --remote --apply  # リモートに適用（要ユーザー承認）
import { createClient } from "@libsql/client";
import { loadDbEnv } from "./lib/db-env";

const { url, authToken } = loadDbEnv();

const apply = process.argv.includes("--apply");
const client = createClient({ url, authToken });

console.log(`モード: ${apply ? "APPLY（実際に適用します）" : "DRY-RUN（表示のみ・変更なし）"}`);

const TABLES = ["guide_likes", "search_craft_template_likes"] as const;

const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS \`guide_likes\` (
	\`id\` text PRIMARY KEY NOT NULL,
	\`guide_id\` text NOT NULL,
	\`user_id\` text NOT NULL,
	\`created_at\` integer NOT NULL,
	FOREIGN KEY (\`guide_id\`) REFERENCES \`guides\`(\`id\`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (\`user_id\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE cascade
)`,
  "CREATE UNIQUE INDEX IF NOT EXISTS `guide_likes_guide_user_uniq` ON `guide_likes` (`guide_id`,`user_id`)",
  "CREATE INDEX IF NOT EXISTS `guide_likes_user_idx` ON `guide_likes` (`user_id`,`guide_id`)",
  `CREATE TABLE IF NOT EXISTS \`search_craft_template_likes\` (
	\`id\` text PRIMARY KEY NOT NULL,
	\`template_id\` text NOT NULL,
	\`user_id\` text NOT NULL,
	\`created_at\` integer NOT NULL,
	FOREIGN KEY (\`template_id\`) REFERENCES \`search_craft_templates\`(\`id\`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (\`user_id\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE cascade
)`,
  "CREATE UNIQUE INDEX IF NOT EXISTS `search_craft_template_likes_template_user_uniq` ON `search_craft_template_likes` (`template_id`,`user_id`)",
  "CREATE INDEX IF NOT EXISTS `search_craft_template_likes_user_idx` ON `search_craft_template_likes` (`user_id`,`template_id`)",
];

async function tableExists(name: string) {
  const res = await client.execute({
    sql: "SELECT name FROM sqlite_master WHERE type='table' AND name=?;",
    args: [name],
  });
  return res.rows.length > 0;
}

for (const table of TABLES) {
  if (await tableExists(table)) {
    console.log(`ℹ️  ${table} は既に存在します（インデックスのみ IF NOT EXISTS で確認します）。`);
  }
}

if (apply) {
  for (const stmt of STATEMENTS) {
    await client.execute(stmt);
  }
  for (const table of TABLES) {
    if (!(await tableExists(table))) {
      console.error(`❌ ${table} の作成に失敗しました。`);
      process.exit(1);
    }
  }
  console.log("✅ 適用完了（guide_likes / search_craft_template_likes + 各UNIQUE索引・索引）。");
} else {
  console.log("実行予定のSQL:");
  for (const stmt of STATEMENTS) {
    console.log(`  ${stmt.replace(/\n\s*/g, " ")};`);
  }
  console.log("ℹ️  dry-run のため変更していません（--apply 付きで実行すると適用します）。");
}

process.exit(0);
