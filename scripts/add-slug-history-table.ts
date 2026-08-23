// slug_history テーブル（旧slug→現ユーザーのリダイレクト解決用の履歴。set_mcid / remove_mcid で
// users.slug が変わるたびに旧slugを記録し、/player/:slug の404時に現slugへ302リダイレクトする）を
// 追加する一回限りのスクリプト。
//
// 背景: ローカルの `pnpm db:push` は drizzle-kit 0.31.10 の式インデックスバグ
// （idx_paceman_paces_mcid_lower が `no such column: lower("mcid")` で push を中断させる）のため
// 使えず、手動DDLで反映する（db-apply スキル / docs/database.md「運用ノート」参照）。
// 新規テーブル追加のみで既存データは一切変更しない。
//
// DDL は `pnpm gen:test-schema`（drizzle-kit export の出力 = app/lib/__tests__/helpers/test-schema.sql
// 539-549行）と完全一致させ、再実行に備えて IF NOT EXISTS を付与。
//
// 実行:
//   pnpm exec tsx scripts/add-slug-history-table.ts                   # ローカル(.env)に dry-run
//   pnpm exec tsx scripts/add-slug-history-table.ts --apply           # ローカルに適用
//   pnpm exec tsx scripts/add-slug-history-table.ts --remote          # リモート(.env.remote)に dry-run
//   pnpm exec tsx scripts/add-slug-history-table.ts --remote --apply  # リモートに適用（要ユーザー承認）
import { createClient } from "@libsql/client";
import { loadDbEnv } from "./lib/db-env";

const { url, authToken } = loadDbEnv();

const apply = process.argv.includes("--apply");
const client = createClient({ url, authToken });

console.log(`モード: ${apply ? "APPLY（実際に適用します）" : "DRY-RUN（表示のみ・変更なし）"}`);

const TABLE = "slug_history";

const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS \`slug_history\` (
	\`id\` text PRIMARY KEY NOT NULL,
	\`slug\` text NOT NULL,
	\`user_id\` text NOT NULL,
	\`created_at\` integer NOT NULL,
	\`updated_at\` integer NOT NULL,
	FOREIGN KEY (\`user_id\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE cascade
)`,
  "CREATE UNIQUE INDEX IF NOT EXISTS `slug_history_slug_uniq` ON `slug_history` (`slug`)",
  "CREATE INDEX IF NOT EXISTS `idx_slug_history_user_id` ON `slug_history` (`user_id`)",
];

async function tableExists(name: string) {
  const res = await client.execute({
    sql: "SELECT name FROM sqlite_master WHERE type='table' AND name=?;",
    args: [name],
  });
  return res.rows.length > 0;
}

async function indexNames(table: string) {
  const res = await client.execute({
    sql: "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name=?;",
    args: [table],
  });
  return res.rows.map((r) => String(r.name));
}

const alreadyExists = await tableExists(TABLE);
if (alreadyExists) {
  console.log(`ℹ️  ${TABLE} は既に存在します（索引: ${(await indexNames(TABLE)).join(", ") || "なし"}）。`);
  console.log("    IF NOT EXISTS のため再実行しても変更はありません。");
} else {
  console.log(`${TABLE} テーブルと索引2件を作成します。`);
}

if (apply) {
  for (const statement of STATEMENTS) {
    await client.execute(statement);
  }
  if (!(await tableExists(TABLE))) {
    console.error(`❌ ${TABLE} の作成に失敗しました。`);
    process.exit(1);
  }
  console.log(`✅ 適用完了（${TABLE} テーブル + 索引: ${(await indexNames(TABLE)).join(", ")}）。`);
} else {
  console.log("実行予定のSQL:");
  for (const statement of STATEMENTS) {
    console.log(`  ${statement.replace(/\n\s*/g, " ")};`);
  }
  console.log("ℹ️  dry-run のため変更していません（--apply 付きで実行すると適用します）。");
}

process.exit(0);
