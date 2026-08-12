// app_meta テーブル（アプリケーション全体のkey-valueメタデータ。例: リリース通知の最終通知バージョン
// release_notify:last_version）を local.db に追加する一回限りのスクリプト。
//
// 背景: local.db には schema.ts で定義されている app_meta テーブルが実在しなかった
// （player_rankings と同様のドリフト。`pnpm exec drizzle-kit push --verbose` の出力冒頭に
// `CREATE TABLE app_meta (...)` が含まれていたことで発覚）。
// 新規テーブル追加のみで既存データは一切変更しない。付随する index は無い（PK のみ）。
//
// DDL は `pnpm gen:test-schema`（drizzle-kit export の出力 = app/lib/__tests__/helpers/test-schema.sql）
// の該当定義と完全一致させ、再実行に備えて CREATE TABLE に IF NOT EXISTS を付与。
//
// 実行:
//   pnpm exec tsx scripts/add-app-meta-table.ts           # ローカル（.env）に dry-run
//   pnpm exec tsx scripts/add-app-meta-table.ts --apply   # ローカルに適用
// リモートには既に app_meta テーブルが存在する想定のため --remote 対応は行わない
// （必要になった場合は改めて dry-run で確認してから対応する）。
import { createClient } from "@libsql/client";
import { loadDbEnv } from "./lib/db-env";

const { url, authToken } = loadDbEnv();

const apply = process.argv.includes("--apply");
const client = createClient({ url, authToken });

console.log(`モード: ${apply ? "APPLY（実際に適用します）" : "DRY-RUN（表示のみ・変更なし）"}`);

const TABLE = "app_meta";

const STATEMENT = `CREATE TABLE IF NOT EXISTS \`app_meta\` (
	\`key\` text PRIMARY KEY NOT NULL,
	\`value\` text NOT NULL,
	\`updated_at\` integer NOT NULL
)`;

async function tableExists(name: string) {
  const res = await client.execute({
    sql: "SELECT name FROM sqlite_master WHERE type='table' AND name=?;",
    args: [name],
  });
  return res.rows.length > 0;
}

const alreadyExists = await tableExists(TABLE);
if (alreadyExists) {
  console.log(`ℹ️  ${TABLE} は既に存在します。変更はありません。`);
} else {
  console.log(`${TABLE} を作成します。`);
}

if (apply) {
  await client.execute(STATEMENT);
  if (!(await tableExists(TABLE))) {
    console.error(`❌ ${TABLE} の作成に失敗しました。`);
    process.exit(1);
  }
  console.log(`✅ 適用完了（${TABLE} テーブル）。`);
} else {
  console.log("実行予定のSQL:");
  console.log(`  ${STATEMENT.replace(/\n\s*/g, " ")};`);
  console.log("ℹ️  dry-run のため変更していません（--apply 付きで実行すると適用します）。");
}

process.exit(0);
