// 式インデックス idx_paceman_paces_mcid_lower の SQL テキストを drizzle-kit の期待形に
// 張り替える一回限りのスクリプト。
//
// 背景: local.db 上の idx_paceman_paces_mcid_lower は
// `scripts/add-paceman-mcid-lower-index.ts`（バッククォート・ダブルクォートなしの
// `CREATE INDEX idx_paceman_paces_mcid_lower ON paceman_paces (lower(mcid))`）で作成されていた。
// これに対し drizzle-kit（`pnpm gen:test-schema` の出力）が期待する SQL テキストは
// `CREATE INDEX \`idx_paceman_paces_mcid_lower\` ON \`paceman_paces\` (lower("mcid"))`
// （識別子をバッククォート、式内の列参照をダブルクォート）で、sqlite_master.sql のテキストが
// 一致しない。`pnpm db:push` はこのテキスト差分を「変更あり」と判定して再作成を試みるが、
// その再作成文の解釈に失敗し `SQLITE_ERROR: no such column: lower("mcid")` で中断していた。
//
// 対処: 同一の索引（対象列・式は変わらず、SQL テキスト表記のみ）を
// DROP INDEX → CREATE INDEX で張り替える。列データ・行データは一切変更しない
// （索引はクエリ高速化のためだけの副次構造であり、DROP/CREATE してもテーブルの内容は不変）。
//
// 対象は schema.ts 内で `sql` を使う式インデックス全件（現状 idx_paceman_paces_mcid_lower のみ。
// 他に式インデックスが追加された場合はこのスクリプトの TARGETS に追記する）。
//
// 実行:
//   pnpm exec tsx scripts/fix-paceman-expression-index.ts                   # ローカル（.env）に dry-run
//   pnpm exec tsx scripts/fix-paceman-expression-index.ts --apply           # ローカルに適用
//   pnpm exec tsx scripts/fix-paceman-expression-index.ts --remote          # リモート（.env.remote）に dry-run
//   pnpm exec tsx scripts/fix-paceman-expression-index.ts --remote --apply  # リモートに適用（要ユーザー承認）
import { createClient } from "@libsql/client";
import { loadDbEnv } from "./lib/db-env";

const { url, authToken } = loadDbEnv();

const apply = process.argv.includes("--apply");
const client = createClient({ url, authToken });

console.log(`モード: ${apply ? "APPLY（実際に適用します）" : "DRY-RUN（表示のみ・変更なし）"}`);

interface ExpressionIndexTarget {
  name: string;
  table: string;
  // test-schema.sql（drizzle-kit export）が出力する正確な SQL テキスト
  expectedSql: string;
}

const TARGETS: ExpressionIndexTarget[] = [
  {
    name: "idx_paceman_paces_mcid_lower",
    table: "paceman_paces",
    expectedSql:
      'CREATE INDEX `idx_paceman_paces_mcid_lower` ON `paceman_paces` (lower("mcid"))',
  },
];

async function getIndexSql(name: string): Promise<string | null> {
  const res = await client.execute({
    sql: "SELECT sql FROM sqlite_master WHERE type='index' AND name=?;",
    args: [name],
  });
  if (res.rows.length === 0) return null;
  const sql = res.rows[0].sql;
  return sql === null ? null : String(sql);
}

interface Plan {
  target: ExpressionIndexTarget;
  action: "none" | "create" | "recreate";
  actualSql: string | null;
}

const plans: Plan[] = [];
for (const t of TARGETS) {
  const actualSql = await getIndexSql(t.name);
  if (actualSql === null) {
    plans.push({ target: t, action: "create", actualSql });
    console.log(`${t.name}（${t.table}）: 索引が存在しません → 新規作成`);
  } else if (actualSql === t.expectedSql) {
    plans.push({ target: t, action: "none", actualSql });
    console.log(`ℹ️  ${t.name}（${t.table}）: テキストは既に一致しています。`);
  } else {
    plans.push({ target: t, action: "recreate", actualSql });
    console.log(`${t.name}（${t.table}）: テキスト不一致 → DROP → CREATE で張り替えます。`);
    console.log(`  実際  : ${JSON.stringify(actualSql)}`);
    console.log(`  期待  : ${JSON.stringify(t.expectedSql)}`);
  }
}

const pending = plans.filter((p) => p.action !== "none");

if (apply) {
  for (const p of pending) {
    if (p.action === "recreate") {
      await client.execute(`DROP INDEX \`${p.target.name}\``);
    }
    await client.execute(p.target.expectedSql);
  }

  const stillMismatched: string[] = [];
  for (const t of TARGETS) {
    const sql = await getIndexSql(t.name);
    if (sql !== t.expectedSql) stillMismatched.push(t.name);
  }
  if (stillMismatched.length > 0) {
    console.error(`❌ 以下の索引が期待テキストと一致しませんでした: ${stillMismatched.join(", ")}`);
    process.exit(1);
  }
  console.log(`✅ 適用完了（${pending.length}件を張り替え／新規作成。全${TARGETS.length}件がテキスト一致）。`);
} else {
  console.log("実行予定のSQL:");
  if (pending.length === 0) {
    console.log("  （新規に実行するDDLはありません。全て一致済みです）");
  } else {
    for (const p of pending) {
      if (p.action === "recreate") {
        console.log(`  DROP INDEX \`${p.target.name}\`;`);
      }
      console.log(`  ${p.target.expectedSql};`);
    }
  }
  console.log("ℹ️  dry-run のため変更していません（--apply 付きで実行すると適用します）。");
}

process.exit(0);
