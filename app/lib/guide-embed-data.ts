// ガイド本文のキー配置 / サーチクラフト埋め込み（data-user-slug / data-preset-name）が表示に使うデータの選び方。
// 公開ページ（components/guide-embeds.tsx）と、エディタの挿入ダイアログ・ノードビューの要約が同じ規則で
// 「どのデータを出すか」を決めるため、描画から切り離して非 .server のここに置く（docs/guides.md「埋め込み」）。
import { coerceStringArray, safeParseArray } from "@/lib/preset-read";
import { resolveVariations, type SearchCraftVariation } from "@/lib/search-craft-variations";
import {
  groupCraftsByTiming,
  SEARCH_CRAFT_TIMINGS,
  type SearchCraftTiming,
} from "@/lib/search-craft-templates";
import { normalizeKeyRemapType } from "@/lib/remap-utils";
import type { LoopStepData } from "@/lib/search-craft-loops";

/** 埋め込みが参照する走者の表示用データ（loader / 解決 API が詰める。guide-embed-users.server.ts） */
export type EmbedUserData = {
  slug: string;
  displayName: string | null;
  displayNameAlphabet: string | null;
  mcid: string | null;
  presets: Array<{
    name: string;
    isActive: boolean;
    keybindingsData: string | null;
    remapsData: string | null;
    playerConfigData: string | null;
    searchCraftsData: string | null;
    searchCraftLoopsData: string | null;
  }>;
  keybindings: Array<{ action: string; keyCode: string; category: string }>;
  keyRemaps: Array<{
    sourceKey: string;
    targetKey: string | null;
    software: string | null;
    outputMode: string | null;
    outputCharacter: string | null;
    /** リマップ種別（旧データ・プリセットJSON由来では欠落することがある） */
    remapType?: string | null;
  }>;
  playerConfig: {
    keyboardLayout: string | null;
    fingerAssignments: string | null;
  } | null;
  searchCrafts: Array<{
    id: string;
    sequence: number;
    items: string;
    searchStr: string | null;
    comment: string | null;
    timing: string | null;
    /** Shiftを押しながらクラフトするか（プリセットJSON由来の場合は存在しないことがある） */
    withShift?: boolean;
    /**
     * 複数サーチ文字列バリエーション（正準）。呼び出し元（guide-embed-users.server.ts）は
     * 旧データ・プリセットスナップショット由来でも必ず resolveVariations() を通した
     * 値を渡すこと（描画側では前提として信頼する）。
     */
    variations: SearchCraftVariation[];
  }>;
  /** サーチクラフトの繋ぎ方（Loop）。ライブ行の craftId は searchCrafts[].id を参照する */
  searchCraftLoops: Array<{
    id: string;
    sequence: number;
    steps: LoopStepData[];
    comment: string | null;
    timing: string | null;
  }>;
};

type EmbedPreset = EmbedUserData["presets"][number];

/** JSON 文字列を読む。壊れていれば undefined（壊れたスナップショットで公開ページを落とさない） */
function parseJsonSafe(json: string | null | undefined): unknown {
  if (!json) return undefined;
  try {
    return JSON.parse(json);
  } catch {
    return undefined;
  }
}

/**
 * 埋め込みのプリセット名から、使うプリセットを引く。名前に一意制約は無いので、先に見つかったもの。
 * 名前の指定が無ければ null（既定の表示＝メインのプリセットかライブ）
 */
export function findEmbedPreset(userData: EmbedUserData, presetName: string | null): EmbedPreset | null {
  if (!presetName) return null;
  return userData.presets.find((p) => p.name === presetName) ?? null;
}

/** 選べるプリセット名（重複は先勝ちで1つにする。公開ページの find と同じ） */
export function listEmbedPresetNames(userData: EmbedUserData): string[] {
  return [...new Set(userData.presets.map((p) => p.name))];
}

/**
 * キー配置の埋め込みが使うデータ。プリセット名の指定があり、そのプリセットに種別のデータがあればそれを、
 * 無ければ既定の表示（メインのプリセットかライブ）を使う（見つからないプリセット名も既定の表示になる）
 */
export function selectKeybindEmbedSource(userData: EmbedUserData, presetName: string | null) {
  let keybindingsRaw: unknown = userData.keybindings;
  let remapsRaw: unknown = userData.keyRemaps;
  let layout: string = userData.playerConfig?.keyboardLayout ?? "US";
  let fingerAssignmentsJson: string | null = userData.playerConfig?.fingerAssignments ?? null;

  const preset = findEmbedPreset(userData, presetName);
  if (preset) {
    const keybindings = parseJsonSafe(preset.keybindingsData);
    if (keybindings !== undefined) keybindingsRaw = keybindings;
    const remaps = parseJsonSafe(preset.remapsData);
    if (remaps !== undefined) remapsRaw = remaps;
    const config = parseJsonSafe(preset.playerConfigData) as
      | { keyboardLayout?: string | null; fingerAssignments?: string | null }
      | undefined;
    if (config && typeof config === "object") {
      layout = config.keyboardLayout ?? layout;
      if (config.fingerAssignments) fingerAssignmentsJson = config.fingerAssignments;
    }
  }

  return {
    keybindingsRaw: Array.isArray(keybindingsRaw) ? (keybindingsRaw as EmbedUserData["keybindings"]) : [],
    remapsRaw: Array.isArray(remapsRaw) ? (remapsRaw as EmbedUserData["keyRemaps"]) : [],
    layout: layout || "US",
    fingerAssignmentsJson,
  };
}

/**
 * リマップ埋め込みに出すリマップ（Trigger 種別は除く。チャット・サーチクラフト用途の紹介なので、
 * Chat / All / 未設定をそのまま一覧表示する）
 */
export function filterKeybindEmbedRemaps<T extends { remapType?: string | null }>(remaps: T[]): T[] {
  return remaps.filter((r) => normalizeKeyRemapType(r.remapType) !== "trigger");
}

/**
 * サーチクラフトの埋め込みが使うデータ。presetName 指定時のみ preset の生 JSON を読む（破損・旧データが
 * ありうるため unknown[] で受け、後段で必ず normalizeEmbedCrafts() を通す）。プリセットのスナップショットは
 * 行 id を保持しないため、Loop との突合は sequence で行う（presetMode）
 */
export function selectSearchCraftEmbedSource(userData: EmbedUserData, presetName: string | null) {
  let remapsRaw: unknown = userData.keyRemaps;
  let rawLoopsData: string | null = null;
  let rawCrafts: unknown[] = userData.searchCrafts;
  let layout: string | null = userData.playerConfig?.keyboardLayout ?? null;

  if (presetName) {
    const preset = findEmbedPreset(userData, presetName);
    if (preset?.searchCraftsData) {
      rawCrafts = safeParseArray<unknown>(preset.searchCraftsData) ?? [];
    }
    const remaps = parseJsonSafe(preset?.remapsData);
    if (remaps !== undefined) remapsRaw = remaps;
    const config = parseJsonSafe(preset?.playerConfigData) as { keyboardLayout?: unknown } | undefined;
    if (config && typeof config === "object" && typeof config.keyboardLayout === "string") {
      layout = config.keyboardLayout;
    }
    rawLoopsData = preset?.searchCraftLoopsData ?? null;
  }

  return {
    rawCrafts,
    remapsRaw: Array.isArray(remapsRaw) ? (remapsRaw as EmbedUserData["keyRemaps"]) : [],
    rawLoopsData,
    layout: layout || "US",
    presetMode: !!presetName,
  };
}

/** 生の craftsData 配列（破損・旧データがありうる）をバリエーション正準の形へ正規化する */
export function normalizeEmbedCrafts(rawCrafts: unknown[]) {
  // presetName 経路（生JSON直パース）は variations フィールドが欠落・破損していることがあるため、
  // 必ず resolveVariations() を経由する（壊れたJSONでSSRが落ちないように、原始的な型ガードを一つずつ通す）。
  return rawCrafts.map((item, idx) => {
    const c = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
    return {
      id: typeof c.id === "string" ? c.id : `preset-craft-${idx}`,
      sequence: typeof c.sequence === "number" ? c.sequence : idx,
      items: typeof c.items === "string" ? c.items : "[]",
      comment: typeof c.comment === "string" ? c.comment : null,
      timing: typeof c.timing === "string" ? c.timing : null,
      variations: resolveVariations({
        variations: c.variations,
        searchStr: typeof c.searchStr === "string" ? c.searchStr : null,
        withShift: typeof c.withShift === "boolean" ? c.withShift : undefined,
      }),
    };
  });
}

export type NormalizedEmbedCraft = ReturnType<typeof normalizeEmbedCrafts>[number];

// ========================================
// エディタ用の要約（ノードビュー・挿入ダイアログのプレビュー）
// ========================================

/** サーチクラフト埋め込みの要約。groups は一覧と同じ順（指定なし → OW → … → その他） */
export interface SearchCraftEmbedSummary {
  total: number;
  groups: { timing: SearchCraftTiming | null; count: number }[];
}

export function summarizeSearchCraftEmbed(
  userData: EmbedUserData,
  presetName: string | null,
): SearchCraftEmbedSummary {
  const { rawCrafts } = selectSearchCraftEmbedSource(userData, presetName);
  const crafts = normalizeEmbedCrafts(rawCrafts).map((c) => ({
    ...c,
    // 公開側と同じく、アイテムが読めない行も 1 件として数える（空クラフト表示）
    items: coerceStringArray(c.items),
  }));
  const grouped = groupCraftsByTiming(crafts);
  const order: (SearchCraftTiming | null)[] = [null, ...SEARCH_CRAFT_TIMINGS];
  return {
    total: crafts.length,
    groups: order
      .filter((timing) => grouped.has(timing))
      .map((timing) => ({ timing, count: grouped.get(timing)!.length })),
  };
}

/** キー配置埋め込みの要約（鍵盤に出すリマップの件数とキーボードの配列） */
export interface KeybindEmbedSummary {
  remapCount: number;
  layout: string;
}

export function summarizeKeybindEmbed(
  userData: EmbedUserData,
  presetName: string | null,
): KeybindEmbedSummary {
  const { remapsRaw, layout } = selectKeybindEmbedSource(userData, presetName);
  return { remapCount: filterKeybindEmbedRemaps(remapsRaw).length, layout };
}
