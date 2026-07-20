// config_presets の is_active=true が同一ユーザーに複数件存在する状態を修復する一回限りのスクリプト。
// createPreset が既存アクティブを非アクティブ化せずに isActive:true で挿入していたバグ
// （レガシーインポート経由の createPresetFromOnboarding / createPresetFromImport）により
// 重複が発生しうる。updated_at が最新の1件だけを active に残し、他を false にする。
//
// 実行:
//   pnpm exec tsx scripts/fix-duplicate-active-presets.ts                   # ローカル（.env）に dry-run
//   pnpm exec tsx scripts/fix-duplicate-active-presets.ts --apply           # ローカルに修復適用
//   pnpm exec tsx scripts/fix-duplicate-active-presets.ts --remote          # リモート（.env.remote）に dry-run
//   pnpm exec tsx scripts/fix-duplicate-active-presets.ts --remote --apply  # リモートに修復適用
import { createClient } from "@libsql/client";
import { loadDbEnv } from "./lib/db-env";

const { url, authToken } = loadDbEnv();

const apply = process.argv.includes("--apply");
const client = createClient({ url, authToken });

// is_active=true が2件以上のユーザーを抽出
const dupUsers = await client.execute(`
  SELECT user_id, COUNT(*) AS n
  FROM config_presets
  WHERE is_active = 1
  GROUP BY user_id
  HAVING COUNT(*) >= 2
  ORDER BY user_id;
`);

console.log(`モード: ${apply ? "APPLY（実際に修復します）" : "DRY-RUN（表示のみ・変更なし）"}`);
console.log(`対象ユーザー数: ${dupUsers.rows.length}`);

if (dupUsers.rows.length === 0) {
  console.log("✅ アクティブプリセットが重複しているユーザーはいません。");
  process.exit(0);
}

let deactivatedTotal = 0;

for (const row of dupUsers.rows) {
  const userId = String(row.user_id);
  const count = Number(row.n);

  // アクティブなプリセットを新しい順に取得（updated_at 同値の場合は created_at → id で安定化）
  const presets = await client.execute({
    sql: `
      SELECT id, name, updated_at
      FROM config_presets
      WHERE user_id = ? AND is_active = 1
      ORDER BY updated_at DESC, created_at DESC, id ASC;
    `,
    args: [userId],
  });

  // updated_at は drizzle の { mode: "timestamp" }（Unix秒）で保存されている
  const formatTs = (v: unknown) => new Date(Number(v) * 1000).toISOString();

  const [keep, ...rest] = presets.rows;
  console.log(`\nユーザー ${userId}: アクティブ ${count} 件`);
  console.log(`  残す: ${keep.id} 「${keep.name}」 (updated_at=${formatTs(keep.updated_at)})`);
  for (const p of rest) {
    console.log(`  非アクティブ化: ${p.id} 「${p.name}」 (updated_at=${formatTs(p.updated_at)})`);
  }

  if (apply) {
    // 最新の1件（keep.id）以外を非アクティブ化する。updated_at は変更しない（データ保全のため最小限の更新に留める）
    const result = await client.execute({
      sql: "UPDATE config_presets SET is_active = 0 WHERE user_id = ? AND is_active = 1 AND id != ?;",
      args: [userId, String(keep.id)],
    });
    deactivatedTotal += result.rowsAffected;
  } else {
    deactivatedTotal += rest.length;
  }
}

if (apply) {
  // 検証: 修復後に重複が残っていないこと
  const remaining = await client.execute(`
    SELECT COUNT(*) AS n FROM (
      SELECT user_id FROM config_presets
      WHERE is_active = 1
      GROUP BY user_id
      HAVING COUNT(*) >= 2
    );
  `);
  const remainingCount = Number(remaining.rows[0]?.n ?? 0);
  if (remainingCount > 0) {
    console.error(`\n❌ 修復後もアクティブ重複が ${remainingCount} ユーザーに残っています。`);
    process.exit(1);
  }
  console.log(`\n✅ 修復完了: ${deactivatedTotal} 件のプリセットを非アクティブ化しました。`);
} else {
  console.log(
    `\nℹ️  dry-run のため変更していません（--apply 付きで実行すると ${deactivatedTotal} 件を非アクティブ化します）。`,
  );
}

process.exit(0);
