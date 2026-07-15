import { createId } from "@paralleldrive/cuid2";
import type { PresetRemapData, PresetSearchCraftData } from "./preset-utils";
import { toUiRemaps, type UiRemapInfo } from "./remap-utils";
import { t } from "./messages";

/**
 * サーチクラフトテンプレート共有ユーティリティ。
 * craftsData / remapsData は config_presets のスナップショット
 * （PresetSearchCraftData[] / PresetRemapData[]）と同一のJSON形式で保存する。
 */

/**
 * サーチクラフト・リマップの編集行に振るクライアント用の一意ID（React key / dnd id 用）。
 * ローダー由来の行と「追加」で作った行が衝突しないよう、常に cuid2 で生成する。
 */
export function draftId(prefix: string): string {
  return `${prefix}-${createId()}`;
}

export const TEMPLATE_TITLE_MAX = 100;
export const TEMPLATE_DESCRIPTION_MAX = 500;
export const MAX_TEMPLATES_PER_USER = 20;
export const MAX_TEMPLATE_CRAFTS = 100;

/** 表示・編集用にデコードしたサーチクラフトエントリ */
/** サーチクラフトのタイミング区分（表示順に定義） */
export type SearchCraftTiming =
  | "ow"
  | "bastion"
  | "bastion_fort"
  | "fortress"
  | "blinded"
  | "other";

export const SEARCH_CRAFT_TIMINGS = [
  "ow",
  "bastion",
  "bastion_fort",
  "fortress",
  "blinded",
  "other",
] as const;

export type TemplateCraft = {
  items: string[];
  searchStr: string | null;
  comment: string | null;
  timing: SearchCraftTiming | null;
  /** Shiftを押しながらクラフトするか */
  withShift: boolean;
};

function normalizeTiming(value: unknown): TemplateCraft["timing"] {
  return SEARCH_CRAFT_TIMINGS.includes(value as SearchCraftTiming)
    ? (value as SearchCraftTiming)
    : null;
}

/** craftsData（PresetSearchCraftData[] のJSON）を表示用にデコードする。不正なデータは空配列を返す */
export function parseTemplateCrafts(craftsData: string | null): TemplateCraft[] {
  if (!craftsData) return [];
  try {
    const raw = JSON.parse(craftsData) as PresetSearchCraftData[];
    if (!Array.isArray(raw)) return [];
    return [...raw]
      .sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0))
      .map((c) => {
        let items: string[] = [];
        try {
          const parsed = typeof c.items === "string" ? JSON.parse(c.items) : c.items;
          if (Array.isArray(parsed)) items = parsed.filter((i): i is string => typeof i === "string");
        } catch {
          items = [];
        }
        return {
          items,
          searchStr: typeof c.searchStr === "string" ? c.searchStr : null,
          comment: typeof c.comment === "string" ? c.comment : null,
          timing: normalizeTiming(c.timing),
          withShift: c.withShift === true,
        };
      });
  } catch {
    return [];
  }
}

/** remapsData（PresetRemapData[] のJSON）をパースする。不正なデータは空配列を返す */
export function parseTemplateRemapData(remapsData: string | null): PresetRemapData[] {
  if (!remapsData) return [];
  try {
    const raw = JSON.parse(remapsData) as PresetRemapData[];
    if (!Array.isArray(raw)) return [];
    return raw.filter((r) => typeof r?.sourceKey === "string");
  } catch {
    return [];
  }
}

/**
 * remapsData を表示・シミュレーション用の UiRemapInfo[] に変換する。
 * 文字出力モード（outputMode: "character"）の場合は outputCharacter を出力先として扱う。
 */
export function parseTemplateRemaps(remapsData: string | null): UiRemapInfo[] {
  return toUiRemaps(
    parseTemplateRemapData(remapsData).map((r) => ({
      sourceKey: r.sourceKey,
      targetKey:
        r.outputMode === "character" && r.outputCharacter
          ? r.outputCharacter
          : r.targetKey,
      software: r.software ?? null,
      notes: r.notes ?? null,
    })),
  );
}

/**
 * クラフトエントリ配列を PresetSearchCraftData[] のJSON文字列にシリアライズする（parseTemplateCrafts の逆変換）。
 * DBの行データを経由しない一時データ（Playgroundの編集状態等）をプリセット/テンプレートに保存する際に使う。
 */
export function serializeTemplateCrafts(crafts: TemplateCraft[]): string {
  const data: PresetSearchCraftData[] = crafts.map((c, index) => ({
    sequence: index + 1,
    items: JSON.stringify(c.items),
    keys: "[]",
    searchStr: c.searchStr,
    comment: c.comment,
    timing: c.timing,
    withShift: c.withShift,
  }));
  return JSON.stringify(data);
}

/** リマップ配列を PresetRemapData[] のJSON文字列にシリアライズする（parseTemplateRemaps の逆変換） */
export function serializeTemplateRemaps(
  remaps: Array<{ sourceKey: string; targetKey: string | null; software?: string | null; notes?: string | null }>,
): string {
  const data: PresetRemapData[] = remaps.map((r) => ({
    sourceKey: r.sourceKey,
    targetKey: r.targetKey,
    software: r.software ?? null,
    notes: r.notes ?? null,
  }));
  return JSON.stringify(data);
}

// ============================================
// テンプレートエディタ（作成・編集ページ）用ヘルパー
// ============================================

export const TEMPLATE_LANGUAGE_MAX = 32;

/** パース済みデータにエディタ用のIDを振る（クラフト） */
export function toEditorCrafts(crafts: TemplateCraft[]): (TemplateCraft & { id: string })[] {
  return crafts.map((c) => ({ ...c, id: draftId("craft") }));
}

/** パース済みデータにエディタ用のIDを振る（リマップ） */
export function toEditorRemaps(
  remaps: UiRemapInfo[],
): { id: string; sourceKey: string; targetKey: string | null }[] {
  return remaps.map((r) => ({ id: draftId("remap"), sourceKey: r.sourceKey, targetKey: r.targetKey }));
}

export type EditorSubmission = {
  title: string;
  description: string | null;
  gameLanguage: string | null;
  craftsData: string;
  remapsData: string | null;
};

/**
 * テンプレートエディタから送信されたフォームデータを検証し、DB保存用の形式に変換する。
 * 不正な場合は { error } を返す。
 */
export function parseEditorSubmission(formData: FormData): EditorSubmission | { error: string } {
  const title = ((formData.get("title") as string | null) ?? "").trim();
  const description = ((formData.get("description") as string | null) ?? "").trim();
  const gameLanguage = ((formData.get("gameLanguage") as string | null) ?? "").trim();

  if (!title) {
    return { error: t("meTemplates.titleRequired") };
  }
  if (
    title.length > TEMPLATE_TITLE_MAX ||
    description.length > TEMPLATE_DESCRIPTION_MAX ||
    gameLanguage.length > TEMPLATE_LANGUAGE_MAX
  ) {
    return { error: t("meTemplates.textTooLong") };
  }

  let craftsRaw: unknown;
  let remapsRaw: unknown;
  try {
    craftsRaw = JSON.parse((formData.get("crafts") as string | null) || "[]");
    remapsRaw = JSON.parse((formData.get("remaps") as string | null) || "[]");
  } catch {
    return { error: t("templates.invalidTemplateData") };
  }
  if (!Array.isArray(craftsRaw) || !Array.isArray(remapsRaw)) {
    return { error: t("templates.invalidTemplateData") };
  }

  if (craftsRaw.length === 0) {
    return { error: t("meTemplates.noCraftsInEditor") };
  }
  if (craftsRaw.length > MAX_TEMPLATE_CRAFTS) {
    return { error: t("meTemplates.tooManyCrafts", { max: MAX_TEMPLATE_CRAFTS }) };
  }

  const crafts: TemplateCraft[] = [];
  for (const raw of craftsRaw as Array<Partial<TemplateCraft>>) {
    const items = Array.isArray(raw.items)
      ? raw.items.filter((i): i is string => typeof i === "string")
      : [];
    // trim は空判定のみ。先頭・末尾スペースはスペースキー入力として意味を持つため原文を保存する
    const searchStr = typeof raw.searchStr === "string" ? raw.searchStr : "";
    if (items.length === 0) {
      return { error: t("meSearchCraft.selectAtLeastOneItem") };
    }
    if (!searchStr.trim()) {
      return { error: t("meSearchCraft.craftStringRequired") };
    }
    crafts.push({
      items,
      searchStr,
      comment: typeof raw.comment === "string" && raw.comment.trim() ? raw.comment : null,
      timing: SEARCH_CRAFT_TIMINGS.includes(raw.timing as SearchCraftTiming)
        ? (raw.timing as SearchCraftTiming)
        : null,
      withShift: raw.withShift === true,
    });
  }

  // 未入力の行（sourceKey 空・変更先入力待ち）は除外し、sourceKey 重複は先勝ち
  const seenSources = new Set<string>();
  const remaps: { sourceKey: string; targetKey: string | null }[] = [];
  for (const raw of remapsRaw as Array<{ sourceKey?: unknown; targetKey?: unknown }>) {
    if (typeof raw.sourceKey !== "string" || !raw.sourceKey) continue;
    if (raw.targetKey !== null && typeof raw.targetKey !== "string") continue;
    if (raw.targetKey === "") continue;
    if (seenSources.has(raw.sourceKey)) continue;
    seenSources.add(raw.sourceKey);
    remaps.push({ sourceKey: raw.sourceKey, targetKey: raw.targetKey as string | null });
  }

  return {
    title,
    description: description || null,
    gameLanguage: gameLanguage || null,
    craftsData: serializeTemplateCrafts(crafts),
    remapsData: remaps.length > 0 ? serializeTemplateRemaps(remaps) : null,
  };
}
