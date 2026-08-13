// サーチクラフトの繋ぎ方（Loop）機能の DB 基盤を追加する一回限りのスクリプト。
//
// 内容:
//   1. 新テーブル search_craft_loops（+ ユニーク索引 idx_search_craft_loops_user_sequence）
//   2. config_presets に search_craft_loops_data 列（nullable, JSON スナップショット）
//   3. search_craft_templates に loops_data 列（nullable, JSON）
//
// なぜ db:push でなく手動DDLか:
//   pnpm db:push は local.db の既存の索引命名ドリフト（api_cache 等の inline `.unique()` が
//   SQLite の自動索引 sqlite_autoindex_* になっており、drizzle-kit が期待する named index
//   `api_cache_cache_key_unique` 等と一致しない）により、本タスクと無関係な DDL まで
//   巻き込んで `no such index` エラーで中断する。そのため必要な DDL のみを手動で適用する
//   （add-page-view-stats-table.ts と同じ方式）。
//
// DDL は `pnpm gen:test-schema`（drizzle-kit export）の出力
// （app/lib/__tests__/helpers/test-schema.sql）の該当定義と同一で、再実行に備えて
// CREATE TABLE / INDEX には IF NOT EXISTS を付与。ALTER TABLE ADD COLUMN は
// IF NOT EXISTS が使えないため PRAGMA table_info で存在確認してから実行する。
//
// 新規テーブル追加 + nullable 列追加のみで既存データは変更しない。
//
// 実行:
//   pnpm exec tsx scripts/add-search-craft-loops.ts                   # ローカル（.env）に dry-run
//   pnpm exec tsx scripts/add-search-craft-loops.ts --apply           # ローカルに適用
//   pnpm exec tsx scripts/add-search-craft-loops.ts --remote          # リモート（.env.remote）に dry-run
//   pnpm exec tsx scripts/add-search-craft-loops.ts --remote --apply  # リモートに適用（要ユーザー承認）
import { createClient } from "@libsql/client";
import { loadDbEnv } from "./lib/db-env";

const { url, authToken } = loadDbEnv();

const apply = process.argv.includes("--apply");
const client = createClient({ url, authToken });

console.log(`モード: ${apply ? "APPLY（実際に適用します）" : "DRY-RUN（表示のみ・変更なし）"}`);

const TABLE = "search_craft_loops";

const TABLE_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS \`search_craft_loops\` (
	\`id\` text PRIMARY KEY NOT NULL,
	\`user_id\` text NOT NULL,
	\`sequence\` integer NOT NULL,
	\`steps\` text NOT NULL,
	\`comment\` text,
	\`timing\` text,
	\`created_at\` integer NOT NULL,
	\`updated_at\` integer NOT NULL,
	FOREIGN KEY (\`user_id\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE cascade
)`,
  "CREATE UNIQUE INDEX IF NOT EXISTS `idx_search_craft_loops_user_sequence` ON `search_craft_loops` (`user_id`,`sequence`)",
];

interface ColumnAddition {
  table: string;
  column: string;
  ddl: string;
}

const COLUMN_ADDITIONS: ColumnAddition[] = [
  {
    table: "config_presets",
    column: "search_craft_loops_data",
    ddl: "ALTER TABLE `config_presets` ADD COLUMN `search_craft_loops_data` text",
  },
  {
    table: "search_craft_templates",
    column: "loops_data",
    ddl: "ALTER TABLE `search_craft_templates` ADD COLUMN `loops_data` text",
  },
];

async function tableExists(name: string) {
  const res = await client.execute({
    sql: "SELECT name FROM sqlite_master WHERE type='table' AND name=?;",
    args: [name],
  });
  return res.rows.length > 0;
}

async function columnExists(table: string, column: string) {
  const res = await client.execute(`PRAGMA table_info(\`${table}\`);`);
  return res.rows.some((r) => String(r.name) === column);
}

// --- 1. search_craft_loops テーブル ---
const tableAlreadyExists = await tableExists(TABLE);
if (tableAlreadyExists) {
  console.log(`ℹ️  ${TABLE} は既に存在します（索引のみ IF NOT EXISTS で確認します）。`);
} else {
  console.log(`${TABLE} を作成します。`);
}

// --- 2. nullable 列2件 ---
const pendingColumns: ColumnAddition[] = [];
for (const addition of COLUMN_ADDITIONS) {
  if (await columnExists(addition.table, addition.column)) {
    console.log(`ℹ️  ${addition.table}.${addition.column} は既に存在します。`);
  } else {
    console.log(`${addition.table}.${addition.column} を追加します。`);
    pendingColumns.push(addition);
  }
}

if (apply) {
  for (const stmt of TABLE_STATEMENTS) {
    await client.execute(stmt);
  }
  for (const addition of pendingColumns) {
    await client.execute(addition.ddl);
  }

  if (!(await tableExists(TABLE))) {
    console.error(`❌ ${TABLE} の作成に失敗しました。`);
    process.exit(1);
  }
  for (const addition of COLUMN_ADDITIONS) {
    if (!(await columnExists(addition.table, addition.column))) {
      console.error(`❌ ${addition.table}.${addition.column} の追加に失敗しました。`);
      process.exit(1);
    }
  }

  const indexes = await client.execute(
    "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='search_craft_loops';",
  );
  const hasIndex = indexes.rows.some(
    (r) => String(r.name) === "idx_search_craft_loops_user_sequence",
  );
  if (!hasIndex) {
    console.error("❌ idx_search_craft_loops_user_sequence の作成に失敗しました。");
    process.exit(1);
  }

  console.log(
    "✅ 適用完了（search_craft_loops テーブル + 索引 / config_presets・search_craft_templates の nullable 列）。",
  );
} else {
  console.log("実行予定のSQL:");
  if (!tableAlreadyExists) {
    for (const stmt of TABLE_STATEMENTS) {
      console.log(`  ${stmt.replace(/\n\s*/g, " ")};`);
    }
  }
  for (const addition of pendingColumns) {
    console.log(`  ${addition.ddl};`);
  }
  if (tableAlreadyExists && pendingColumns.length === 0) {
    console.log("  （新規に実行するDDLはありません。全て適用済みです）");
  }
  console.log("ℹ️  dry-run のため変更していません（--apply 付きで実行すると適用します）。");
}

process.exit(0);
