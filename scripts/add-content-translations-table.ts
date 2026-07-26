// content_translations テーブル（利用者コンテンツの自動翻訳キャッシュ）を追加する
// 一回限りのスクリプト。仕様は docs/translation.md。
//
// db:push はローカルDBの既存ドリフト（api_cache のインデックス）で失敗するため、手動 DDL で適用する。
//
// 内容:
//   1. CREATE TABLE content_translations
//   2. UNIQUE INDEX (target_type, target_id, locale)  … 対象×ロケールで1行
//   3. INDEX (status, updated_at)                     … Cron が pending / failed を拾う
//   すべて IF NOT EXISTS なので再実行しても安全。
//
// 実行:
//   pnpm exec tsx scripts/add-content-translations-table.ts                   # ローカル（.env）に dry-run
//   pnpm exec tsx scripts/add-content-translations-table.ts --apply           # ローカルに適用
//   pnpm exec tsx scripts/add-content-translations-table.ts --remote          # リモート（.env.remote）に dry-run
//   pnpm exec tsx scripts/add-content-translations-table.ts --remote --apply  # リモートに適用
import { createClient } from "@libsql/client";
import { loadDbEnv } from "./lib/db-env";

const { url, authToken } = loadDbEnv();

const apply = process.argv.includes("--apply");
const client = createClient({ url, authToken });

// app/lib/schema.ts の contentTranslations と一致させること
// （drizzle-kit export の出力＝app/lib/__tests__/helpers/test-schema.sql が正）
const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS content_translations (
    id text PRIMARY KEY NOT NULL,
    target_type text NOT NULL,
    target_id text NOT NULL,
    locale text NOT NULL,
    source_hash text NOT NULL,
    glossary_version integer NOT NULL,
    title text,
    summary text,
    content text,
    status text DEFAULT 'pending' NOT NULL,
    engine text,
    model text,
    error text,
    created_at integer NOT NULL,
    updated_at integer NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS content_translations_target_locale_uniq
    ON content_translations (target_type, target_id, locale)`,
  `CREATE INDEX IF NOT EXISTS content_translations_status_idx
    ON content_translations (status, updated_at)`,
];

console.log(`接続先: ${url}`);
console.log(`モード: ${apply ? "APPLY（実際に適用します）" : "DRY-RUN（表示のみ・変更なし）"}`);

const existing = await client.execute(
  `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'content_translations'`,
);

if (existing.rows.length > 0) {
  console.log("ℹ️  content_translations テーブルは既に存在します。索引のみ確認します。");
} else {
  console.log("content_translations テーブルを作成します。");
}

if (!apply) {
  for (const stmt of STATEMENTS) {
    console.log(`\n--- 実行予定 ---\n${stmt.trim()}`);
  }
  console.log("\nℹ️  dry-run のため変更していません（--apply 付きで実行すると適用します）。");
  process.exit(0);
}

for (const stmt of STATEMENTS) {
  await client.execute(stmt);
}

const verify = await client.execute(
  `SELECT name FROM sqlite_master
   WHERE name IN ('content_translations',
                  'content_translations_target_locale_uniq',
                  'content_translations_status_idx')`,
);
const found = verify.rows.map((r) => String(r.name)).sort();
if (found.length !== 3) {
  console.error(`❌ 作成後の確認に失敗しました（見つかったのは ${found.join(", ") || "なし"}）。`);
  process.exit(1);
}

console.log(`✅ 適用完了（${found.join(" / ")}）。`);
process.exit(0);
