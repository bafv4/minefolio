// inline `.unique()` 列に対応する named unique index を local.db / リモートに補完する一回限りのスクリプト。
//
// 背景: schema.ts で `.unique()` 修飾子（例: `apiCache.cacheKey`）を付けた列は、SQLite 上では
// 列制約として `sqlite_autoindex_<table>_N` が自動生成されるだけで、drizzle-kit が期待する
// named index（`<table>_<column>_unique`）としては存在しない。drizzle-kit push はこの named index の
// 存在を前提に内部整合をとるため、named index が欠けているテーブルがあると
// `LibsqlError: SQLITE_ERROR: no such index: api_cache_cache_key_unique` のようなエラーで
// バッチ全体が中断する（api_cache 以外の無関係なテーブルの DDL まで巻き込まれる）。
//
// 対象は `.unique()` を使っている全列（14件）を網羅的にチェックする。期待する index 名・定義は
// `pnpm gen:test-schema`（drizzle-kit export の出力 = app/lib/__tests__/helpers/test-schema.sql）の
// `CREATE UNIQUE INDEX` 行と完全一致させている。既に named index が存在するテーブルはスキップし、
// 欠けているテーブルにのみ `CREATE UNIQUE INDEX IF NOT EXISTS` を追加する（列の実データ・既存の
// autoindex には触れない。UNIQUE 制約自体は列定義側で既に効いているため、追加してもデータ整合性は変わらない）。
//
// 実行:
//   pnpm exec tsx scripts/fix-unique-index-names.ts                   # ローカル（.env）に dry-run
//   pnpm exec tsx scripts/fix-unique-index-names.ts --apply           # ローカルに適用
//   pnpm exec tsx scripts/fix-unique-index-names.ts --remote          # リモート（.env.remote）に dry-run
//   pnpm exec tsx scripts/fix-unique-index-names.ts --remote --apply  # リモートに適用（要ユーザー承認）
import { createClient } from "@libsql/client";
import { loadDbEnv } from "./lib/db-env";

const { url, authToken } = loadDbEnv();

const apply = process.argv.includes("--apply");
const client = createClient({ url, authToken });

console.log(`モード: ${apply ? "APPLY（実際に適用します）" : "DRY-RUN（表示のみ・変更なし）"}`);

interface UniqueIndexTarget {
  table: string;
  column: string;
  indexName: string;
}

// `.unique()` を使っている全列（app/lib/schema.ts）。名前・定義は test-schema.sql と一致させている。
const TARGETS: UniqueIndexTarget[] = [
  { table: "api_cache", column: "cache_key", indexName: "api_cache_cache_key_unique" },
  { table: "auth_sessions", column: "token", indexName: "auth_sessions_token_unique" },
  { table: "auth_users", column: "email", indexName: "auth_users_email_unique" },
  { table: "player_configs", column: "user_id", indexName: "player_configs_user_id_unique" },
  { table: "playstyles", column: "user_id", indexName: "playstyles_user_id_unique" },
  { table: "rankings_cache", column: "cache_key", indexName: "rankings_cache_cache_key_unique" },
  { table: "speedrun_categories", column: "slug", indexName: "speedrun_categories_slug_unique" },
  { table: "twitch_vod_cache", column: "vod_id", indexName: "twitch_vod_cache_vod_id_unique" },
  { table: "users", column: "discord_id", indexName: "users_discord_id_unique" },
  { table: "users", column: "mcid", indexName: "users_mcid_unique" },
  { table: "users", column: "uuid", indexName: "users_uuid_unique" },
  { table: "users", column: "slug", indexName: "users_slug_unique" },
  { table: "youtube_live_cache", column: "video_id", indexName: "youtube_live_cache_video_id_unique" },
  { table: "youtube_video_cache", column: "video_id", indexName: "youtube_video_cache_video_id_unique" },
];

async function indexExists(name: string) {
  const res = await client.execute({
    sql: "SELECT name FROM sqlite_master WHERE type='index' AND name=?;",
    args: [name],
  });
  return res.rows.length > 0;
}

const pending: UniqueIndexTarget[] = [];
for (const t of TARGETS) {
  if (await indexExists(t.indexName)) {
    console.log(`ℹ️  ${t.indexName}（${t.table}.${t.column}）は既に存在します。`);
  } else {
    console.log(`${t.indexName}（${t.table}.${t.column}）を追加します。`);
    pending.push(t);
  }
}

function ddlFor(t: UniqueIndexTarget) {
  return `CREATE UNIQUE INDEX IF NOT EXISTS \`${t.indexName}\` ON \`${t.table}\` (\`${t.column}\`)`;
}

if (apply) {
  for (const t of pending) {
    await client.execute(ddlFor(t));
  }
  const stillMissing: UniqueIndexTarget[] = [];
  for (const t of TARGETS) {
    if (!(await indexExists(t.indexName))) stillMissing.push(t);
  }
  if (stillMissing.length > 0) {
    console.error(
      `❌ 以下の index が作成できませんでした: ${stillMissing.map((t) => t.indexName).join(", ")}`,
    );
    process.exit(1);
  }
  console.log(`✅ 適用完了（${pending.length}件の named unique index を追加）。`);
} else {
  console.log("実行予定のSQL:");
  if (pending.length === 0) {
    console.log("  （新規に実行するDDLはありません。全て適用済みです）");
  } else {
    for (const t of pending) {
      console.log(`  ${ddlFor(t)};`);
    }
  }
  console.log("ℹ️  dry-run のため変更していません（--apply 付きで実行すると適用します）。");
}

process.exit(0);
