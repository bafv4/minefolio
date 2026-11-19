// search_craft_templates に下書き用の列（draft_*）と published_at を追加する一回限りのスクリプト。
// 全列 NULL 可。is_published の default(true) は変えない（変えるとテーブル再作成になる）。
//
// 内容:
//   ALTER TABLE search_craft_templates ADD COLUMN draft_title text / draft_description text /
//     draft_game_language text / draft_crafts_data text / draft_remaps_data text /
//     draft_loops_data text / draft_updated_at integer / published_at integer
//   バックフィル: UPDATE search_craft_templates SET published_at = created_at
//     WHERE is_published = 1 AND published_at IS NULL  （非公開の行は NULL のまま）
//
// 実行:
//   pnpm exec tsx scripts/add-search-craft-template-draft-columns.ts                   # ローカル（.env）に dry-run
//   pnpm exec tsx scripts/add-search-craft-template-draft-columns.ts --apply           # ローカルに適用
//   pnpm exec tsx scripts/add-search-craft-template-draft-columns.ts --remote          # リモート（.env.remote）に dry-run
//   pnpm exec tsx scripts/add-search-craft-template-draft-columns.ts --remote --apply  # リモートに適用（要ユーザー承認）
import { createClient } from "@libsql/client";
import { loadDbEnv } from "./lib/db-env";

const { url, authToken } = loadDbEnv();

const apply = process.argv.includes("--apply");
const client = createClient({ url, authToken });

console.log(`接続先: ${url}`);
console.log(`モード: ${apply ? "APPLY（実際に適用します）" : "DRY-RUN（表示のみ・変更なし）"}`);

const TABLE = "search_craft_templates";
const COLUMNS: { name: string; type: string }[] = [
  { name: "draft_title", type: "text" },
  { name: "draft_description", type: "text" },
  { name: "draft_game_language", type: "text" },
  { name: "draft_crafts_data", type: "text" },
  { name: "draft_remaps_data", type: "text" },
  { name: "draft_loops_data", type: "text" },
  { name: "draft_updated_at", type: "integer" },
  { name: "published_at", type: "integer" },
];

async function columnNames(): Promise<Set<string>> {
  const info = await client.execute(`PRAGMA table_info(${TABLE});`);
  return new Set(info.rows.map((r) => String(r.name)));
}

const existing = await columnNames();
const pending = COLUMNS.filter((c) => {
  if (existing.has(c.name)) {
    console.log(`ℹ️  ${TABLE}.${c.name} は既に存在します。スキップします。`);
    return false;
  }
  return true;
});
for (const c of pending) {
  console.log(`追加予定: ALTER TABLE ${TABLE} ADD COLUMN ${c.name} ${c.type};`);
}

// バックフィル対象（published_at 列が未追加なら、公開中の行すべてが対象になる）
const BACKFILL_SQL = `UPDATE ${TABLE} SET published_at = created_at WHERE is_published = 1 AND published_at IS NULL;`;
const hasPublishedAt = existing.has("published_at");
const countRes = await client.execute(
  hasPublishedAt
    ? `SELECT count(*) AS n FROM ${TABLE} WHERE is_published = 1 AND published_at IS NULL;`
    : `SELECT count(*) AS n FROM ${TABLE} WHERE is_published = 1;`,
);
const backfillCount = Number(countRes.rows[0].n);
console.log(`バックフィル対象（公開中で published_at 未設定）: ${backfillCount}行`);
if (backfillCount > 0) console.log(`実行予定: ${BACKFILL_SQL}`);

if (pending.length === 0 && backfillCount === 0) {
  console.log("ℹ️  適用済みです。何もしません。");
  process.exit(0);
}

if (!apply) {
  console.log("ℹ️  dry-run のため変更していません（--apply 付きで実行すると適用します）。");
  process.exit(0);
}

for (const c of pending) {
  await client.execute(`ALTER TABLE ${TABLE} ADD COLUMN ${c.name} ${c.type};`);
  console.log(`✅ ${TABLE}.${c.name} を追加しました。`);
}

const after = await columnNames();
const missing = COLUMNS.filter((c) => !after.has(c.name)).map((c) => c.name);
if (missing.length > 0) {
  console.error(`❌ 追加後の確認で列が見つかりませんでした: ${missing.join(", ")}`);
  process.exit(1);
}

const res = await client.execute(BACKFILL_SQL);
console.log(`✅ published_at をバックフィルしました（${res.rowsAffected}行）。`);

const check = await client.execute(
  `SELECT count(*) AS total, sum(is_published = 1) AS pub, sum(published_at IS NOT NULL) AS withPub FROM ${TABLE};`,
);
console.log(
  `  全${check.rows[0].total}行 / 公開=${check.rows[0].pub ?? 0}行 / published_at あり=${check.rows[0].withPub ?? 0}行`,
);

console.log("✅ 適用完了。");
process.exit(0);
