// paceman_paces に lower(mcid) の式インデックスを追加する一回限りのスクリプト。
//
// 背景: app/lib/paceman-cache.ts の getRunTimeline / getNetherEnterCount / getMainPaces /
// getRecentPacesForPlayer は sql`lower(${pacemanPaces.mcid}) = ...` で検索しているため、
// 既存の idx_paceman_paces_mcid（素の列インデックス）は使われずテーブルフルスキャンになっている。
// drizzle-kit push は式インデックスの差分検出に対応していないため、手動 DDL で適用する。
//
// 内容:
//   CREATE INDEX IF NOT EXISTS idx_paceman_paces_mcid_lower ON paceman_paces (lower(mcid));
//
// インデックス追加のみでクエリ意味論・既存データは変更しない。
//
// 実行:
//   pnpm exec tsx scripts/add-paceman-mcid-lower-index.ts                   # ローカル（.env）に dry-run
//   pnpm exec tsx scripts/add-paceman-mcid-lower-index.ts --apply           # ローカルに適用
//   pnpm exec tsx scripts/add-paceman-mcid-lower-index.ts --remote          # リモート（.env.remote）に dry-run
//   pnpm exec tsx scripts/add-paceman-mcid-lower-index.ts --remote --apply  # リモートに適用（要ユーザー承認）
import { createClient } from "@libsql/client";
import { loadDbEnv } from "./lib/db-env";

const { url, authToken } = loadDbEnv();

const apply = process.argv.includes("--apply");
const client = createClient({ url, authToken });

console.log(`モード: ${apply ? "APPLY（実際に適用します）" : "DRY-RUN（表示のみ・変更なし）"}`);

async function indexExists(name: string) {
  const res = await client.execute({
    sql: "SELECT name FROM sqlite_master WHERE type='index' AND name=?;",
    args: [name],
  });
  return res.rows.length > 0;
}

async function explainLowerMcidSearch() {
  const plan = await client.execute(
    `EXPLAIN QUERY PLAN SELECT count(*) FROM paceman_paces WHERE lower(mcid) = 'test';`,
  );
  for (const row of plan.rows) {
    console.log(`  ${row.detail}`);
  }
}

const already = await indexExists("idx_paceman_paces_mcid_lower");

if (already) {
  console.log("ℹ️  idx_paceman_paces_mcid_lower は既に存在します。");
} else if (apply) {
  console.log("idx_paceman_paces_mcid_lower を作成します。");
  console.log("適用前のクエリプラン:");
  await explainLowerMcidSearch();
  await client.execute(
    `CREATE INDEX IF NOT EXISTS idx_paceman_paces_mcid_lower ON paceman_paces (lower(mcid));`,
  );
} else {
  console.log("実行予定のSQL:");
  console.log("  CREATE INDEX IF NOT EXISTS idx_paceman_paces_mcid_lower ON paceman_paces (lower(mcid));");
  console.log("現在のクエリプラン（SCAN の場合、インデックス未適用でフルスキャンしている）:");
  await explainLowerMcidSearch();
  console.log("ℹ️  dry-run のため変更していません（--apply 付きで実行すると適用します）。");
}

if (apply) {
  const created = await indexExists("idx_paceman_paces_mcid_lower");
  if (!created) {
    console.error("❌ インデックスの作成に失敗しました。");
    process.exit(1);
  }
  console.log("適用後のクエリプラン:");
  await explainLowerMcidSearch();
  console.log("✅ 適用完了（idx_paceman_paces_mcid_lower）。");
}

process.exit(0);
