import { createId } from "@paralleldrive/cuid2";
import { eq, and, inArray } from "drizzle-orm";
import type { Database } from "./db";
import { searchCrafts, keyRemaps, configPresets, type ConfigPreset } from "./schema";
import { sanitizeRemapTargetKey, remapSourceMatchKey } from "./remap-utils";
import { syncActivePresetSnapshot, type PresetRemapData } from "./preset-utils";
import { serializeTemplateCrafts, parseTemplateRemapData, type TemplateCraft } from "./search-craft-templates";

/**
 * サーチクラフト（＋任意でリマップ）をプリセットへ反映するサーバー専用ヘルパー。
 * テンプレートの「自分の設定に反映」と Playground の「保存」で共用する。
 *
 * - remaps が null の場合はリマップに一切触れない（既存の値を維持）
 * - remaps はチャット用（remapType: "chat"）として書き込む。既存の trigger/all 行は保持し、
 *   挿入分と同一 sourceKey の all 行はゲーム側の挙動を保つため trigger に変換する
 * - アクティブプリセットへの反映は「アクティブプリセット = ライブテーブル」の不変条件を保つため、
 *   ライブテーブルを置換した上で syncActivePresetSnapshot() で同期する
 */

export type ApplyCraftsInput = {
  crafts: TemplateCraft[];
  /** null = リマップは変更しない */
  remaps: PresetRemapData[] | null;
};

/** sourceKey 重複を除外（先勝ち）し、未入力エントリを落とす */
function dedupeRemaps(remaps: PresetRemapData[]): PresetRemapData[] {
  const seen = new Set<string>();
  const result: PresetRemapData[] = [];
  for (const remap of remaps) {
    if (!remap.sourceKey || seen.has(remap.sourceKey)) continue;
    seen.add(remap.sourceKey);
    result.push(remap);
  }
  return result;
}

/**
 * スナップショット（remapsData JSON）へチャット用リマップをマージする。
 * ライブテーブル（replaceLiveTables）と同一規則:
 * - 既存の trigger / all 行のみ保持（chat / unset 行はテンプレの内容で置換）
 * - 挿入分と同一 sourceKey の all 行は trigger に変換（ゲーム側の挙動を保持）。
 *   ただし同一 sourceKey の trigger 行が既にある場合（インポート経由等の不整合データ）は
 *   変換すると重複するため all 行を破棄する
 * - incoming は dedupe の上 remapType: "chat" として結合。結合結果が空なら null
 */
export function mergeChatRemapsIntoSnapshot(
  existingJson: string | null,
  incoming: PresetRemapData[],
): string | null {
  const deduped = dedupeRemaps(incoming);
  const incomingKeys = new Set(deduped.map((r) => remapSourceMatchKey(r.sourceKey)));
  const kept = parseTemplateRemapData(existingJson).filter(
    (r) => r.remapType === "trigger" || r.remapType === "all",
  );
  const triggerKeys = new Set(
    kept.filter((r) => r.remapType === "trigger").map((r) => remapSourceMatchKey(r.sourceKey)),
  );
  const preserved = kept.flatMap((r) => {
    if (r.remapType !== "all" || !incomingKeys.has(remapSourceMatchKey(r.sourceKey))) return [r];
    return triggerKeys.has(remapSourceMatchKey(r.sourceKey))
      ? []
      : [{ ...r, remapType: "trigger" as const }];
  });
  const merged: PresetRemapData[] = [
    ...preserved,
    ...deduped.map((r) => ({ ...r, remapType: "chat" as const })),
  ];
  return merged.length > 0 ? JSON.stringify(merged) : null;
}

/**
 * ライブテーブルの search_crafts（＋remaps 指定時は key_remaps）をトランザクションで置換する。
 * key_remaps は chat / unset 行のみ置換対象とし、trigger / all 行は保持する
 */
async function replaceLiveTables(
  db: Database,
  userId: string,
  { crafts, remaps }: ApplyCraftsInput,
  now: Date,
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(searchCrafts).where(eq(searchCrafts.userId, userId));
    for (let i = 0; i < crafts.length; i++) {
      const craft = crafts[i];
      await tx.insert(searchCrafts).values({
        id: createId(),
        userId,
        sequence: i + 1,
        items: JSON.stringify(craft.items),
        keys: JSON.stringify([]),
        searchStr: craft.searchStr,
        comment: craft.comment,
        timing: craft.timing,
        withShift: craft.withShift,
        createdAt: now,
        updatedAt: now,
      });
    }

    if (remaps !== null) {
      await tx
        .delete(keyRemaps)
        .where(and(eq(keyRemaps.userId, userId), inArray(keyRemaps.remapType, ["chat", "unset"])));

      const deduped = dedupeRemaps(remaps);
      const incomingKeys = new Set(deduped.map((r) => remapSourceMatchKey(r.sourceKey)));

      // 挿入分と同一 sourceKey の all 行は trigger に変換する
      // （All=Trigger+Chat のうちゲーム側を保持し、チャット側だけテンプレの内容で置換する）。
      // 同一 sourceKey の trigger 行が既にある場合（インポート経由等の不整合データ）は
      // 変換すると UNIQUE 違反になるため all 行を削除する
      const preservedRows = await tx
        .select({ id: keyRemaps.id, sourceKey: keyRemaps.sourceKey, remapType: keyRemaps.remapType })
        .from(keyRemaps)
        .where(and(eq(keyRemaps.userId, userId), inArray(keyRemaps.remapType, ["all", "trigger"])));
      const triggerKeys = new Set(
        preservedRows
          .filter((row) => row.remapType === "trigger")
          .map((row) => remapSourceMatchKey(row.sourceKey)),
      );
      const collidingAllRows = preservedRows.filter(
        (row) => row.remapType === "all" && incomingKeys.has(remapSourceMatchKey(row.sourceKey)),
      );
      const dropIds = collidingAllRows
        .filter((row) => triggerKeys.has(remapSourceMatchKey(row.sourceKey)))
        .map((row) => row.id);
      const convertIds = collidingAllRows
        .filter((row) => !triggerKeys.has(remapSourceMatchKey(row.sourceKey)))
        .map((row) => row.id);
      if (dropIds.length > 0) {
        await tx.delete(keyRemaps).where(inArray(keyRemaps.id, dropIds));
      }
      if (convertIds.length > 0) {
        await tx
          .update(keyRemaps)
          .set({ remapType: "trigger", updatedAt: now })
          .where(inArray(keyRemaps.id, convertIds));
      }

      for (const remap of deduped) {
        await tx.insert(keyRemaps).values({
          id: createId(),
          userId,
          sourceKey: remap.sourceKey,
          targetKey: sanitizeRemapTargetKey(remap.targetKey),
          software: remap.software ?? null,
          notes: remap.notes ?? null,
          outputMode: remap.outputMode ?? "key",
          outputCharacter: remap.outputCharacter ?? null,
          remapType: "chat",
          createdAt: now,
          updatedAt: now,
        });
      }
    }
  });

  await syncActivePresetSnapshot(
    db,
    userId,
    remaps !== null ? ["searchCrafts", "remaps"] : ["searchCrafts"],
  );
}

export type ApplyToPresetResult =
  | { ok: true; presetId: string; presetName: string; wasActive: boolean }
  | { ok: false; error: "preset_not_found" };

/**
 * 既存プリセットへ反映する。
 * アクティブプリセットの場合はライブテーブルも置換して同期、非アクティブの場合はJSON列のみ更新する。
 */
export async function applyCraftsToExistingPreset(
  db: Database,
  userId: string,
  presetId: string,
  input: ApplyCraftsInput,
): Promise<ApplyToPresetResult> {
  const preset = await db.query.configPresets.findFirst({
    where: and(eq(configPresets.id, presetId), eq(configPresets.userId, userId)),
  });
  if (!preset) {
    return { ok: false, error: "preset_not_found" };
  }

  const now = new Date();

  if (preset.isActive) {
    await replaceLiveTables(db, userId, input, now);
  } else {
    const updates: Partial<typeof configPresets.$inferInsert> = {
      searchCraftsData: serializeTemplateCrafts(input.crafts),
      updatedAt: now,
    };
    if (input.remaps !== null) {
      updates.remapsData = mergeChatRemapsIntoSnapshot(preset.remapsData, input.remaps);
    }
    await db.update(configPresets).set(updates).where(eq(configPresets.id, preset.id));
  }

  return { ok: true, presetId: preset.id, presetName: preset.name, wasActive: preset.isActive };
}

export type CreatePresetResult =
  | { ok: true; presetId: string; presetName: string }
  | { ok: false; error: "base_preset_not_found" };

/**
 * 新規プリセットを作成してサーチクラフト（＋リマップ）を保存する。**常に非アクティブで作成する**。
 * basePresetId 指定時は、その全設定データ（キーバインド・デバイス設定等）をコピーした上で
 * サーチクラフトを上書きし、リマップはチャット側のみ置換してマージする
 * （mergeChatRemapsIntoSnapshot）。remaps が null の場合、リマップはベースの値を引き継ぐ。
 */
export async function createPresetWithCrafts(
  db: Database,
  userId: string,
  options: { name: string; description: string | null; basePresetId: string | null },
  input: ApplyCraftsInput,
): Promise<CreatePresetResult> {
  let base: ConfigPreset | undefined;
  if (options.basePresetId) {
    base = await db.query.configPresets.findFirst({
      where: and(eq(configPresets.id, options.basePresetId), eq(configPresets.userId, userId)),
    });
    if (!base) {
      return { ok: false, error: "base_preset_not_found" };
    }
  }

  const now = new Date();
  const presetId = createId();

  await db.insert(configPresets).values({
    id: presetId,
    userId,
    name: options.name,
    description: options.description,
    isActive: false,
    keybindingsData: base?.keybindingsData ?? null,
    playerConfigData: base?.playerConfigData ?? null,
    fingerAssignmentsData: base?.fingerAssignmentsData ?? null,
    itemLayoutsData: base?.itemLayoutsData ?? null,
    customKeysData: base?.customKeysData ?? null,
    customActionsData: base?.customActionsData ?? null,
    searchCraftsData: serializeTemplateCrafts(input.crafts),
    remapsData:
      input.remaps !== null
        ? mergeChatRemapsIntoSnapshot(base?.remapsData ?? null, input.remaps)
        : base?.remapsData ?? null,
    createdAt: now,
    updatedAt: now,
  });

  return { ok: true, presetId, presetName: options.name };
}
