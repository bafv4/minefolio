import { createId } from "@paralleldrive/cuid2";
import { eq, and } from "drizzle-orm";
import type { Database } from "./db";
import { searchCrafts, keyRemaps, configPresets, type ConfigPreset } from "./schema";
import { sanitizeRemapTargetKey } from "./remap-utils";
import { syncActivePresetSnapshot, type PresetRemapData } from "./preset-utils";
import { serializeTemplateCrafts, type TemplateCraft } from "./search-craft-templates";

/**
 * サーチクラフト（＋任意でリマップ）をプリセットへ反映するサーバー専用ヘルパー。
 * テンプレートの「自分の設定に反映」と Playground の「保存」で共用する。
 *
 * - remaps が null の場合はリマップに一切触れない（既存の値を維持）
 * - アクティブプリセットへの反映は「アクティブプリセット = ライブテーブル」の不変条件を保つため、
 *   ライブテーブルを全置換した上で syncActivePresetSnapshot() で同期する
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

/** ライブテーブルの search_crafts（＋remaps 指定時は key_remaps）をトランザクションで全置換する */
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
        createdAt: now,
        updatedAt: now,
      });
    }

    if (remaps !== null) {
      await tx.delete(keyRemaps).where(eq(keyRemaps.userId, userId));
      for (const remap of dedupeRemaps(remaps)) {
        await tx.insert(keyRemaps).values({
          id: createId(),
          userId,
          sourceKey: remap.sourceKey,
          targetKey: sanitizeRemapTargetKey(remap.targetKey),
          software: remap.software ?? null,
          notes: remap.notes ?? null,
          outputMode: remap.outputMode ?? "key",
          outputCharacter: remap.outputCharacter ?? null,
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
 * アクティブプリセットの場合はライブテーブルも全置換して同期、非アクティブの場合はJSON列のみ更新する。
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
      const deduped = dedupeRemaps(input.remaps);
      updates.remapsData = deduped.length > 0 ? JSON.stringify(deduped) : null;
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
 * サーチクラフト（＋リマップ）を上書きする。remaps が null の場合、リマップはベースの値を引き継ぐ。
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
  const deduped = input.remaps !== null ? dedupeRemaps(input.remaps) : null;

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
      deduped !== null
        ? deduped.length > 0
          ? JSON.stringify(deduped)
          : null
        : base?.remapsData ?? null,
    createdAt: now,
    updatedAt: now,
  });

  return { ok: true, presetId, presetName: options.name };
}
