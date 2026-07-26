// Vercel Blob の孤児（DB から参照されていないファイル）を実測する読み取り専用スクリプト。
//
// 背景: del() を呼んでいるのはカスタムスキンの差し替え/削除と、ガイド削除時のカバー画像だけ。
// 本文画像・差し替え前のカバー・ドラフトのカバーは削除経路が無く、参照されなくなっても
// Blob に残り続ける（docs/guides.md「画像アップロード」参照）。
//
// **このスクリプトは何も削除しない。** 削除は delete-orphan-blobs.ts（--apply 必須）。
// 参照判定は両者で lib/blob-refs.ts を共有している。
//
// 実行:
//   pnpm exec tsx scripts/audit-orphan-blobs.ts            # ローカル DB（.env）と突き合わせ
//   pnpm exec tsx scripts/audit-orphan-blobs.ts --remote   # 本番 DB（.env.remote）と突き合わせ
//   pnpm exec tsx scripts/audit-orphan-blobs.ts --remote --json > orphans.json
//
// 注意: Blob の接続先は常に .env の BLOB_READ_WRITE_TOKEN（ストアは 1 つ）。
// --remote は DB 側だけを切り替える。ローカル DB と突き合わせると本番の Blob が
// ほぼ全部孤児に見えるので、実測は --remote で行うこと。
import { resolve } from "node:path";
import { config } from "dotenv";
import { createClient } from "@libsql/client";
import { loadDbEnv } from "./lib/db-env";
import {
  collectReferences,
  listAllBlobs,
  findOrphans,
  formatBytes,
  printByCategory,
  requireBlobToken,
  runScript,
} from "./lib/blob-refs";

// BLOB_READ_WRITE_TOKEN は .env にしか無い。loadDbEnv() は --remote のとき
// .env.remote だけを読むので、先にここで .env を読んでおく
// （TURSO_* は後続の loadDbEnv() が override:true で上書きする）。
config({ path: resolve(process.cwd(), ".env"), quiet: true });

const asJson = process.argv.includes("--json");
const { url, authToken } = loadDbEnv();
const token = requireBlobToken();


const client = createClient({ url, authToken });

await runScript(client, async () => {
  const scan = await collectReferences(client);
  console.log(
    `\nDB: ガイド ${scan.guideCount} 件 / スキン ${scan.skinCount} 件 → 参照パス ${scan.referenced.size} 個`,
  );

  const blobs = await listAllBlobs(token, (count) =>
    process.stdout.write(`\rBlob 列挙中... ${count} 件`),
  );
  console.log(`\rBlob: ${blobs.length} 件を列挙しました${" ".repeat(20)}\n`);

  const report = findOrphans(blobs, scan.referenced);

  if (asJson) {
    console.log(
      JSON.stringify(
        {
          summary: {
            blobs: report.blobCount,
            totalBytes: report.totalBytes,
            referencedBytes: report.referencedBytes,
            orphans: report.orphans.length,
            orphanBytes: report.orphanBytes,
            orphanRatio: report.orphanRatio,
          },
          orphans: report.orphans.map((o) => ({ ...o, uploadedAt: o.uploadedAt.toISOString() })),
          brokenReferences: report.broken,
        },
        null,
        2,
      ),
    );
    return 0;
  }

  const pct = (report.orphanRatio * 100).toFixed(1);
  console.log("═".repeat(64));
  console.log(`合計          : ${report.blobCount} 件 / ${formatBytes(report.totalBytes)}`);
  console.log(
    `参照あり      : ${report.blobCount - report.orphans.length} 件 / ${formatBytes(report.referencedBytes)}`,
  );
  console.log(
    `孤児          : ${report.orphans.length} 件 / ${formatBytes(report.orphanBytes)}（全体の ${pct}%）`,
  );
  console.log("═".repeat(64));

  console.log("\n【分類別の孤児】");
  printByCategory(report.orphans);

  console.log("\n【孤児の経過日数】（--min-age-days を決める材料）");
  for (const [label, min, max] of [
    ["24時間以内", 0, 1],
    ["1〜7日", 1, 7],
    ["7〜30日", 7, 30],
    ["30日超", 30, Infinity],
  ] as [string, number, number][]) {
    const rows = report.orphans.filter((o) => o.ageDays >= min && o.ageDays < max);
    if (rows.length === 0) continue;
    const bytes = rows.reduce((sum, o) => sum + o.size, 0);
    console.log(`  ${label.padEnd(20)} ${String(rows.length).padStart(5)} 件 / ${formatBytes(bytes)}`);
  }

  const largest = [...report.orphans].sort((a, b) => b.size - a.size).slice(0, 15);
  if (largest.length > 0) {
    console.log("\n【サイズ上位の孤児】");
    for (const o of largest) {
      console.log(`  ${formatBytes(o.size).padStart(10)}  ${o.ageDays}日前  ${o.pathname}`);
    }
  }

  if (report.broken.length > 0) {
    console.log(`\n⚠️  DB が参照しているのに Blob に存在しないパス: ${report.broken.length} 件`);
    console.log("   （表示が壊れている可能性があります。孤児より優先して調査してください）");
    for (const pathname of report.broken.slice(0, 20)) console.log(`   - ${pathname}`);
    if (report.broken.length > 20) console.log(`   ... 他 ${report.broken.length - 20} 件`);
  }

  console.log("\nℹ️  読み取りのみのスクリプトです。削除は行っていません。");
  return 0;
});
