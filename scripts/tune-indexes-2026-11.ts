// インデックスの見直し（2026-11）の一回限りスクリプト。
//
// 背景: 本番 Turso には統計（sqlite_stat1）が無く、低選択度の索引（真偽値単体など）が選ばれたり、
// lower(mcid) / lower(slug) の照合が全件 SCAN になっていた。
//   - 追加: users の式索引（lower(mcid) / lower(slug)）、config_presets の user_id 先頭の複合、
//           config_history の (user_id, created_at)
//   - 削除: 真偽値単体の索引、user_id 単体で複合の先頭と重なる索引、ユニーク制約と重複する索引
// 式索引の SQL テキストは drizzle-kit の出力（test-schema.sql）と完全に一致させる
// （経緯は scripts/fix-paceman-expression-index.ts）。
// 重複を理由に削除する索引は、同じテーブルに「先頭列が一致するユニーク索引」が実在する場合だけ削除する。
// 索引の追加・削除のみで、テーブルの行データは変更しない。
//
// 実行:
//   pnpm exec tsx scripts/tune-indexes-2026-11.ts                   # ローカル（.env）に dry-run
//   pnpm exec tsx scripts/tune-indexes-2026-11.ts --apply           # ローカルに適用
//   pnpm exec tsx scripts/tune-indexes-2026-11.ts --remote          # リモート（.env.remote）に dry-run
//   pnpm exec tsx scripts/tune-indexes-2026-11.ts --remote --apply  # リモートに適用（要ユーザー承認）
import { createClient } from "@libsql/client";
import { loadDbEnv } from "./lib/db-env";

const { url, authToken } = loadDbEnv();
const apply = process.argv.includes("--apply");
const client = createClient({ url, authToken });

console.log(`モード: ${apply ? "APPLY（実際に適用します）" : "DRY-RUN（表示のみ・変更なし）"}`);

const CREATES: { name: string; sql: string }[] = [
  { name: "idx_users_mcid_lower", sql: 'CREATE INDEX `idx_users_mcid_lower` ON `users` (lower("mcid"))' },
  { name: "idx_users_slug_lower", sql: 'CREATE INDEX `idx_users_slug_lower` ON `users` (lower("slug"))' },
  {
    name: "idx_config_presets_user_active_main",
    sql: "CREATE INDEX `idx_config_presets_user_active_main` ON `config_presets` (`user_id`,`is_active`,`is_main`)",
  },
  {
    name: "idx_config_presets_user_main",
    sql: "CREATE INDEX `idx_config_presets_user_main` ON `config_presets` (`user_id`,`is_main`)",
  },
  {
    name: "idx_config_history_user_created",
    sql: "CREATE INDEX `idx_config_history_user_created` ON `config_history` (`user_id`,`created_at`)",
  },
];

// 置き換え先が上の CREATES にある削除（新しい索引が先に作られる前提）
const REPLACED_DROPS: { name: string; table: string; by: string }[] = [
  { name: "idx_config_presets_user_id", table: "config_presets", by: "idx_config_presets_user_active_main" },
  { name: "idx_config_presets_is_active", table: "config_presets", by: "idx_config_presets_user_active_main" },
  { name: "idx_config_presets_is_main", table: "config_presets", by: "idx_config_presets_user_main" },
  { name: "idx_config_history_user_id", table: "config_history", by: "idx_config_history_user_created" },
];

// 読み側のクエリが無い／他の索引で足りるので単純に削除するもの
const PLAIN_DROPS: { name: string; reason: string }[] = [
  { name: "idx_config_history_created_at", reason: "読み側は常に user_id と併用。(user_id, created_at) で足りる" },
  { name: "idx_config_history_change_type", reason: "where で使うクエリが無い" },
  { name: "idx_paceman_paces_is_nether_enter", reason: "真偽値単体。date / mcid 索引の選び間違いの元" },
  { name: "idx_paceman_paces_is_2nd_structure_or_later", reason: "真偽値単体。常に mcid lower / date と併用" },
];

// ユニーク制約と重複する索引（table の先頭列 column のユニーク索引が実在するときだけ削除）
const DUPLICATE_DROPS: { name: string; table: string; column: string }[] = [
  { name: "idx_users_discord_id", table: "users", column: "discord_id" },
  { name: "idx_users_mcid", table: "users", column: "mcid" },
  { name: "idx_users_uuid", table: "users", column: "uuid" },
  { name: "idx_users_slug", table: "users", column: "slug" },
  { name: "idx_api_cache_key", table: "api_cache", column: "cache_key" },
  { name: "idx_rankings_cache_key", table: "rankings_cache", column: "cache_key" },
  { name: "idx_speedrun_categories_slug", table: "speedrun_categories", column: "slug" },
  { name: "idx_youtube_live_video_id", table: "youtube_live_cache", column: "video_id" },
  { name: "idx_youtube_cache_video_id", table: "youtube_video_cache", column: "video_id" },
  { name: "idx_external_stats_user_id", table: "external_stats", column: "user_id" },
  { name: "idx_keybindings_user_id", table: "keybindings", column: "user_id" },
  { name: "idx_category_records_user_id", table: "category_records", column: "user_id" },
  { name: "idx_custom_actions_user_id", table: "custom_actions", column: "user_id" },
  { name: "idx_favorites_user_id", table: "favorites", column: "user_id" },
  { name: "guides_author_idx", table: "guides", column: "author_id" },
];

async function indexSql(name: string): Promise<string | null> {
  const res = await client.execute({
    sql: "SELECT sql FROM sqlite_master WHERE type='index' AND name=?;",
    args: [name],
  });
  if (res.rows.length === 0) return null;
  return res.rows[0].sql === null ? "" : String(res.rows[0].sql);
}

// table に、先頭列が column のユニーク索引（ユニーク制約の自動索引を含む。部分索引は除く）があるか
async function coveringUniqueIndex(table: string, column: string, except: string): Promise<string | null> {
  const list = await client.execute(`PRAGMA index_list(\`${table}\`)`);
  for (const row of list.rows) {
    const name = String(row.name);
    if (name === except || Number(row.unique) !== 1 || Number(row.partial) === 1) continue;
    const info = await client.execute(`PRAGMA index_info(\`${name}\`)`);
    const first = info.rows.find((r) => Number(r.seqno) === 0);
    if (first && String(first.name) === column) return name;
  }
  return null;
}

const statements: string[] = [];

for (const c of CREATES) {
  const cur = await indexSql(c.name);
  if (cur === null) {
    console.log(`作成: ${c.name}`);
    statements.push(c.sql);
  } else if (cur === c.sql) {
    console.log(`既存（一致）: ${c.name}`);
  } else {
    console.log(`既存（テキスト不一致）: ${c.name} → DROP → CREATE\n  実際: ${JSON.stringify(cur)}\n  期待: ${JSON.stringify(c.sql)}`);
    statements.push(`DROP INDEX IF EXISTS \`${c.name}\``, c.sql);
  }
}

for (const d of REPLACED_DROPS) {
  if ((await indexSql(d.name)) === null) {
    console.log(`削除済み: ${d.name}`);
  } else {
    console.log(`削除: ${d.name}（${d.by} で置き換え）`);
    statements.push(`DROP INDEX IF EXISTS \`${d.name}\``);
  }
}

for (const d of PLAIN_DROPS) {
  if ((await indexSql(d.name)) === null) {
    console.log(`削除済み: ${d.name}`);
  } else {
    console.log(`削除: ${d.name}（${d.reason}）`);
    statements.push(`DROP INDEX IF EXISTS \`${d.name}\``);
  }
}

for (const d of DUPLICATE_DROPS) {
  if ((await indexSql(d.name)) === null) {
    console.log(`削除済み: ${d.name}`);
    continue;
  }
  const cover = await coveringUniqueIndex(d.table, d.column, d.name);
  if (cover === null) {
    console.log(`保持: ${d.name}（${d.table}.${d.column} を先頭にするユニーク索引が見つからないため）`);
  } else {
    console.log(`削除: ${d.name}（ユニーク索引 ${cover} と重複）`);
    statements.push(`DROP INDEX IF EXISTS \`${d.name}\``);
  }
}

if (apply) {
  for (const s of statements) await client.execute(s);
  console.log(`✅ 適用完了（${statements.length}文）。`);
} else {
  console.log("実行予定のSQL:");
  if (statements.length === 0) console.log("  （なし）");
  for (const s of statements) console.log(`  ${s};`);
  console.log("ℹ️  dry-run のため変更していません（--apply 付きで実行すると適用します）。");
}
process.exit(0);
