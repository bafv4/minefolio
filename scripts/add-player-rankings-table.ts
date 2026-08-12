// player_rankings テーブル（speedrun.com / MCSR Ranked のプレイヤーランキング記録）を
// local.db に追加する一回限りのスクリプト。
//
// 背景: local.db には schema.ts で定義されている player_rankings テーブルが実在しなかった
// （app/lib/rankings-query.server.ts・app/routes/api/cron/update-rankings.ts から参照される
// テーブルだが、何らかの経緯で local.db には作成されないまま drift していた）。
// このため `pnpm db:push` は `idx_player_rankings_*` の index を作ろうとして
// `no such table: main.player_rankings` で中断していた（fix-missing-indexes.ts の対応範囲外）。
// 新規テーブル + index の追加のみで既存データは一切変更しない。
//
// DDL は `pnpm gen:test-schema`（drizzle-kit export の出力 = app/lib/__tests__/helpers/test-schema.sql）
// の該当定義と完全一致させ、再実行に備えて CREATE TABLE / INDEX に IF NOT EXISTS を付与。
// index 5件は fix-missing-indexes.ts の対象と同一だが、テーブル作成との依存順を確実にするため
// このスクリプト内で完結させる（fix-missing-indexes.ts を再実行してもこの5件は重複適用されない
// ＝ IF NOT EXISTS のため安全）。
//
// 実行:
//   pnpm exec tsx scripts/add-player-rankings-table.ts           # ローカル（.env）に dry-run
//   pnpm exec tsx scripts/add-player-rankings-table.ts --apply   # ローカルに適用
// リモートには既に player_rankings テーブルが存在するため --remote 対応は不要（実施しない）。
import { createClient } from "@libsql/client";
import { loadDbEnv } from "./lib/db-env";

const { url, authToken } = loadDbEnv();

const apply = process.argv.includes("--apply");
const client = createClient({ url, authToken });

console.log(`モード: ${apply ? "APPLY（実際に適用します）" : "DRY-RUN（表示のみ・変更なし）"}`);

const TABLE = "player_rankings";

const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS \`player_rankings\` (
	\`id\` text PRIMARY KEY NOT NULL,
	\`user_id\` text NOT NULL,
	\`ranking_type\` text NOT NULL,
	\`category_id\` text,
	\`speedruncom_run_id\` text,
	\`speedruncom_player_id\` text,
	\`verification_status\` text DEFAULT 'verified',
	\`time_ms\` integer,
	\`time_formatted\` text,
	\`elo_rate\` integer,
	\`wins\` integer,
	\`losses\` integer,
	\`win_rate\` real,
	\`record_date\` text,
	\`video_url\` text,
	\`run_weblink\` text,
	\`last_fetched\` integer NOT NULL,
	\`created_at\` integer NOT NULL,
	\`updated_at\` integer NOT NULL,
	FOREIGN KEY (\`user_id\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (\`category_id\`) REFERENCES \`speedrun_categories\`(\`id\`) ON UPDATE no action ON DELETE cascade
)`,
  "CREATE INDEX IF NOT EXISTS `idx_player_rankings_user` ON `player_rankings` (`user_id`)",
  "CREATE INDEX IF NOT EXISTS `idx_player_rankings_type` ON `player_rankings` (`ranking_type`)",
  "CREATE INDEX IF NOT EXISTS `idx_player_rankings_category` ON `player_rankings` (`category_id`)",
  "CREATE INDEX IF NOT EXISTS `idx_player_rankings_time` ON `player_rankings` (`time_ms`)",
  "CREATE INDEX IF NOT EXISTS `idx_player_rankings_elo` ON `player_rankings` (`elo_rate`)",
];

async function tableExists(name: string) {
  const res = await client.execute({
    sql: "SELECT name FROM sqlite_master WHERE type='table' AND name=?;",
    args: [name],
  });
  return res.rows.length > 0;
}

const alreadyExists = await tableExists(TABLE);
if (alreadyExists) {
  console.log(`ℹ️  ${TABLE} は既に存在します（index のみ IF NOT EXISTS で確認します）。`);
} else {
  console.log(`${TABLE} を作成します。`);
}

if (apply) {
  for (const stmt of STATEMENTS) {
    await client.execute(stmt);
  }
  if (!(await tableExists(TABLE))) {
    console.error(`❌ ${TABLE} の作成に失敗しました。`);
    process.exit(1);
  }
  const idxNames = [
    "idx_player_rankings_user",
    "idx_player_rankings_type",
    "idx_player_rankings_category",
    "idx_player_rankings_time",
    "idx_player_rankings_elo",
  ];
  const idxRes = await client.execute({
    sql: `SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='${TABLE}';`,
  });
  const existingIdx = new Set(idxRes.rows.map((r) => String(r.name)));
  const missingIdx = idxNames.filter((n) => !existingIdx.has(n));
  if (missingIdx.length > 0) {
    console.error(`❌ 以下の index が作成できませんでした: ${missingIdx.join(", ")}`);
    process.exit(1);
  }
  console.log(`✅ 適用完了（${TABLE} テーブル + index 5件）。`);
} else {
  console.log("実行予定のSQL:");
  if (alreadyExists) {
    console.log("  （テーブルは既存。index の IF NOT EXISTS 分のみ実行されます）");
  }
  for (const stmt of STATEMENTS) {
    console.log(`  ${stmt.replace(/\n\s*/g, " ")};`);
  }
  console.log("ℹ️  dry-run のため変更していません（--apply 付きで実行すると適用します）。");
}

process.exit(0);
