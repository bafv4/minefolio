// drizzle/0018・0019 の未適用分を安全に手動適用する一回限りのスクリプト。
// drizzle-kit push は .default(false)（falsy）を「デフォルト無し」と誤認し
// テーブル再作成（TRUNCATE）を提案するため、生成済みマイグレーションと
// 同じDDLを存在チェック付きで直接実行してデータを保持する。
//
// 実行: pnpm exec tsx scripts/apply-0019.ts
// （dotenv が .env の TURSO_DATABASE_URL / TURSO_AUTH_TOKEN を読み込む）
import "dotenv/config";
import { createClient } from "@libsql/client";

const url = process.env.TURSO_DATABASE_URL;
if (!url) throw new Error("TURSO_DATABASE_URL が未設定です（.env を確認）");

const client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });

async function columnExists(table: string, column: string) {
  const info = await client.execute(`PRAGMA table_info(${table});`);
  return info.rows.some((r) => r.name === column);
}

async function tableExists(table: string) {
  const res = await client.execute({
    sql: "SELECT name FROM sqlite_master WHERE type='table' AND name=?;",
    args: [table],
  });
  return res.rows.length > 0;
}

// --- 0018: key_remaps.remap_type + ユニークインデックス張り替え ---
if (await columnExists("key_remaps", "remap_type")) {
  console.log("ℹ️  0018: key_remaps.remap_type は既に存在します。スキップ。");
} else {
  await client.execute("DROP INDEX IF EXISTS idx_key_remaps_user_source;");
  await client.execute(
    "ALTER TABLE key_remaps ADD remap_type text DEFAULT 'unset' NOT NULL;",
  );
  await client.execute(
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_key_remaps_user_source_type ON key_remaps (user_id, source_key, remap_type);",
  );
  console.log("✅ 0018: key_remaps.remap_type を追加しました。");
}

// --- 0019: profile_videos テーブル ---
if (await tableExists("profile_videos")) {
  console.log("ℹ️  0019: profile_videos は既に存在します。スキップ。");
} else {
  await client.execute(`CREATE TABLE profile_videos (
    id text PRIMARY KEY NOT NULL,
    user_id text NOT NULL,
    url text NOT NULL,
    title text,
    is_pinned integer DEFAULT false NOT NULL,
    display_order integer DEFAULT 0 NOT NULL,
    created_at integer NOT NULL,
    updated_at integer NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON UPDATE no action ON DELETE cascade
  );`);
  console.log("✅ 0019: profile_videos テーブルを作成しました。");
}
await client.execute(
  "CREATE INDEX IF NOT EXISTS idx_profile_videos_user_id ON profile_videos (user_id);",
);

// --- 0019: category_records.is_pinned / guides.is_pinned ---
for (const table of ["category_records", "guides"]) {
  if (await columnExists(table, "is_pinned")) {
    console.log(`ℹ️  0019: ${table}.is_pinned は既に存在します。スキップ。`);
  } else {
    const before = await client.execute(`SELECT COUNT(*) AS n FROM ${table};`);
    await client.execute(
      `ALTER TABLE ${table} ADD is_pinned integer DEFAULT false NOT NULL;`,
    );
    console.log(
      `✅ 0019: ${table}.is_pinned を追加しました（既存 ${before.rows[0]?.n ?? "?"} 行は false=0 で初期化）。`,
    );
  }
}

// --- 検証 ---
const checks: [string, boolean][] = [
  ["key_remaps.remap_type", await columnExists("key_remaps", "remap_type")],
  ["profile_videos テーブル", await tableExists("profile_videos")],
  ["category_records.is_pinned", await columnExists("category_records", "is_pinned")],
  ["guides.is_pinned", await columnExists("guides", "is_pinned")],
];
const missing = checks.filter(([, ok]) => !ok);
if (missing.length > 0) {
  console.error("❌ 未適用のまま:", missing.map(([name]) => name).join(", "));
  process.exit(1);
}
console.log("✅ 検証OK: 0018・0019 の全変更が適用済みです。");
process.exit(0);
