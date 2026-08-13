// search_crafts に search_variations 列（複数サーチ文字列バリエーション）を追加する一回限りのスクリプト。
// db:push はローカルDBの既存ドリフト（api_cache のインデックス）で失敗するため、手動 DDL で適用する。
//
// 内容:
//   ALTER TABLE search_crafts ADD COLUMN search_variations text
//   （NULL 許容・デフォルトなし。JSON: { str: string; withShift: boolean }[]。
//    既存の search_str / with_shift は第1バリエーションのミラーとして書き込みを継続するため、
//    バックフィルは行わない。読み取り側は resolveVariations() でフォールバックする）
//
// 実行:
//   pnpm exec tsx scripts/add-search-variations.ts                   # ローカル（.env）に dry-run
//   pnpm exec tsx scripts/add-search-variations.ts --apply           # ローカルに適用
//   pnpm exec tsx scripts/add-search-variations.ts --remote          # リモート（.env.remote）に dry-run
//   pnpm exec tsx scripts/add-search-variations.ts --remote --apply  # リモートに適用
import { createClient } from "@libsql/client";
import { loadDbEnv } from "./lib/db-env";

const { url, authToken } = loadDbEnv();

const apply = process.argv.includes("--apply");
const client = createClient({ url, authToken });

console.log(`接続先: ${url}`);
console.log(`モード: ${apply ? "APPLY（実際に適用します）" : "DRY-RUN（表示のみ・変更なし）"}`);

const columns = await client.execute(`PRAGMA table_info(search_crafts);`);
const hasColumn = columns.rows.some((r) => String(r.name) === "search_variations");

if (hasColumn) {
  console.log("ℹ️  search_variations 列は既に存在します。何もしません。");
  process.exit(0);
}

console.log("search_variations 列（text・NULL 許容）を追加します。");

if (!apply) {
  console.log("ℹ️  dry-run のため変更していません（--apply 付きで実行すると適用します）。");
  process.exit(0);
}

await client.execute(`ALTER TABLE search_crafts ADD COLUMN search_variations text;`);

const verify = await client.execute(`PRAGMA table_info(search_crafts);`);
if (!verify.rows.some((r) => String(r.name) === "search_variations")) {
  console.error("❌ 追加後の確認で列が見つかりませんでした。");
  process.exit(1);
}

console.log("✅ 適用完了。");
process.exit(0);
