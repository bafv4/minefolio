// Vercel Blob の孤児（DB から参照されていないファイル）を削除するスクリプト。
// cron ではなく、必要になったときに手で実行する運用。
//
// **既定は dry-run。--apply を付けたときだけ実際に削除する。**
// 参照判定は audit-orphan-blobs.ts と共通（lib/blob-refs.ts）。
//
// 実行:
//   pnpm exec tsx scripts/delete-orphan-blobs.ts --remote                    # 削除対象の確認（変更なし）
//   pnpm exec tsx scripts/delete-orphan-blobs.ts --remote --apply            # 実際に削除
//   pnpm exec tsx scripts/delete-orphan-blobs.ts --remote --min-age-days=30  # 30日より古いものだけ
//   pnpm exec tsx scripts/delete-orphan-blobs.ts --remote --category=guideCover
//
// オプション:
//   --apply              実際に削除する（省略時は dry-run）
//   --remote             DB を .env.remote（本番）にする。Blob は常に .env のトークン
//   --min-age-days=N     アップロードから N 日未満のものは削除しない（既定 7）
//   --max-delete=N       1 回の実行で削除する上限（既定 500）
//   --category=a,b       対象を分類で絞る（guideInline / guideCover / skin / unknown）
//   --max-orphan-ratio=R 孤児の割合がこれを超えたら中断（既定 0.6）
//   --allow-broken-refs  壊れた参照があっても続行する（既定は中断）
//
// ── なぜこれだけガードがあるか ──────────────────────────
// 参照の抽出漏れは「生きている画像の削除」に直結し、Blob の削除は取り消せない。
// 特に危険なのが **DB の取り違え**（本番 Blob をローカル DB と突き合わせる）で、
// この場合ほぼ全件が孤児に見える。--max-orphan-ratio はそれを機械的に止めるための線。
// 猶予期間（--min-age-days）は「アップロードしたがまだ保存していない編集中の画像」を守る。
import { resolve } from "node:path";
import { config } from "dotenv";
import { createClient } from "@libsql/client";
import { del } from "@vercel/blob";
import { loadDbEnv } from "./lib/db-env";
import {
  collectReferences,
  listAllBlobs,
  findOrphans,
  formatBytes,
  printByCategory,
  requireBlobToken,
  runScript,
  numberArg,
  argValue,
  CATEGORY_LABEL,
  type BlobCategory,
  type OrphanBlob,
} from "./lib/blob-refs";

// BLOB_READ_WRITE_TOKEN は .env にしかない（loadDbEnv は --remote だと .env.remote だけを読む）
config({ path: resolve(process.cwd(), ".env"), quiet: true });

const apply = process.argv.includes("--apply");
const remote = process.argv.includes("--remote");
const minAgeDays = numberArg("min-age-days", 7);
const maxDelete = numberArg("max-delete", 500);
const maxOrphanRatio = numberArg("max-orphan-ratio", 0.6);
const allowBrokenRefs = process.argv.includes("--allow-broken-refs");

const categoryFilter = argValue("category")
  ?.split(",")
  .map((s) => s.trim())
  .filter(Boolean) as BlobCategory[] | undefined;

const VALID_CATEGORIES = Object.keys(CATEGORY_LABEL) as BlobCategory[];
if (categoryFilter?.some((c) => !VALID_CATEGORIES.includes(c))) {
  console.error(`❌ --category に不正な値があります。指定できるのは: ${VALID_CATEGORIES.join(" / ")}`);
  process.exit(1);
}

const { url, authToken } = loadDbEnv();
const token = requireBlobToken();

console.log(`モード: ${apply ? "APPLY（実際に削除します）" : "DRY-RUN（表示のみ・削除なし）"}`);
console.log(`猶予期間: ${minAgeDays} 日未満のファイルは対象外`);
if (categoryFilter) console.log(`対象分類: ${categoryFilter.join(", ")}`);
if (!remote) {
  console.log(
    "\n⚠️  --remote が指定されていません。Blob は常に .env のストア（＝本番）を見ますが、\n" +
      "   DB はローカルを見ています。本番 Blob を消すつもりなら --remote を付けてください。",
  );
}

// ── 1) 現状の把握 ────────────────────────────────────

const client = createClient({ url, authToken });

await runScript(client, async () => {
  const scan = await collectReferences(client);
  console.log(
    `\nDB: ガイド ${scan.guideCount} 件 / スキン ${scan.skinCount} 件 → 参照パス ${scan.referenced.size} 個`,
  );

  // DB が空＝接続先を間違えている可能性が高い。ここで止めないと全件削除になる
  if (scan.guideCount === 0) {
    console.error(
      "\n❌ 中断: guides テーブルが 0 件です。接続先の DB が想定と違う可能性があります。\n" +
        "   本番を対象にする場合は --remote を付けてください。",
    );
    return 1;
  }

  const blobs = await listAllBlobs(token, (count) =>
    process.stdout.write(`\rBlob 列挙中... ${count} 件`),
  );
  console.log(`\rBlob: ${blobs.length} 件を列挙しました${" ".repeat(20)}`);

  const report = findOrphans(blobs, scan.referenced);
  console.log(
    `\n孤児: ${report.orphans.length} 件 / ${formatBytes(report.orphanBytes)}` +
      `（全体の ${(report.orphanRatio * 100).toFixed(1)}%）`,
  );

  // ── 2) 安全確認 ──────────────────────────────────────
  // 壊れた参照がある = DB と Blob の状態が食い違っている。原因が分かるまで削除しない
  if (report.broken.length > 0 && !allowBrokenRefs) {
    console.error(
      `\n❌ 中断: DB が参照しているのに Blob に存在しないパスが ${report.broken.length} 件あります。`,
    );
    console.error("   参照の抽出や突き合わせがずれている可能性があります。先に調査してください:");
    for (const pathname of report.broken.slice(0, 10)) console.error(`   - ${pathname}`);
    if (report.broken.length > 10) console.error(`   ... 他 ${report.broken.length - 10} 件`);
    console.error("   意図的に無視する場合のみ --allow-broken-refs を付けてください。");
    return 1;
  }

  // 孤児の割合が異常に高い = 参照を拾えていない（DB の取り違え等）疑いが濃い
  if (report.orphanRatio > maxOrphanRatio) {
    console.error(
      `\n❌ 中断: 孤児の割合 ${(report.orphanRatio * 100).toFixed(1)}% が上限 ` +
        `${(maxOrphanRatio * 100).toFixed(1)}% を超えています。`,
    );
    console.error(
      "   参照を正しく拾えていない可能性があります（DB の取り違えが最も多い原因です）。\n" +
        "   意図した状態なら --max-orphan-ratio=<割合> で上限を上げてください。",
    );
    return 1;
  }

  // ── 3) 削除対象の絞り込み ────────────────────────────
  const tooNew: OrphanBlob[] = [];
  const filteredOut: OrphanBlob[] = [];
  let targets: OrphanBlob[] = [];

  for (const orphan of report.orphans) {
    if (orphan.ageDays < minAgeDays) {
      tooNew.push(orphan);
    } else if (categoryFilter && !categoryFilter.includes(orphan.category)) {
      filteredOut.push(orphan);
    } else {
      targets.push(orphan);
    }
  }

  // 古いものから消す（新しいほど「まだ使うかもしれない」ため）
  targets.sort((a, b) => b.ageDays - a.ageDays);

  let capped = 0;
  if (targets.length > maxDelete) {
    capped = targets.length - maxDelete;
    targets = targets.slice(0, maxDelete);
  }

  console.log("\n" + "═".repeat(64));
  console.log(`削除対象      : ${targets.length} 件 / ${formatBytes(targets.reduce((s, o) => s + o.size, 0))}`);
  if (tooNew.length > 0) {
    console.log(`  猶予期間内で除外: ${tooNew.length} 件 / ${formatBytes(tooNew.reduce((s, o) => s + o.size, 0))}`);
  }
  if (filteredOut.length > 0) {
    console.log(`  分類フィルタで除外: ${filteredOut.length} 件`);
  }
  if (capped > 0) {
    console.log(`  上限(--max-delete=${maxDelete})で今回見送り: ${capped} 件（再実行で続きを処理できます）`);
  }
  console.log("═".repeat(64));

  if (targets.length === 0) {
    console.log("\n削除対象はありません。");
    return 0;
  }

  console.log("\n【削除対象の分類】");
  printByCategory(targets);

  console.log("\n【削除対象の一覧】");
  const PREVIEW = 60;
  for (const orphan of targets.slice(0, PREVIEW)) {
    console.log(`  ${formatBytes(orphan.size).padStart(10)}  ${String(orphan.ageDays).padStart(4)}日前  ${orphan.pathname}`);
  }
  if (targets.length > PREVIEW) {
    console.log(`  ... 他 ${targets.length - PREVIEW} 件（全件は audit-orphan-blobs.ts --json で確認できます）`);
  }

  // ── 4) 削除 ──────────────────────────────────────────
  if (!apply) {
    console.log("\nℹ️  dry-run のため削除していません（--apply 付きで実行すると削除します）。");
    return 0;
  }

  // del() は配列を受け取れる。1 件ずつだとリクエストが多くなるためまとめて送る
  const BATCH_SIZE = 100;
  let deleted = 0;
  let failed = 0;

  for (let i = 0; i < targets.length; i += BATCH_SIZE) {
    const batch = targets.slice(i, i + BATCH_SIZE);
    try {
      await del(batch.map((o) => o.url), { token });
      deleted += batch.length;
    } catch (e) {
      // バッチ単位で失敗しても残りは続行する（失敗分は再実行で拾える）
      failed += batch.length;
      console.error(`\n⚠️  ${batch.length} 件の削除に失敗しました: ${String(e)}`);
    }
    process.stdout.write(`\r削除中... ${deleted + failed}/${targets.length}`);
  }

  console.log(`\n\n✅ 削除完了: ${deleted} 件 / ${formatBytes(targets.reduce((s, o) => s + o.size, 0))}`);
  if (failed > 0) {
    console.log(`⚠️  失敗: ${failed} 件（再実行で再度対象になります）`);
  }
  console.log("ℹ️  結果は audit-orphan-blobs.ts --remote で確認できます。");
  return failed > 0 ? 1 : 0;
});
