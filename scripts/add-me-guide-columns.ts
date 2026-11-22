// users.me_tour_completed_at / users.me_checklist_dismissed_at 列（/me の初回ツアーを終えた日時・
// 「はじめに」チェックリストを閉じた日時。いずれも timestamp、nullable）追加の一回限りのスクリプト。
//
// 背景: `pnpm db:push` はローカルDBの式インデックス/索引名ドリフトで失敗することがあるため、
// 必要な DDL のみを手動で適用する。既存データは変更しない（nullable 列の追加のみ、既存行は null）。
//
// 実行:
//   pnpm exec tsx scripts/add-me-guide-columns.ts                   # ローカル（.env）に dry-run
//   pnpm exec tsx scripts/add-me-guide-columns.ts --apply           # ローカルに適用
//   pnpm exec tsx scripts/add-me-guide-columns.ts --remote          # リモート（.env.remote）に dry-run
//   pnpm exec tsx scripts/add-me-guide-columns.ts --remote --apply  # リモートに適用（要ユーザー承認）
import { createClient } from "@libsql/client";
import { loadDbEnv } from "./lib/db-env";

const { url, authToken } = loadDbEnv();

const apply = process.argv.includes("--apply");
const client = createClient({ url, authToken });

console.log(`モード: ${apply ? "APPLY（実際に適用します）" : "DRY-RUN（表示のみ・変更なし）"}`);

const COLUMNS = ["me_tour_completed_at", "me_checklist_dismissed_at"] as const;

async function columnExists(table: string, column: string) {
  const res = await client.execute(`PRAGMA table_info(\`${table}\`)`);
  return res.rows.some((r) => r.name === column);
}

for (const column of COLUMNS) {
  const ddl = `ALTER TABLE \`users\` ADD \`${column}\` integer`;
  if (await columnExists("users", column)) {
    console.log(`ℹ️  users.${column} は既に存在します（スキップ）。`);
    continue;
  }
  if (apply) {
    await client.execute(ddl);
    if (!(await columnExists("users", column))) {
      console.error(`❌ 適用の確認に失敗しました（${column}）。`);
      process.exit(1);
    }
    console.log(`✅ 適用完了（users.${column}）。`);
  } else {
    console.log("実行予定のSQL:");
    console.log(`  ${ddl};`);
  }
}
if (!apply) console.log("ℹ️  dry-run のため変更していません（--apply 付きで実行すると適用します）。");

process.exit(0);
