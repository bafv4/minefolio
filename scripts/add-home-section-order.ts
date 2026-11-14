// users.home_section_order 列（ホームの欄の並び順。欄 ID の JSON 配列、nullable）追加の一回限りのスクリプト。
//
// 背景: `pnpm db:push` はローカルDBの式インデックス/索引名ドリフトで失敗することがあるため、
// 必要な DDL のみを手動で適用する。既存データは変更しない（nullable 列の追加のみ、既存行は null）。
//
// 実行:
//   pnpm exec tsx scripts/add-home-section-order.ts                   # ローカル（.env）に dry-run
//   pnpm exec tsx scripts/add-home-section-order.ts --apply           # ローカルに適用
//   pnpm exec tsx scripts/add-home-section-order.ts --remote          # リモート（.env.remote）に dry-run
//   pnpm exec tsx scripts/add-home-section-order.ts --remote --apply  # リモートに適用（要ユーザー承認）
import { createClient } from "@libsql/client";
import { loadDbEnv } from "./lib/db-env";

const { url, authToken } = loadDbEnv();

const apply = process.argv.includes("--apply");
const client = createClient({ url, authToken });

console.log(`モード: ${apply ? "APPLY（実際に適用します）" : "DRY-RUN（表示のみ・変更なし）"}`);

const ADD_COLUMN = "ALTER TABLE `users` ADD `home_section_order` text";

async function columnExists(table: string, column: string) {
  const res = await client.execute(`PRAGMA table_info(\`${table}\`)`);
  return res.rows.some((r) => r.name === column);
}

if (await columnExists("users", "home_section_order")) {
  console.log("ℹ️  users.home_section_order は既に存在します（スキップ）。");
  process.exit(0);
}

if (apply) {
  await client.execute(ADD_COLUMN);
  if (!(await columnExists("users", "home_section_order"))) {
    console.error("❌ 適用の確認に失敗しました。");
    process.exit(1);
  }
  console.log("✅ 適用完了（users.home_section_order）。");
} else {
  console.log("実行予定のSQL:");
  console.log(`  ${ADD_COLUMN};`);
  console.log("ℹ️  dry-run のため変更していません（--apply 付きで実行すると適用します）。");
}

process.exit(0);
