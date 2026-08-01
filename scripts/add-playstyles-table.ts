// プレイスタイル用テーブル（playstyles）を追加し、あわせて inputMethod への一本化バックフィルを
// 行う一回限りのスクリプト。
//
// 背景:
// - `playstyles` は 1 user : 1 行のプレイスタイル設定（バージョン・カテゴリ・操作系・テクニック系）。
//   `pnpm db:push` はローカルDBとのドリフト（api_cache の索引名不一致）で無関係な DDL まで巻き込んで
//   失敗するため、必要な CREATE TABLE / INDEX のみを手動 DDL で適用する（add-like-tables.ts と同じ方式）。
//   DDL は `pnpm gen:test-schema`（drizzle-kit export）の出力と同一で、再実行に備えて
//   IF NOT EXISTS のみ付け足している。
// - `users.inputMethodBadge` は `inputMethod` に一本化され @deprecated になった（列は残置）。
//   一本化に伴い、プロフィールバッジ用に個別入力されていた inputMethodBadge の値を、
//   本流の inputMethod が未設定なユーザーにだけバックフィルする。
//   `UPDATE ... WHERE input_method IS NULL AND input_method_badge IS NOT NULL` は再実行しても
//   対象が減っていくだけの冪等な操作。
//
// dry-run では常に3種類の件数を報告する（--apply の有無によらず）:
//   (a) input_method IS NULL かつ input_method_badge IS NOT NULL … バックフィル対象
//   (b) 両方設定済みで値が異なる … 一本化でバッジ表示が変わる（バックフィル対象外・報告のみ）
//   (c) input_method のみ設定（badge が NULL） … 一本化で新たにバッジが表示されるようになる（報告のみ）
//
// 新規テーブルの追加とバックフィルのみで、既存の他データは変更しない。
//
// 実行:
//   pnpm exec tsx scripts/add-playstyles-table.ts                   # ローカル（.env）に dry-run
//   pnpm exec tsx scripts/add-playstyles-table.ts --apply           # ローカルに適用
//   pnpm exec tsx scripts/add-playstyles-table.ts --remote          # リモート（.env.remote）に dry-run
//   pnpm exec tsx scripts/add-playstyles-table.ts --remote --apply  # リモートに適用（要ユーザー承認）
import { createClient } from "@libsql/client";
import { loadDbEnv } from "./lib/db-env";

const { url, authToken } = loadDbEnv();

const apply = process.argv.includes("--apply");
const client = createClient({ url, authToken });

console.log(`モード: ${apply ? "APPLY（実際に適用します）" : "DRY-RUN（表示のみ・変更なし）"}`);

const TABLE = "playstyles";

const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS \`playstyles\` (
	\`id\` text PRIMARY KEY NOT NULL,
	\`user_id\` text NOT NULL,
	\`versions\` text,
	\`categories\` text,
	\`main_version\` text,
	\`main_category\` text,
	\`hotbar_switching\` text,
	\`search_craft\` text,
	\`half_shift\` text,
	\`item_layout_policy\` text,
	\`click_methods\` text,
	\`drag_tape_type\` text,
	\`uses_mousepad\` text,
	\`mousepad_type\` text,
	\`zero_cycle\` text,
	\`ground_zero\` text,
	\`oneshot\` text,
	\`favorite_bastion\` text,
	\`created_at\` integer NOT NULL,
	\`updated_at\` integer NOT NULL,
	FOREIGN KEY (\`user_id\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE cascade
)`,
  "CREATE UNIQUE INDEX IF NOT EXISTS `playstyles_user_id_unique` ON `playstyles` (`user_id`)",
];

const BACKFILL_TARGET_SQL =
  "SELECT COUNT(*) as count FROM users WHERE input_method IS NULL AND input_method_badge IS NOT NULL;";
const BACKFILL_DIFFERS_SQL =
  "SELECT COUNT(*) as count FROM users WHERE input_method IS NOT NULL AND input_method_badge IS NOT NULL AND input_method != input_method_badge;";
const BACKFILL_NEWLY_SHOWN_SQL =
  "SELECT COUNT(*) as count FROM users WHERE input_method IS NOT NULL AND input_method_badge IS NULL;";
const BACKFILL_UPDATE_SQL =
  "UPDATE users SET input_method = input_method_badge WHERE input_method IS NULL AND input_method_badge IS NOT NULL;";

async function tableExists(name: string) {
  const res = await client.execute({
    sql: "SELECT name FROM sqlite_master WHERE type='table' AND name=?;",
    args: [name],
  });
  return res.rows.length > 0;
}

async function countOf(sql: string) {
  const res = await client.execute(sql);
  return Number(res.rows[0]?.count ?? 0);
}

if (await tableExists(TABLE)) {
  console.log(`ℹ️  ${TABLE} は既に存在します（インデックスのみ IF NOT EXISTS で確認します）。`);
}

const backfillTarget = await countOf(BACKFILL_TARGET_SQL);
const backfillDiffers = await countOf(BACKFILL_DIFFERS_SQL);
const backfillNewlyShown = await countOf(BACKFILL_NEWLY_SHOWN_SQL);

console.log("inputMethod 一本化バックフィルの影響件数:");
console.log(`  (a) バックフィル対象（input_method未設定・input_method_badge設定済み）: ${backfillTarget} 件`);
console.log(`  (b) 両方設定済みで値が異なる（バッジ表示が変わる）:                     ${backfillDiffers} 件`);
console.log(`  (c) input_method のみ設定（バッジが新たに表示されるようになる）:        ${backfillNewlyShown} 件`);

if (apply) {
  for (const stmt of STATEMENTS) {
    await client.execute(stmt);
  }
  if (!(await tableExists(TABLE))) {
    console.error(`❌ ${TABLE} の作成に失敗しました。`);
    process.exit(1);
  }
  console.log(`✅ ${TABLE} + UNIQUE索引を適用しました。`);

  await client.execute(BACKFILL_UPDATE_SQL);
  const remaining = await countOf(BACKFILL_TARGET_SQL);
  if (remaining !== 0) {
    console.error(`❌ バックフィル後も対象が残っています（${remaining} 件）。`);
    process.exit(1);
  }
  console.log(`✅ inputMethod バックフィル完了（${backfillTarget} 件を更新）。`);
} else {
  console.log("実行予定のSQL:");
  for (const stmt of STATEMENTS) {
    console.log(`  ${stmt.replace(/\n\s*/g, " ")};`);
  }
  console.log(`  ${BACKFILL_UPDATE_SQL}`);
  console.log("ℹ️  dry-run のため変更していません（--apply 付きで実行すると適用します）。");
}

process.exit(0);
