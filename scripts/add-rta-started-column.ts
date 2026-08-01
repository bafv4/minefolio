// users に rta_started_year_month 列（RTAを始めた年月）を追加する一回限りのスクリプト。
// db:push はローカルDBの既存ドリフト（api_cache のインデックス）で失敗するため、手動 DDL で適用する。
//
// 内容:
//   ALTER TABLE users ADD COLUMN rta_started_year_month text
//   （NULL 許容・デフォルトなし。"YYYY-MM" 形式の文字列。既存行は NULL のままで未回答扱い）
//
// 実行:
//   pnpm exec tsx scripts/add-rta-started-column.ts                   # ローカル（.env）に dry-run
//   pnpm exec tsx scripts/add-rta-started-column.ts --apply           # ローカルに適用
//   pnpm exec tsx scripts/add-rta-started-column.ts --remote          # リモート（.env.remote）に dry-run
//   pnpm exec tsx scripts/add-rta-started-column.ts --remote --apply  # リモートに適用
import { createClient } from "@libsql/client";
import { loadDbEnv } from "./lib/db-env";

const { url, authToken } = loadDbEnv();

const apply = process.argv.includes("--apply");
const client = createClient({ url, authToken });

console.log(`接続先: ${url}`);
console.log(`モード: ${apply ? "APPLY（実際に適用します）" : "DRY-RUN（表示のみ・変更なし）"}`);

const columns = await client.execute(`PRAGMA table_info(users);`);
const hasColumn = columns.rows.some((r) => String(r.name) === "rta_started_year_month");

if (hasColumn) {
  console.log("ℹ️  rta_started_year_month 列は既に存在します。何もしません。");
  process.exit(0);
}

console.log("rta_started_year_month 列（text・NULL 許容）を追加します。");

if (!apply) {
  console.log("ℹ️  dry-run のため変更していません（--apply 付きで実行すると適用します）。");
  process.exit(0);
}

await client.execute(`ALTER TABLE users ADD COLUMN rta_started_year_month text;`);

const verify = await client.execute(`PRAGMA table_info(users);`);
if (!verify.rows.some((r) => String(r.name) === "rta_started_year_month")) {
  console.error("❌ 追加後の確認で列が見つかりませんでした。");
  process.exit(1);
}

console.log("✅ 適用完了。");
process.exit(0);
