// users に bedrock_mcid 列（Bedrock Edition の MCID = Xbox ゲーマータグ。任意・UNIQUE なし）を
// 追加する一回限りのスクリプト。
//
// 背景: nullable な列追加自体は本来 `pnpm db:push` で通るはずだが、local.db には
// paceman_paces の式インデックス（idx_paceman_paces_mcid_lower）が絡む push 経路のバグ
// （drizzle-kit 0.31.10 がテーブル再構築時に式を列名としてクォートし直してしまう）が
// 常時刺さっており、`pnpm db:push` 自体が `SQLITE_ERROR: no such column: lower("mcid")`
// で中断する（docs/database.md の運用ノート・.claude/skills/db-apply/SKILL.md 参照）。
// そのため本列も push を経由せず、手動 DDL で追加する。
//
// DDL は `pnpm gen:test-schema`（drizzle-kit export）の出力と一致させ、
// 再実行に備えて事前に PRAGMA table_info で存在チェックする。
//
// 実行:
//   pnpm exec tsx scripts/add-bedrock-mcid.ts           # ローカル（.env）に dry-run
//   pnpm exec tsx scripts/add-bedrock-mcid.ts --apply   # ローカルに適用
// リモートには当面適用しない（ユーザー承認後に改めて --remote で実行する）。
import { createClient } from "@libsql/client";
import { loadDbEnv } from "./lib/db-env";

const { url, authToken } = loadDbEnv();

const apply = process.argv.includes("--apply");
const client = createClient({ url, authToken });

console.log(`モード: ${apply ? "APPLY（実際に適用します）" : "DRY-RUN（表示のみ・変更なし）"}`);

const TABLE = "users";
const COLUMN = "bedrock_mcid";
const STATEMENT = "ALTER TABLE `users` ADD `bedrock_mcid` text;";

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
  console.log("実行予定のSQL:");
  console.log(`  ${STATEMENT}`);
  console.log("ℹ️  dry-run のため変更していません（--apply 付きで実行すると適用します）。");
}

process.exit(0);
