// favorites テーブルの孤立インデックス idx_favorites_user_mcid を削除する一回限りのスクリプト。
//
// 背景: local.db には `idx_favorites_user_mcid`
// （`CREATE UNIQUE INDEX idx_favorites_user_mcid ON favorites (user_id, "favorite_slug")`）という
// index が残っていたが、現行 schema.ts にはこの名前の index 定義は存在しない（現行は
// `idx_favorites_user_slug`）。過去に favorites のカラムが favorite_mcid → favorite_slug に
// リネームされた際、index 名の変更が伴わず旧名のまま取り残されたものと見られる。
// `pnpm exec drizzle-kit push --verbose` の出力で、push 自身がこの index を
// `DROP INDEX` する計画を持っていたことから発覚した。
//
// 対処: index の DROP のみ（IF EXISTS）。favorites テーブルの行データには一切触れない。
// 実体として同一の一意制約は現行の `idx_favorites_user_slug` が既にカバーしているため、
// この index を削除しても一意性の保証は失われない。
//
// 実行:
//   pnpm exec tsx scripts/drop-orphan-favorites-index.ts           # ローカル（.env）に dry-run
//   pnpm exec tsx scripts/drop-orphan-favorites-index.ts --apply   # ローカルに適用
// リモートの状況は未確認のため --remote 対応は行わない
// （必要になった場合は改めて dry-run で確認してから対応する）。
import { createClient } from "@libsql/client";
import { loadDbEnv } from "./lib/db-env";

const { url, authToken } = loadDbEnv();

const apply = process.argv.includes("--apply");
const client = createClient({ url, authToken });

console.log(`モード: ${apply ? "APPLY（実際に適用します）" : "DRY-RUN（表示のみ・変更なし）"}`);

const ORPHAN_INDEX = "idx_favorites_user_mcid";
const CURRENT_INDEX = "idx_favorites_user_slug";

async function indexExists(name: string) {
  const res = await client.execute({
    sql: "SELECT name FROM sqlite_master WHERE type='index' AND name=?;",
    args: [name],
  });
  return res.rows.length > 0;
}

async function favoritesCount() {
  const res = await client.execute("SELECT COUNT(*) AS c FROM favorites;");
  return Number(res.rows[0]?.c ?? 0);
}

const orphanExists = await indexExists(ORPHAN_INDEX);
if (!orphanExists) {
  console.log(`ℹ️  ${ORPHAN_INDEX} は既に存在しません。変更はありません。`);
} else {
  console.log(`${ORPHAN_INDEX} を削除します（DROP INDEX のみ、favorites の行データは変更しません）。`);
}

if (apply) {
  const before = await favoritesCount();
  if (orphanExists) {
    await client.execute(`DROP INDEX IF EXISTS \`${ORPHAN_INDEX}\``);
  }
  const after = await favoritesCount();

  if (await indexExists(ORPHAN_INDEX)) {
    console.error(`❌ ${ORPHAN_INDEX} の削除に失敗しました。`);
    process.exit(1);
  }
  if (!(await indexExists(CURRENT_INDEX))) {
    console.error(`❌ 現行の ${CURRENT_INDEX} が存在しません。想定外の状態です。`);
    process.exit(1);
  }
  if (before !== after) {
    console.error(`❌ favorites の行数が変化しました（${before} → ${after}）。想定外です。`);
    process.exit(1);
  }
  console.log(`✅ 適用完了（${ORPHAN_INDEX} を削除。favorites 行数=${after}件、変化なし。${CURRENT_INDEX} は存在確認済み）。`);
} else {
  console.log("実行予定のSQL:");
  if (orphanExists) {
    console.log(`  DROP INDEX IF EXISTS \`${ORPHAN_INDEX}\`;`);
  } else {
    console.log("  （新規に実行するDDLはありません）");
  }
  console.log("ℹ️  dry-run のため変更していません（--apply 付きで実行すると適用します）。");
}

process.exit(0);
