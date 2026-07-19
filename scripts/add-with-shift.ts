// search_crafts に with_shift 列を安全に追加する一回限りのスクリプト。
// drizzle-kit push は .default(false)（falsy）を「デフォルト無し」と誤認し
// テーブル再作成（TRUNCATE）を提案するため、生成済みマイグレーション
// drizzle/0017_odd_sugar_man.sql と同じ ALTER を直接実行してデータを保持する。
//
// 実行: pnpm exec tsx scripts/add-with-shift.ts
// （dotenv が .env の TURSO_DATABASE_URL / TURSO_AUTH_TOKEN を読み込む）
import "dotenv/config";
import { createClient } from "@libsql/client";

const url = process.env.TURSO_DATABASE_URL;
if (!url) throw new Error("TURSO_DATABASE_URL が未設定です（.env を確認）");

const client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });

const info = await client.execute("PRAGMA table_info(search_crafts);");
const exists = info.rows.some((r) => r.name === "with_shift");

if (exists) {
  console.log("ℹ️  with_shift 列は既に存在します。変更はありません。");
} else {
  const before = await client.execute("SELECT COUNT(*) AS n FROM search_crafts;");
  await client.execute(
    "ALTER TABLE search_crafts ADD with_shift integer DEFAULT false NOT NULL;",
  );
  console.log(
    `✅ with_shift を追加しました（既存 ${before.rows[0]?.n ?? "?"} 行は false=0 で初期化）。`,
  );
}

process.exit(0);
