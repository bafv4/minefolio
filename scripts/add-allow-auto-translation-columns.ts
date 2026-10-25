// users / guides に「自動翻訳を許可する」列（allow_auto_translation）を追加する一回限りのスクリプト。
// db:push はローカルDBの既存ドリフトで失敗する／falsy でない既定値付き NOT NULL 列の追加で
// テーブル再作成を提案することがあるため、手動 DDL で適用する。
//
// 内容:
//   ALTER TABLE users  ADD COLUMN allow_auto_translation integer DEFAULT true NOT NULL
//   ALTER TABLE guides ADD COLUMN allow_auto_translation integer DEFAULT true NOT NULL
//   （既存行は 1 = 許可 になる。drizzle-kit が出力する DDL と同じ表記）
//
// 実行:
//   pnpm exec tsx scripts/add-allow-auto-translation-columns.ts                   # ローカル（.env）に dry-run
//   pnpm exec tsx scripts/add-allow-auto-translation-columns.ts --apply           # ローカルに適用
//   pnpm exec tsx scripts/add-allow-auto-translation-columns.ts --remote          # リモート（.env.remote）に dry-run
//   pnpm exec tsx scripts/add-allow-auto-translation-columns.ts --remote --apply  # リモートに適用（要ユーザー承認）
import { createClient } from "@libsql/client";
import { loadDbEnv } from "./lib/db-env";

const { url, authToken } = loadDbEnv();

const apply = process.argv.includes("--apply");
const client = createClient({ url, authToken });

console.log(`接続先: ${url}`);
console.log(`モード: ${apply ? "APPLY（実際に適用します）" : "DRY-RUN（表示のみ・変更なし）"}`);

const COLUMNS: { table: string; name: string; ddl: string }[] = [
  {
    table: "users",
    name: "allow_auto_translation",
    ddl: "ALTER TABLE users ADD COLUMN allow_auto_translation integer DEFAULT true NOT NULL;",
  },
  {
    table: "guides",
    name: "allow_auto_translation",
    ddl: "ALTER TABLE guides ADD COLUMN allow_auto_translation integer DEFAULT true NOT NULL;",
  },
];

async function columnNames(table: string): Promise<Set<string>> {
  const info = await client.execute(`PRAGMA table_info(${table});`);
  return new Set(info.rows.map((r) => String(r.name)));
}

const pending: typeof COLUMNS = [];
for (const c of COLUMNS) {
  if ((await columnNames(c.table)).has(c.name)) {
    console.log(`ℹ️  ${c.table}.${c.name} は既に存在します。スキップします。`);
  } else {
    pending.push(c);
  }
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
  console.log(`✅ ${c.table}.${c.name} を追加しました。`);
}

const missing: string[] = [];
for (const c of COLUMNS) {
  if (!(await columnNames(c.table)).has(c.name)) missing.push(`${c.table}.${c.name}`);
}
if (missing.length > 0) {
  console.error(`❌ 追加後の確認で列が見つかりませんでした: ${missing.join(", ")}`);
  process.exit(1);
}

// 既存行が許可（1）になっていることの確認
for (const table of ["users", "guides"]) {
  const r = await client.execute(
    `SELECT count(*) AS total, sum(allow_auto_translation = 1) AS allowed FROM ${table};`,
  );
  console.log(`  ${table}: 全${r.rows[0].total}行中 許可=${r.rows[0].allowed ?? 0}行`);
}

console.log("✅ 適用完了。");
process.exit(0);
