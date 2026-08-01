// プロフィール絵文字リアクション用テーブル（profile_reactions）を追加する一回限りのスクリプト。
//
// 背景: add-like-tables.ts と同じ理由（drizzle の journal が現行スキーマから乖離しているため
// `pnpm db:generate` / `db:migrate` が使えず、`pnpm db:push` もローカルDBとのドリフトで
// 無関係な DDL まで巻き込んで失敗する）で、必要な CREATE TABLE / INDEX のみを手動 DDL で適用する。
// DDL は `pnpm gen:test-schema`（drizzle-kit export）の出力と同一で、再実行に備えて
// IF NOT EXISTS のみ付け足している。
//
// 新規テーブルの追加のみで既存データは変更しない。
//
// 実行:
//   pnpm exec tsx scripts/add-profile-reactions-table.ts                   # ローカル（.env）に dry-run
//   pnpm exec tsx scripts/add-profile-reactions-table.ts --apply           # ローカルに適用
//   pnpm exec tsx scripts/add-profile-reactions-table.ts --remote          # リモート（.env.remote）に dry-run
//   pnpm exec tsx scripts/add-profile-reactions-table.ts --remote --apply  # リモートに適用（要ユーザー承認）
import { createClient } from "@libsql/client";
import { loadDbEnv } from "./lib/db-env";

const { url, authToken } = loadDbEnv();

const apply = process.argv.includes("--apply");
const client = createClient({ url, authToken });

console.log(`モード: ${apply ? "APPLY（実際に適用します）" : "DRY-RUN（表示のみ・変更なし）"}`);

const TABLES = ["profile_reactions"] as const;

const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS \`profile_reactions\` (
	\`id\` text PRIMARY KEY NOT NULL,
	\`profile_user_id\` text NOT NULL,
	\`reactor_user_id\` text NOT NULL,
	\`emoji\` text NOT NULL,
	\`created_at\` integer NOT NULL,
	FOREIGN KEY (\`profile_user_id\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (\`reactor_user_id\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE cascade
)`,
  "CREATE UNIQUE INDEX IF NOT EXISTS `profile_reactions_profile_emoji_reactor_uniq` ON `profile_reactions` (`profile_user_id`,`emoji`,`reactor_user_id`)",
  "CREATE INDEX IF NOT EXISTS `profile_reactions_reactor_idx` ON `profile_reactions` (`reactor_user_id`,`profile_user_id`,`emoji`)",
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
  console.log("✅ 適用完了（profile_reactions + UNIQUE索引・索引）。");
} else {
  console.log("実行予定のSQL:");
  for (const stmt of STATEMENTS) {
    console.log(`  ${stmt.replace(/\n\s*/g, " ")};`);
  }
  console.log("ℹ️  dry-run のため変更していません（--apply 付きで実行すると適用します）。");
}

process.exit(0);
