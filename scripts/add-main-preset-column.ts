// config_presets に is_main 列（公開用メインプリセットのフラグ）を追加する一回限りのスクリプト。
// db:push は falsy デフォルトの新規列で TRUNCATE を提案してしまうため、手動 DDL で適用する（プロジェクトの既知運用）。
//
// 内容:
//   1. ALTER TABLE config_presets ADD COLUMN is_main integer NOT NULL DEFAULT 0
//   2. 既存データのバックフィル: is_main = is_active（現状の「適用中」をそのまま公開用メインとする）
//   3. インデックス idx_config_presets_is_main を作成
//
// 実行:
//   pnpm exec tsx scripts/add-main-preset-column.ts          # dry-run（現状の確認のみ）
//   pnpm exec tsx scripts/add-main-preset-column.ts --apply  # 実際に適用
// （dotenv が .env の TURSO_DATABASE_URL / TURSO_AUTH_TOKEN を読み込む）
import "dotenv/config";
import { createClient } from "@libsql/client";

const url = process.env.TURSO_DATABASE_URL;
if (!url) throw new Error("TURSO_DATABASE_URL が未設定です（.env を確認）");

const apply = process.argv.includes("--apply");
const client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });

console.log(`モード: ${apply ? "APPLY（実際に適用します）" : "DRY-RUN（表示のみ・変更なし）"}`);

// 既に適用済みかを確認
const columns = await client.execute(`PRAGMA table_info(config_presets);`);
const hasColumn = columns.rows.some((r) => String(r.name) === "is_main");

if (hasColumn) {
  console.log("ℹ️  is_main 列は既に存在します。");
} else {
  console.log("is_main 列を追加します。");
  if (apply) {
    await client.execute(
      `ALTER TABLE config_presets ADD COLUMN is_main integer NOT NULL DEFAULT 0;`,
    );
  }
}

// バックフィル対象（is_main 未設定のユーザーで is_active がある行）の確認
if (apply || hasColumn) {
  const pending = await client.execute(`
    SELECT COUNT(*) AS n FROM config_presets p
    WHERE p.is_active = 1
      AND p.is_main = 0
      AND NOT EXISTS (
        SELECT 1 FROM config_presets q WHERE q.user_id = p.user_id AND q.is_main = 1
      );
  `);
  const pendingCount = Number(pending.rows[0]?.n ?? 0);
  console.log(`バックフィル対象（メイン未設定ユーザーのアクティブプリセット）: ${pendingCount} 件`);

  if (apply && pendingCount > 0) {
    const result = await client.execute(`
      UPDATE config_presets SET is_main = 1
      WHERE is_active = 1
        AND is_main = 0
        AND NOT EXISTS (
          SELECT 1 FROM config_presets q
          WHERE q.user_id = config_presets.user_id AND q.is_main = 1
        );
    `);
    console.log(`バックフィル完了: ${result.rowsAffected} 件を is_main = 1 に設定しました。`);
  }
} else {
  const active = await client.execute(
    `SELECT COUNT(*) AS n FROM config_presets WHERE is_active = 1;`,
  );
  console.log(
    `バックフィル予定（is_active=1 の行を is_main=1 に）: ${Number(active.rows[0]?.n ?? 0)} 件`,
  );
}

if (apply) {
  await client.execute(
    `CREATE INDEX IF NOT EXISTS idx_config_presets_is_main ON config_presets (is_main);`,
  );

  // 検証: ユーザーごとに is_main は高々1件
  const dup = await client.execute(`
    SELECT COUNT(*) AS n FROM (
      SELECT user_id FROM config_presets
      WHERE is_main = 1
      GROUP BY user_id
      HAVING COUNT(*) >= 2
    );
  `);
  const dupCount = Number(dup.rows[0]?.n ?? 0);
  if (dupCount > 0) {
    console.error(`❌ is_main が複数あるユーザーが ${dupCount} 人います。確認してください。`);
    process.exit(1);
  }
  console.log("✅ 適用完了（is_main 重複なし）。");
} else {
  console.log("ℹ️  dry-run のため変更していません（--apply 付きで実行すると適用します）。");
}

process.exit(0);
