/**
 * マイグレーションスクリプト: 既存のアイテム配置とサーチクラフトをアクティブなプリセットに関連付ける
 *
 * 使用方法:
 *   ローカルDB: pnpm tsx scripts/migrate-preset-data.ts
 *   本番DB:     TURSO_DATABASE_URL=... TURSO_AUTH_TOKEN=... pnpm tsx scripts/migrate-preset-data.ts
 *
 * このスクリプトは以下を行います:
 * 1. アクティブなプリセットを持つ全ユーザーを取得
 * 2. 各ユーザーのアイテム配置とサーチクラフトをJSON化
 * 3. アクティブなプリセットのitem_layouts_dataとsearch_crafts_dataを更新
 */

import { createDb } from "../app/lib/db";
import { eq } from "drizzle-orm";
import * as schema from "../app/lib/schema";

// 環境変数からDB接続情報を取得（ない場合はローカルDBを使用）
const TURSO_DATABASE_URL = process.env.TURSO_DATABASE_URL;

if (TURSO_DATABASE_URL) {
  console.log("Using remote Turso database");
} else {
  console.log("Using local database (file:local.db)");
}

const db = createDb(TURSO_DATABASE_URL);

async function migratePresetData() {
  console.log("Starting preset data migration...\n");

  // アクティブなプリセットを持つ全ユーザーを取得
  const activePresets = await db.query.configPresets.findMany({
    where: eq(schema.configPresets.isActive, true),
  });

  console.log(`Found ${activePresets.length} active presets to migrate\n`);

  let migratedCount = 0;
  let skippedCount = 0;

  for (const preset of activePresets) {
    const userId = preset.userId;

    // このユーザーのアイテム配置を取得
    const itemLayouts = await db.query.itemLayouts.findMany({
      where: eq(schema.itemLayouts.userId, userId),
    });

    // このユーザーのサーチクラフトを取得
    const searchCrafts = await db.query.searchCrafts.findMany({
      where: eq(schema.searchCrafts.userId, userId),
    });

    // 既にデータがある場合はスキップ
    if (preset.itemLayoutsData && preset.searchCraftsData) {
      console.log(`Skipping preset "${preset.name}" (${preset.id}) - already has data`);
      skippedCount++;
      continue;
    }

    // JSON化
    const itemLayoutsData = itemLayouts.length > 0
      ? JSON.stringify(itemLayouts.map((l) => ({
          segment: l.segment,
          slots: l.slots,
          offhand: l.offhand,
          notes: l.notes,
          displayOrder: l.displayOrder,
        })))
      : null;

    const searchCraftsData = searchCrafts.length > 0
      ? JSON.stringify(searchCrafts.map((c) => ({
          sequence: c.sequence,
          items: c.items,
          keys: c.keys,
          searchStr: c.searchStr,
          comment: c.comment,
        })))
      : null;

    // プリセットを更新
    await db
      .update(schema.configPresets)
      .set({
        itemLayoutsData: preset.itemLayoutsData ?? itemLayoutsData,
        searchCraftsData: preset.searchCraftsData ?? searchCraftsData,
        updatedAt: new Date(),
      })
      .where(eq(schema.configPresets.id, preset.id));

    console.log(`Migrated preset "${preset.name}" (${preset.id})`);
    console.log(`  - Item layouts: ${itemLayouts.length} entries`);
    console.log(`  - Search crafts: ${searchCrafts.length} entries`);
    migratedCount++;
  }

  console.log(`\nMigration complete!`);
  console.log(`  - Migrated: ${migratedCount}`);
  console.log(`  - Skipped: ${skippedCount}`);
}

migratePresetData()
  .then(() => {
    console.log("\nDone!");
    process.exit(0);
  })
  .catch((error) => {
    console.error("Migration failed:", error);
    process.exit(1);
  });
