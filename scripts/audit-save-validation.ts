// 保存まわりの検証・上限（2026-11 の監査で追加）に、既存データが引っかからないかを調べる読み取り専用スクリプト。
//
// 背景: 保存時の検証を厳しくし、件数・文字数の上限（app/lib/save-limits.ts）と、スキン・マントの Blob の
// 所有判定（app/lib/blob-url.ts）を入れた。既存の行がこれらに合わないと、その走者は以後その画面を
// 保存できなくなる（または Blob を消せなくなる）。デプロイ前に、該当する行が無いかを確かめる。
//
// 書き込みは一切しない（SELECT のみ。読み取り専用トランザクションの中で実行する）。
// 出力は件数・最大値・内部 ID（users.id）だけ。名前・MCID・URL などは出さない。
//
// 実行:
//   pnpm exec tsx scripts/audit-save-validation.ts            # ローカル(.env)
//   pnpm exec tsx scripts/audit-save-validation.ts --remote   # リモート(.env.remote)。読み取りのみ
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@libsql/client";
import { loadDbEnv } from "./lib/db-env";
import { SAVE_LIMITS } from "../app/lib/save-limits";
import { validateFingerAssignmentsJson } from "../app/lib/finger-assignments";
import { SEARCH_CRAFT_TIMINGS, MAX_LOOP_STEPS } from "../app/lib/search-craft-templates";
import { PROFILE_TAB_VALUES } from "../app/lib/profile-tabs";
import { normalizeGameLanguage } from "../app/lib/game-languages";
import { isOwnTextureBlobUrl, storeIdFromBlobToken, parseVercelBlobUrl } from "../app/lib/blob-url";

const { url, authToken } = loadDbEnv();
const client = createClient({ url, authToken });

/** 内部 ID の一覧を短く出す（最大5件） */
const ids = (list: string[]) => (list.length === 0 ? "" : ` ids=[${list.slice(0, 5).join(", ")}${list.length > 5 ? ", …" : ""}]`);
const mark = (bad: number) => (bad === 0 ? "OK " : "NG ");

function tokenFromEnvFile(file: string): string | null {
  const path = resolve(process.cwd(), file);
  if (!existsSync(path)) return null;
  const match = readFileSync(path, "utf8").match(/^BLOB_READ_WRITE_TOKEN=(.*)$/m);
  return match ? match[1].trim().replace(/^["']|["']$/g, "") : null;
}

async function main() {
  // 読み取り専用トランザクション（この中の書き込みはエラーになる）
  const tx = await client.transaction("read");
  const q = async (sql: string, args: (string | number)[] = []) => (await tx.execute({ sql, args })).rows;

  try {
    const userCount = Number((await q("select count(*) as c from users"))[0].c);
    console.log(`\n走者数: ${userCount}`);

    // ── 1. スキン・マントの Blob の所有判定 ─────────────────────────────
    console.log("\n== 1. スキン・マントの Blob（自分のストア・自分のディレクトリ配下か） ==");
    const storeIds = new Map<string, string>();
    for (const [label, file] of [["ローカルの .env", ".env"], [".env.remote", ".env.remote"]] as const) {
      const token = tokenFromEnvFile(file);
      const storeId = token ? storeIdFromBlobToken(token) : "";
      console.log(`  ${label} のトークン: ${token ? `あり（ストア ID ${storeId ? `${storeId.length}文字` : "取得できず"}）` : "なし"}`);
      if (storeId) storeIds.set(label, storeId.toLowerCase());
    }
    const textureRows = await q(
      "select id, custom_skin_url as skin, custom_cape_url as cape from users where custom_skin_url is not null or custom_cape_url is not null",
    );
    for (const kind of ["skin", "cape"] as const) {
      const rows = textureRows.filter((r) => r[kind]);
      const hosts = new Map<string, number>();
      const notBlob: string[] = [];
      const notOwnPath: string[] = [];
      for (const r of rows) {
        const value = String(r[kind]);
        const safe = parseVercelBlobUrl(value);
        if (!safe) {
          notBlob.push(String(r.id));
          continue;
        }
        const host = new URL(safe).hostname.toLowerCase();
        hosts.set(host, (hosts.get(host) ?? 0) + 1);
        // ストアは別に集計するので、ここではパスだけを見る
        if (!isOwnTextureBlobUrl(value, { userId: String(r.id), kind })) notOwnPath.push(String(r.id));
      }
      console.log(`  [${kind}] URL を持つ走者: ${rows.length}`);
      console.log(`    ${mark(notBlob.length)}Vercel Blob の URL でない: ${notBlob.length}${ids(notBlob)}`);
      console.log(`    ${mark(notOwnPath.length)}自分のディレクトリ配下でない: ${notOwnPath.length}${ids(notOwnPath)}`);
      let hostIndex = 0;
      for (const [host, count] of hosts) {
        hostIndex++;
        const label = host.split(".")[0];
        const matches = [...storeIds].map(([name, id]) => `${name}: ${label === id ? "一致" : "不一致"}`).join(" / ");
        const shape = host.endsWith(".public.blob.vercel-storage.com") ? "<id>.public.blob.vercel-storage.com" : "それ以外の形";
        console.log(`    ホスト#${hostIndex}（${shape}、ID ${label.length}文字）: ${count}件 … トークンから導いたストア ID と ${matches || "照合不可（トークンなし）"}`);
      }
    }

    // ── 2. 件数の上限 ────────────────────────────────────────────────
    console.log("\n== 2. 1走者あたりの件数（上限を超える走者がいるか） ==");
    const countLimits: Array<[string, string, number, string?]> = [
      ["プリセット", "config_presets", SAVE_LIMITS.presetsPerUser],
      ["リマップ", "key_remaps", SAVE_LIMITS.remaps],
      ["カスタムキー", "custom_keys", SAVE_LIMITS.customKeys],
      ["カスタムアクション", "custom_actions", SAVE_LIMITS.customActions],
      ["キーバインド", "keybindings", SAVE_LIMITS.keybindingUpdates],
      ["アイテム配置", "item_layouts", SAVE_LIMITS.itemLayouts],
      ["サーチクラフト", "search_crafts", SAVE_LIMITS.searchCrafts],
      ["Loop", "search_craft_loops", SAVE_LIMITS.searchCraftLoops],
      ["ソーシャルリンク", "social_links", 50],
    ];
    for (const [label, table, limit] of countLimits) {
      const rows = await q(`select user_id, count(*) as c from ${table} group by user_id order by c desc`);
      const max = rows.length ? Number(rows[0].c) : 0;
      const over = rows.filter((r) => Number(r.c) > limit).map((r) => String(r.user_id));
      console.log(`  ${mark(over.length)}${label}: 最大 ${max} / 上限 ${limit} … 超過 ${over.length}人${ids(over)}`);
    }

    // ── 3. 文字数の上限 ──────────────────────────────────────────────
    console.log("\n== 3. 文字数（上限を超える行があるか） ==");
    const lengthLimits: Array<[string, string, string, number, string?]> = [
      ["プリセット名", "config_presets", "name", SAVE_LIMITS.presetName],
      ["プリセットの説明", "config_presets", "description", SAVE_LIMITS.presetDescription],
      ["リマップ 変更元", "key_remaps", "source_key", SAVE_LIMITS.shortText],
      ["リマップ 変更先", "key_remaps", "target_key", SAVE_LIMITS.shortText],
      ["リマップ ソフト名", "key_remaps", "software", SAVE_LIMITS.shortText],
      ["リマップ 出力文字", "key_remaps", "output_character", SAVE_LIMITS.shortText],
      ["リマップ メモ", "key_remaps", "notes", SAVE_LIMITS.memo],
      ["カスタムキー コード", "custom_keys", "key_code", SAVE_LIMITS.shortText],
      ["カスタムキー 名前", "custom_keys", "key_name", SAVE_LIMITS.shortText],
      ["カスタムアクション 名前", "custom_actions", "action_name", SAVE_LIMITS.shortText],
      ["カスタムアクション 説明", "custom_actions", "description", SAVE_LIMITS.memo],
      ["カスタムアクション トリガー", "custom_actions", "trigger_key", SAVE_LIMITS.shortText],
      ["キーバインド キーコード", "keybindings", "key_code", SAVE_LIMITS.shortText],
      ["アイテム配置 セグメント名", "item_layouts", "segment", SAVE_LIMITS.segmentName],
      ["アイテム配置 メモ", "item_layouts", "notes", SAVE_LIMITS.layoutNotes],
      ["サーチクラフト コメント（保存値と同じなら通る）", "search_crafts", "comment", SAVE_LIMITS.craftComment],
      ["サーチクラフト サーチ文字列", "search_crafts", "search_str", SAVE_LIMITS.craftSearchString],
      ["Loop コメント（保存値と同じなら通る）", "search_craft_loops", "comment", SAVE_LIMITS.craftComment],
      ["デバイス キーボードのモデル", "player_configs", "keyboard_model", SAVE_LIMITS.keyboardModel],
      ["デバイス マウスのモデル", "player_configs", "mouse_model", SAVE_LIMITS.mouseModel],
      ["デバイス メモ", "player_configs", "notes", SAVE_LIMITS.deviceNotes],
      ["カスタムリンク 表示名", "social_links", "custom_label", 100],
      ["カスタムリンク URL", "social_links", "custom_url", 2000],
      ["記録 動画 URL", "category_records", "pb_video_url", 2000],
    ];
    for (const [label, table, column, limit] of lengthLimits) {
      const rows = await q(
        `select coalesce(max(length(${column})), 0) as m, coalesce(sum(case when length(${column}) > ? then 1 else 0 end), 0) as over from ${table}`,
        [limit],
      );
      const over = Number(rows[0].over);
      console.log(`  ${mark(over)}${label}: 最大 ${Number(rows[0].m)} / 上限 ${limit} … 超過 ${over}行`);
    }

    // ── 4. 値の形・許可リスト ────────────────────────────────────────
    console.log("\n== 4. 値の形・許可リスト（合わない行は、送り返したときに保存が拒否されうる） ==");
    const report = (label: string, bad: string[], note = "") =>
      console.log(`  ${mark(bad.length)}${label}: ${bad.length}件${ids([...new Set(bad)])}${note ? ` … ${note}` : ""}`);

    // 既定タブ（/me/account が保存値をそのまま送り返す）
    const tabs = await q("select id, default_profile_tab as v from users where default_profile_tab is not null");
    report(
      "既定タブが定義に無い",
      tabs.filter((r) => !(PROFILE_TAB_VALUES as readonly string[]).includes(String(r.v))).map((r) => String(r.id)),
    );

    // カスタムキー・カスタムアクション
    const keys = await q("select user_id, key_code, key_name, category from custom_keys");
    report("カスタムキーの種別が定義に無い", keys.filter((r) => !["mouse", "keyboard", "controller"].includes(String(r.category))).map((r) => String(r.user_id)));
    const emptyKeys = keys.filter((r) => !r.key_code || !r.key_name);
    report(
      "カスタムキーのコードか名前が空",
      emptyKeys.map((r) => String(r.user_id)),
      `保存値と同じなら通るので、保存は妨げない${emptyKeys.length ? `。内訳: ${emptyKeys.map((r) => `コード${r.key_code ? "あり" : "空"}・名前${r.key_name ? "あり" : "空"}・種別 ${r.category}`).join(" / ")}` : ""}`,
    );
    const actions = await q("select user_id, action_name, category from custom_actions");
    report("カスタムアクションの種別が定義に無い", actions.filter((r) => !["other", "macro", "tool"].includes(String(r.category))).map((r) => String(r.user_id)));
    report("カスタムアクションの名前が空", actions.filter((r) => !r.action_name).map((r) => String(r.user_id)));

    // サーチクラフト・Loop
    const timings = SEARCH_CRAFT_TIMINGS as readonly string[];
    const crafts = await q("select user_id, items, timing, search_variations from search_crafts");
    report(
      "サーチクラフトの区間が定義に無い",
      crafts.filter((r) => r.timing != null && r.timing !== "" && !timings.includes(String(r.timing))).map((r) => String(r.user_id)),
      "保存値と同じなら通るので、保存は妨げない",
    );
    const badItems: string[] = [];
    const badVariations: string[] = [];
    for (const r of crafts) {
      try {
        const items = JSON.parse(String(r.items ?? "[]"));
        if (!Array.isArray(items) || items.length > SAVE_LIMITS.craftItems || !items.every((i) => typeof i === "string" && i.length <= SAVE_LIMITS.shortText)) {
          badItems.push(String(r.user_id));
        }
      } catch {
        badItems.push(String(r.user_id));
      }
      if (r.search_variations != null) {
        try {
          const variations = JSON.parse(String(r.search_variations));
          if (Array.isArray(variations) && variations.some((v) => typeof v?.str === "string" && v.str.length > SAVE_LIMITS.craftSearchString)) {
            badVariations.push(String(r.user_id));
          }
        } catch {
          badVariations.push(String(r.user_id));
        }
      }
    }
    report("サーチクラフトのアイテムが文字列の配列でない／多すぎる", badItems);
    report("サーチクラフトのバリエーションが長すぎる／壊れている", badVariations);
    const loops = await q("select user_id, steps, timing from search_craft_loops");
    report(
      "Loop の区間が定義に無い",
      loops.filter((r) => r.timing != null && r.timing !== "" && !timings.includes(String(r.timing))).map((r) => String(r.user_id)),
      "保存値と同じなら通るので、保存は妨げない",
    );
    report(
      `Loop のステップが ${MAX_LOOP_STEPS} を超える／壊れている`,
      loops
        .filter((r) => {
          try {
            const steps = JSON.parse(String(r.steps ?? "[]"));
            return !Array.isArray(steps) || steps.length > MAX_LOOP_STEPS;
          } catch {
            return true;
          }
        })
        .map((r) => String(r.user_id)),
    );

    // アイテム配置（セグメント名の空・重複、スロットの形）
    const layouts = await q("select user_id, segment, slots, offhand from item_layouts");
    const segmentsByUser = new Map<string, string[]>();
    const badSlots: string[] = [];
    const isItemList = (v: unknown) =>
      Array.isArray(v) && v.length <= SAVE_LIMITS.itemsPerSlot && v.every((i) => typeof i === "string" && i.length <= SAVE_LIMITS.shortText);
    for (const r of layouts) {
      const user = String(r.user_id);
      segmentsByUser.set(user, [...(segmentsByUser.get(user) ?? []), String(r.segment ?? "").trim().toLowerCase()]);
      try {
        const slots = JSON.parse(String(r.slots ?? "[]"));
        const offhand = JSON.parse(String(r.offhand ?? "[]"));
        const slotsOk =
          Array.isArray(slots) &&
          slots.length <= SAVE_LIMITS.itemSlotsPerLayout &&
          slots.every((s) => s && typeof s === "object" && Number.isInteger(s.slot) && isItemList(s.items));
        if (!slotsOk || !isItemList(offhand)) badSlots.push(user);
      } catch {
        badSlots.push(user);
      }
    }
    report(
      "アイテム配置のセグメント名が空か重複",
      [...segmentsByUser].filter(([, list]) => list.some((s) => !s) || new Set(list).size !== list.length).map(([user]) => user),
    );
    report("アイテム配置のスロット・オフハンドの形が合わない", badSlots);

    // 指割り当て（読み取り側で直すので保存は妨げない。直す前は描画が落ちた行）
    const liveFingers = await q("select user_id, finger_assignments as v from player_configs where finger_assignments is not null");
    report(
      "指割り当て（ライブ）が不正な形",
      liveFingers.filter((r) => validateFingerAssignmentsJson(String(r.v)) === null).map((r) => String(r.user_id)),
      "読み取り時に不正な項目を落とすので、描画も保存も妨げない",
    );
    const presetFingers = await q("select user_id, finger_assignments_data as v from config_presets where finger_assignments_data is not null");
    report(
      "指割り当て（プリセットのスナップショット）が不正な形",
      presetFingers.filter((r) => validateFingerAssignmentsJson(String(r.v)) === null).map((r) => String(r.user_id)),
      "同上",
    );

    // デバイス
    const configs = await q("select user_id, game_language as lang, fov, gui_scale as gui from player_configs");
    const unknownLangs = configs.filter((r) => r.lang != null && r.lang !== "" && normalizeGameLanguage(r.lang) === null);
    const langCounts = new Map<string, number>();
    for (const r of unknownLangs) langCounts.set(String(r.lang), (langCounts.get(String(r.lang)) ?? 0) + 1);
    report(
      "ゲーム言語が許可リストに無い",
      unknownLangs.map((r) => String(r.user_id)),
      `保存値と同じなら通るので、保存は妨げない。値: ${[...langCounts].map(([v, c]) => `${JSON.stringify(v)}×${c}`).join(", ")}`,
    );
    report(
      "ゲーム言語が大文字小文字だけ違う（保存で小文字に直る）",
      configs
        .filter((r) => r.lang != null && normalizeGameLanguage(r.lang) !== null && normalizeGameLanguage(r.lang) !== r.lang)
        .map((r) => String(r.user_id)),
    );
    const badFov = configs.filter((r) => r.fov != null && (Number(r.fov) < 30 || Number(r.fov) > 110 || !Number.isInteger(Number(r.fov))));
    report(
      "FOV が 30〜110 の外",
      badFov.map((r) => String(r.user_id)),
      `以前からデバイスの保存で拒否される値。値: ${badFov.map((r) => r.fov).join(", ")}`,
    );
    const badGui = configs.filter((r) => r.gui != null && (Number(r.gui) < 0 || Number(r.gui) > 10 || !Number.isInteger(Number(r.gui))));
    report(
      "GUI スケールが 0〜10 の外",
      badGui.map((r) => String(r.user_id)),
      `以前からデバイスの保存で拒否される値。値: ${badGui.map((r) => r.gui).join(", ")}`,
    );
    // 参考: 実際に保存されている FOV・GUI スケールの分布（取り込みの換算が合っているかの手がかり）
    const fovValues = configs.filter((r) => r.fov != null).map((r) => Number(r.fov));
    const guiValues = configs.filter((r) => r.gui != null).map((r) => Number(r.gui));
    console.log(`  参考: FOV が入っている走者 ${fovValues.length}（最小 ${Math.min(...fovValues)}・最大 ${Math.max(...fovValues)}）、GUI スケール ${guiValues.length}（最小 ${Math.min(...guiValues)}・最大 ${Math.max(...guiValues)}）`);

    console.log("\n完了（書き込みはしていません）");
  } finally {
    tx.close();
    client.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
