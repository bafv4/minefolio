// プリセットのスナップショット（config_presets の *Data JSON 列)を、
// ライブテーブル行相当の表示用構造にデコードする共通ヘルパー。
//
// 公開面（プロフィール・操作設定一覧・比較・CSV・ガイド埋め込み）は
// 「メイン（公開用）プリセットのスナップショット優先・無ければライブテーブル」で表示するため、
// 各デコーダはスナップショットが null / 破損のとき null を返し、呼び出し側でライブへフォールバックする。
//
// 合成する行の id は `preset-<kind>-<idx>` 形式（表示専用。DB の行 id とは無関係）。
// 並び順はライブテーブル取得時の orderBy と揃える。
import { normalizeKeyRemapType } from "./remap-utils";

export type PresetSnapshot = {
  keybindingsData?: string | null;
  playerConfigData?: string | null;
  remapsData?: string | null;
  fingerAssignmentsData?: string | null;
  itemLayoutsData?: string | null;
  searchCraftsData?: string | null;
  customKeysData?: string | null;
  customActionsData?: string | null;
};

function safeParseArray<T>(json: string | null | undefined): T[] | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? (parsed as T[]) : null;
  } catch {
    // 破損スナップショットで公開ページを落とさない（ライブへフォールバック）
    return null;
  }
}

export function decodePresetKeybindings(json: string | null | undefined, userId: string) {
  const rows = safeParseArray<{ action: string; keyCode: string; category: string }>(json);
  if (!rows) return null;
  return rows
    .map((kb, idx) => ({
      id: `preset-kb-${idx}`,
      userId,
      action: kb.action,
      keyCode: kb.keyCode,
      category: kb.category as "movement" | "combat" | "inventory" | "ui",
      createdAt: new Date(),
      updatedAt: new Date(),
    }))
    .sort((a, b) => a.category.localeCompare(b.category) || a.action.localeCompare(b.action));
}

export function decodePresetRemaps(json: string | null | undefined, userId: string) {
  const rows = safeParseArray<{
    sourceKey: string;
    targetKey: string | null;
    software: string | null;
    notes: string | null;
    outputMode?: "key" | "character" | null;
    outputCharacter?: string | null;
    remapType?: string | null;
  }>(json);
  if (!rows) return null;
  return rows
    .map((r, idx) => ({
      id: `preset-remap-${idx}`,
      userId,
      sourceKey: r.sourceKey,
      targetKey: r.targetKey,
      software: r.software,
      notes: r.notes,
      outputMode: r.outputMode ?? ("key" as const),
      outputCharacter: r.outputCharacter ?? null,
      remapType: normalizeKeyRemapType(r.remapType),
      createdAt: new Date(),
      updatedAt: new Date(),
    }))
    .sort((a, b) => a.sourceKey.localeCompare(b.sourceKey));
}

/** playerConfig はスナップショットの全列オブジェクトをそのまま返す（呼び出し側でライブとマージ/上書き） */
export function decodePresetPlayerConfig(json: string | null | undefined) {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export function decodePresetItemLayouts(json: string | null | undefined, userId: string) {
  const rows = safeParseArray<{
    segment: string;
    slots: string;
    offhand: string | null;
    notes: string | null;
    displayOrder: number;
  }>(json);
  if (!rows) return null;
  return rows
    .map((layout, idx) => ({
      id: `preset-layout-${idx}`,
      userId,
      segment: layout.segment,
      slots: layout.slots,
      offhand: layout.offhand,
      notes: layout.notes,
      displayOrder: layout.displayOrder,
      createdAt: new Date(),
      updatedAt: new Date(),
    }))
    .sort((a, b) => a.displayOrder - b.displayOrder);
}

export function decodePresetSearchCrafts(json: string | null | undefined, userId: string) {
  const rows = safeParseArray<{
    sequence: number;
    items: string;
    keys: string;
    searchStr: string | null;
    comment: string | null;
    timing?: "ow" | "bastion" | "bastion_fort" | "fortress" | "blinded" | "other" | null;
    withShift?: boolean;
  }>(json);
  if (!rows) return null;
  return rows
    .map((craft, idx) => ({
      id: `preset-craft-${idx}`,
      userId,
      sequence: craft.sequence,
      items: craft.items,
      keys: craft.keys,
      searchStr: craft.searchStr,
      comment: craft.comment,
      timing: craft.timing ?? null,
      withShift: craft.withShift === true,
      createdAt: new Date(),
      updatedAt: new Date(),
    }))
    .sort((a, b) => a.sequence - b.sequence);
}

export function decodePresetCustomKeys(json: string | null | undefined, userId: string) {
  const rows = safeParseArray<{
    keyCode: string;
    keyName: string;
    category: "mouse" | "keyboard" | "controller";
    position: string | null;
    size: string | null;
    notes: string | null;
  }>(json);
  if (!rows) return null;
  return rows
    .map((ck, idx) => ({
      id: `preset-customkey-${idx}`,
      userId,
      keyCode: ck.keyCode,
      keyName: ck.keyName,
      category: ck.category,
      position: ck.position,
      size: ck.size,
      notes: ck.notes,
      createdAt: new Date(),
      updatedAt: new Date(),
    }))
    .sort((a, b) => a.category.localeCompare(b.category) || a.keyName.localeCompare(b.keyName));
}

export function decodePresetCustomActions(json: string | null | undefined, userId: string) {
  const rows = safeParseArray<{
    actionName: string;
    description: string | null;
    category: "other" | "macro" | "tool";
    triggerKey: string;
    displayOrder: number;
  }>(json);
  if (!rows) return null;
  return rows
    .map((ca, idx) => ({
      id: `preset-customaction-${idx}`,
      userId,
      actionName: ca.actionName,
      description: ca.description,
      category: ca.category,
      triggerKey: ca.triggerKey,
      displayOrder: ca.displayOrder,
      createdAt: new Date(),
      updatedAt: new Date(),
    }))
    .sort((a, b) => a.displayOrder - b.displayOrder || a.actionName.localeCompare(b.actionName));
}

/**
 * スナップショット全種別を一括デコードし、そのプリセットの「完全な内容」を返す。
 * スナップショットが null の種別は「空」を意味する（apply-preset の対称復元と同じ正準解釈）ため
 * 空配列を返す — ライブテーブルへフォールバックしてはならない（編集中データの漏出になる）。
 * ライブへのフォールバックは「プリセット自体が存在しない」場合にのみ呼び出し側で行うこと。
 * playerConfig / fingerAssignments のみ null があり得る（設定なし）。
 */
export function decodePresetConfig(preset: PresetSnapshot, userId: string) {
  return {
    keybindings: decodePresetKeybindings(preset.keybindingsData, userId) ?? [],
    keyRemaps: decodePresetRemaps(preset.remapsData, userId) ?? [],
    playerConfig: decodePresetPlayerConfig(preset.playerConfigData),
    fingerAssignments: preset.fingerAssignmentsData ?? null,
    itemLayouts: decodePresetItemLayouts(preset.itemLayoutsData, userId) ?? [],
    searchCrafts: decodePresetSearchCrafts(preset.searchCraftsData, userId) ?? [],
    customKeys: decodePresetCustomKeys(preset.customKeysData, userId) ?? [],
    customActions: decodePresetCustomActions(preset.customActionsData, userId) ?? [],
  };
}
