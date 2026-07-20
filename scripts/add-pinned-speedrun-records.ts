// users.pinned_speedrun_records（nullable text）を安全に手動追加する一回限りのスクリプト。
// schema.ts では定義済みだが実DBに未適用の列を、存在チェック付きで直接 ALTER する。
// nullable・デフォルト無しのため drizzle-kit push の TRUNCATE 提案は該当しないが、
// scripts/ の既存パターン（apply-0019.ts）に倣い冪等に適用する。
//
// 実行: pnpm exec tsx scripts/add-pinned-speedrun-records.ts
// （dotenv が .env の TURSO_DATABASE_URL / TURSO_AUTH_TOKEN を読み込む。
//   .env が file:local.db を指していればローカルDBに適用される）
import "dotenv/config";
import { createClient } from "@libsql/client";

const url = process.env.TURSO_DATABASE_URL;
if (!url) throw new Error("TURSO_DATABASE_URL が未設定です（.env を確認）");

const client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });

async function columnExists(table: string, column: string) {
  const info = await client.execute(`PRAGMA table_info(${table});`);
  return info.rows.some((r) => r.name === column);
}

if (await columnExists("users", "pinned_speedrun_records")) {
  console.log("ℹ️  users.pinned_speedrun_records は既に存在します。スキップ。");
} else {
  await client.execute("ALTER TABLE users ADD pinned_speedrun_records text;");
  console.log("✅ users.pinned_speedrun_records を追加しました（既存行は NULL）。");
}

// --- 検証 ---
if (!(await columnExists("users", "pinned_speedrun_records"))) {
  console.error("❌ 追加に失敗しました。");
  process.exit(1);
}
console.log(`✅ 検証OK: 対象DB = ${url}`);
process.exit(0);
