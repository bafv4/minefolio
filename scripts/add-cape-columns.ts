// users にマント関連の3列を追加する一回限りのスクリプト。
// db:push はローカルDBの既存ドリフトで失敗する／falsy でない既定値付き NOT NULL 列の追加で
// テーブル再作成を提案することがあるため、手動 DDL で適用する。
//
// 内容:
//   ALTER TABLE users ADD COLUMN custom_cape_url text
//   ALTER TABLE users ADD COLUMN custom_cape_updated_at integer
//   ALTER TABLE users ADD COLUMN cape_display text DEFAULT 'cape' NOT NULL
//   （既存行は cape_display = 'cape' になる。他2列は NULL のまま）
//
// 実行:
//   pnpm exec tsx scripts/add-cape-columns.ts                   # ローカル（.env）に dry-run
//   pnpm exec tsx scripts/add-cape-columns.ts --apply           # ローカルに適用
//   pnpm exec tsx scripts/add-cape-columns.ts --remote          # リモート（.env.remote）に dry-run
//   pnpm exec tsx scripts/add-cape-columns.ts --remote --apply  # リモートに適用（要ユーザー承認）
import { createClient } from "@libsql/client";
import { loadDbEnv } from "./lib/db-env";

const { url, authToken } = loadDbEnv();

const apply = process.argv.includes("--apply");
const client = createClient({ url, authToken });

console.log(`接続先: ${url}`);
console.log(`モード: ${apply ? "APPLY（実際に適用します）" : "DRY-RUN（表示のみ・変更なし）"}`);

const COLUMNS: { name: string; ddl: string }[] = [
  { name: "custom_cape_url", ddl: "ALTER TABLE users ADD COLUMN custom_cape_url text;" },
  { name: "custom_cape_updated_at", ddl: "ALTER TABLE users ADD COLUMN custom_cape_updated_at integer;" },
  { name: "cape_display", ddl: "ALTER TABLE users ADD COLUMN cape_display text DEFAULT 'cape' NOT NULL;" },
];

const existing = await client.execute(`PRAGMA table_info(users);`);
const existingNames = new Set(existing.rows.map((r) => String(r.name)));

const pending = COLUMNS.filter((c) => !existingNames.has(c.name));
for (const c of COLUMNS) {
  if (existingNames.has(c.name)) console.log(`ℹ️  ${c.name} 列は既に存在します。スキップします。`);
}

if (pending.length === 0) {
  console.log("ℹ️  追加すべき列はありません。何もしません。");
  process.exit(0);
}

for (const c of pending) console.log(`追加予定: ${c.ddl}`);

if (!apply) {
  console.log("ℹ️  dry-run のため変更していません（--apply 付きで実行すると適用します）。");
  process.exit(0);
}

for (const c of pending) {
  await client.execute(c.ddl);
  console.log(`✅ ${c.name} を追加しました。`);
}

const verify = await client.execute(`PRAGMA table_info(users);`);
const verifyNames = new Set(verify.rows.map((r) => String(r.name)));
const missing = COLUMNS.filter((c) => !verifyNames.has(c.name));
if (missing.length > 0) {
  console.error(`❌ 追加後の確認で列が見つかりませんでした: ${missing.map((c) => c.name).join(", ")}`);
  process.exit(1);
}

console.log("✅ 適用完了。");
process.exit(0);
