// アクティブ（編集中）プリセットのスナップショットを、ライブテーブルの内容で再同期する
// 一回限りの修復スクリプト。
//
// 背景:
//   「アクティブプリセット = ライブテーブル」は本システムの不変条件だが、
//   syncActivePresetSnapshot（2026-05 導入）より前に行われたライブ設定の編集は
//   スナップショットへ反映されていない。その結果、
//     - 公開一覧（/keybindings, /keybindings/visual）や比較・ガイド埋め込みが
//       「現在適用中でない古い設定」を表示する
//     - そのプリセットを適用し直すと、古い内容でライブ設定が上書きされる（実質のデータ損失）
//   という二つの問題が起きる。前者は表示側（shouldUsePresetSnapshot）で解消済みだが、
//   後者はデータそのものを直す必要があるため、ここでライブ → スナップショットへ再同期する。
//
// 方針:
//   ライブテーブルを唯一の正としてスナップショットを上書きする（逆方向には書かない）。
//   実際の書き込みは本番コードと同じ syncActivePresetSnapshot を使い、内容が変わる
//   ユーザーだけを対象にする（差分が無いプリセットは updated_at も動かさない）。
//
// 実行:
//   pnpm exec tsx scripts/resync-active-preset-snapshots.ts                   # ローカル（.env）に dry-run
//   pnpm exec tsx scripts/resync-active-preset-snapshots.ts --apply           # ローカルに適用
//   pnpm exec tsx scripts/resync-active-preset-snapshots.ts --remote          # リモート（.env.remote）に dry-run
//   pnpm exec tsx scripts/resync-active-preset-snapshots.ts --remote --apply  # リモートに適用
import { eq } from "drizzle-orm";
import { createDb } from "../app/lib/db";
import {
  configPresets,
  keybindings,
  keyRemaps,
  playerConfigs,
  itemLayouts,
  searchCrafts,
  customKeys,
  customActions,
} from "../app/lib/schema";
import {
  serializeKeybindings,
  serializePlayerConfig,
  serializeRemaps,
  serializeItemLayouts,
  serializeSearchCrafts,
  serializeCustomKeys,
  serializeCustomActions,
  syncActivePresetSnapshot,
  type PresetSyncKind,
} from "../app/lib/preset-utils";
import { loadDbEnv } from "./lib/db-env";

const { url, authToken } = loadDbEnv();
const apply = process.argv.includes("--apply");
const db = createDb(url, authToken);

console.log(`モード: ${apply ? "APPLY（実際に再同期します）" : "DRY-RUN（表示のみ・変更なし）"}`);

const actives = await db.query.configPresets.findMany({
  where: eq(configPresets.isActive, true),
  columns: {
    id: true,
    userId: true,
    name: true,
    isMain: true,
    keybindingsData: true,
    playerConfigData: true,
    remapsData: true,
    fingerAssignmentsData: true,
    itemLayoutsData: true,
    searchCraftsData: true,
    customKeysData: true,
    customActionsData: true,
  },
  with: { user: { columns: { slug: true, profileVisibility: true } } },
});

console.log(`アクティブプリセット: ${actives.length} 件\n`);

/**
 * 「内容として同じか」を判定するための正規化。
 * 直列化フォーマットは後から拡張されており（remapType の追加、playerConfig の全項目出力など）、
 * 文字列比較だけでは「中身は同じだが古い書式」と「本当に内容がずれている」を区別できない。
 * null / undefined の項目を落とし、キー順を揃え、既定値を補ってから比較する。
 */
function canonical(kind: PresetSyncKind, json: string | null): string {
  if (json === null) return "null";
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return `broken:${json}`;
  }
  const clean = (obj: unknown): unknown => {
    if (Array.isArray(obj)) return obj.map(clean);
    if (obj && typeof obj === "object") {
      const entries = Object.entries(obj as Record<string, unknown>)
        .filter(([, v]) => v !== null && v !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
      return Object.fromEntries(entries.map(([k, v]) => [k, clean(v)]));
    }
    return obj;
  };
  if (kind === "remaps" && Array.isArray(parsed)) {
    // 旧スナップショットには remapType が無い（読み出し時 "unset" として扱われる）
    parsed = (parsed as Record<string, unknown>[]).map((r) => ({
      ...r,
      remapType: r.remapType ?? "unset",
      outputMode: r.outputMode ?? "key",
    }));
  }
  const cleaned = clean(parsed);
  if (Array.isArray(cleaned)) {
    return JSON.stringify(
      cleaned.map((x) => JSON.stringify(x)).sort(),
    );
  }
  return JSON.stringify(cleaned);
}

let drifted = 0;
let formatOnly = 0;
let resynced = 0;

for (const preset of actives) {
  const userId = preset.userId;

  // ライブテーブルから「同期後にあるべき値」を組み立てる（syncActivePresetSnapshot と同一の規則）
  const [kbRows, cfg, rmRows, ilRows, scRows, ckRows, caRows] = await Promise.all([
    db.query.keybindings.findMany({ where: eq(keybindings.userId, userId) }),
    db.query.playerConfigs.findFirst({ where: eq(playerConfigs.userId, userId) }),
    db.query.keyRemaps.findMany({ where: eq(keyRemaps.userId, userId) }),
    db.query.itemLayouts.findMany({ where: eq(itemLayouts.userId, userId) }),
    db.query.searchCrafts.findMany({ where: eq(searchCrafts.userId, userId) }),
    db.query.customKeys.findMany({ where: eq(customKeys.userId, userId) }),
    db.query.customActions.findMany({ where: eq(customActions.userId, userId) }),
  ]);

  const expected: Record<PresetSyncKind, string | null> = {
    keybindings: kbRows.length > 0 ? serializeKeybindings(kbRows) : null,
    playerConfig: cfg ? serializePlayerConfig(cfg) : null,
    remaps: rmRows.length > 0 ? serializeRemaps(rmRows) : null,
    fingers: cfg?.fingerAssignments ?? null,
    itemLayouts: ilRows.length > 0 ? serializeItemLayouts(ilRows) : null,
    searchCrafts: scRows.length > 0 ? serializeSearchCrafts(scRows) : null,
    customKeys: ckRows.length > 0 ? serializeCustomKeys(ckRows) : null,
    customActions: caRows.length > 0 ? serializeCustomActions(caRows) : null,
  };

  const current: Record<PresetSyncKind, string | null> = {
    keybindings: preset.keybindingsData,
    playerConfig: preset.playerConfigData,
    remaps: preset.remapsData,
    fingers: preset.fingerAssignmentsData,
    itemLayouts: preset.itemLayoutsData,
    searchCrafts: preset.searchCraftsData,
    customKeys: preset.customKeysData,
    customActions: preset.customActionsData,
  };

  const kinds = (Object.keys(expected) as PresetSyncKind[]).filter(
    (kind) => current[kind] !== expected[kind],
  );
  if (kinds.length === 0) continue;

  // 内容までずれている種別（＝公開面に古い設定が出ていた本体の不具合）と、
  // 書式が古いだけの種別（再同期しても見た目は変わらない）を分けて報告する
  const contentKinds = kinds.filter(
    (kind) => canonical(kind, current[kind]) !== canonical(kind, expected[kind]),
  );
  if (contentKinds.length > 0) drifted++;
  else formatOnly++;

  const flags = [preset.isMain ? "メイン" : null, preset.user.profileVisibility]
    .filter(Boolean)
    .join("/");
  console.log(
    `${contentKinds.length > 0 ? "⚠️ 内容差分" : "・書式のみ"} ${preset.user.slug} 「${preset.name}」(${flags})`,
  );
  for (const kind of kinds) {
    const len = (v: string | null) => (v === null ? "なし" : `${v.length}文字`);
    const mark = contentKinds.includes(kind) ? "内容差分" : "書式のみ";
    console.log(
      `   ${kind}[${mark}]: スナップショット=${len(current[kind])} → ライブ=${len(expected[kind])}`,
    );
  }

  if (apply) {
    await syncActivePresetSnapshot(db, userId, kinds);
    resynced++;
  }
}

console.log(
  `\n内容差分あり: ${drifted} 件 / 書式のみ古い: ${formatOnly} 件${
    apply ? ` — 再同期済み: ${resynced} 件` : "（dry-run のため変更していません）"
  }`,
);
process.exit(0);
