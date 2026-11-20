// users に age_group / age_group_public 列（プロフィールの年代）を追加する一回限りのスクリプト。
//
// 背景: age_group_public は falsy 既定（false）の NOT NULL 列で、drizzle-kit push は
// 「デフォルト無し」と誤認して TRUNCATE（データ損失）を提案するため、手動 DDL で追加する
// （.claude/skills/db-apply/SKILL.md 参照）。既存行は DEFAULT により age_group = NULL（未設定）・
// age_group_public = 0（非公開）になる。
//
// DDL は `pnpm gen:test-schema`（drizzle-kit export）の出力と一致させ、再実行に備えて
// 列ごとに PRAGMA table_info で存在チェックする。
//
// 実行:
//   pnpm exec tsx scripts/add-age-group-columns.ts                   # ローカル（.env）に dry-run
//   pnpm exec tsx scripts/add-age-group-columns.ts --apply           # ローカルに適用
//   pnpm exec tsx scripts/add-age-group-columns.ts --remote          # リモート（.env.remote）に dry-run
//   pnpm exec tsx scripts/add-age-group-columns.ts --remote --apply  # リモートに適用（要ユーザー承認）
import { createClient } from "@libsql/client";
import { loadDbEnv } from "./lib/db-env";

const { url, authToken } = loadDbEnv();

const apply = process.argv.includes("--apply");
const client = createClient({ url, authToken });

console.log(`モード: ${apply ? "APPLY（実際に適用します）" : "DRY-RUN（表示のみ・変更なし）"}`);

const TABLE = "users";
const COLUMNS = [
  { name: "age_group", statement: "ALTER TABLE `users` ADD `age_group` text;" },
  { name: "age_group_public", statement: "ALTER TABLE `users` ADD `age_group_public` integer DEFAULT false NOT NULL;" },
];

async function existingColumns() {
  const info = await client.execute(`PRAGMA table_info(${TABLE});`);
  return new Set(info.rows.map((r) => String(r.name)));
}

const before = await existingColumns();
const todo = COLUMNS.filter((c) => !before.has(c.name));

for (const c of COLUMNS) {
  if (before.has(c.name)) console.log(`ℹ️  ${TABLE}.${c.name} は既に存在します。スキップします。`);
}

if (todo.length === 0) {
  console.log("変更はありません。");
} else if (apply) {
  for (const c of todo) {
    await client.execute(c.statement);
  }
  const after = await existingColumns();
  const missing = todo.filter((c) => !after.has(c.name));
  if (missing.length > 0) {
    console.error(`❌ 追加に失敗した列: ${missing.map((c) => c.name).join(", ")}`);
    process.exit(1);
  }
  console.log(`✅ 適用完了（${todo.map((c) => `${TABLE}.${c.name}`).join(", ")} を追加）。`);
} else {
  const count = await client.execute(`SELECT COUNT(*) AS n FROM ${TABLE};`);
  console.log("実行予定のSQL:");
  for (const c of todo) console.log(`  ${c.statement}`);
  console.log(`ℹ️  既存 ${count.rows[0]?.n ?? 0} 行は age_group = NULL（未設定）・age_group_public = 0（非公開）になります。`);
  console.log("ℹ️  dry-run のため変更していません（--apply 付きで実行すると適用します）。");
}

process.exit(0);
