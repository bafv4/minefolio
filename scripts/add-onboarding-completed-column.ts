// users に onboarding_completed 列（初期設定ウィザード /onboarding を完了したか）を追加する
// 一回限りのスクリプト。
//
// 背景: DB 既定値は true（列追加前から存在する全ユーザーを「完了済み」として扱うため、
// バックフィル不要）。truthy デフォルト付き NOT NULL の列追加自体は本来 `pnpm db:push` で通るはずだが、
// local.db には paceman_paces の式インデックス（idx_paceman_paces_mcid_lower）が絡む push 経路のバグ
// （drizzle-kit 0.31.10 がテーブル再構築時に式を列名としてクォートし直してしまう）が
// 常時刺さっており、`pnpm db:push` 自体が `SQLITE_ERROR: no such column: lower("mcid")`
// で中断する（docs/database.md の運用ノート・.claude/skills/db-apply/SKILL.md 参照）。
// そのため本列も push を経由せず、手動 DDL で追加する。
//
// DDL は `pnpm gen:test-schema`（drizzle-kit export）の出力と一致させ、
// 再実行に備えて事前に PRAGMA table_info で存在チェックする。
// SQLite の ALTER TABLE ADD は既存行に DEFAULT 値（true = 1）を入れるため、既存ユーザーはすべて完了済みになる。
//
// 実行:
//   pnpm exec tsx scripts/add-onboarding-completed-column.ts                   # ローカル（.env）に dry-run
//   pnpm exec tsx scripts/add-onboarding-completed-column.ts --apply           # ローカルに適用
//   pnpm exec tsx scripts/add-onboarding-completed-column.ts --remote          # リモート（.env.remote）に dry-run
//   pnpm exec tsx scripts/add-onboarding-completed-column.ts --remote --apply  # リモートに適用（要ユーザー承認）
import { createClient } from "@libsql/client";
import { loadDbEnv } from "./lib/db-env";

const { url, authToken } = loadDbEnv();

const apply = process.argv.includes("--apply");
const client = createClient({ url, authToken });

console.log(`モード: ${apply ? "APPLY（実際に適用します）" : "DRY-RUN（表示のみ・変更なし）"}`);

const TABLE = "users";
const COLUMN = "onboarding_completed";
const STATEMENT = "ALTER TABLE `users` ADD `onboarding_completed` integer DEFAULT true NOT NULL;";

async function columnExists() {
  const info = await client.execute(`PRAGMA table_info(${TABLE});`);
  return info.rows.some((r) => r.name === COLUMN);
}

const exists = await columnExists();
if (exists) {
  console.log(`ℹ️  ${TABLE}.${COLUMN} は既に存在します。変更はありません。`);
} else if (apply) {
  await client.execute(STATEMENT);
  if (!(await columnExists())) {
    console.error(`❌ ${TABLE}.${COLUMN} の追加に失敗しました。`);
    process.exit(1);
  }
  console.log(`✅ 適用完了（${TABLE}.${COLUMN} 列を追加）。`);
} else {
  const count = await client.execute(`SELECT COUNT(*) AS n FROM ${TABLE};`);
  console.log("実行予定のSQL:");
  console.log(`  ${STATEMENT}`);
  console.log(`ℹ️  既存 ${count.rows[0]?.n ?? 0} 行は DEFAULT により onboarding_completed = true（完了済み）になります。`);
  console.log("ℹ️  dry-run のため変更していません（--apply 付きで実行すると適用します）。");
}

process.exit(0);
