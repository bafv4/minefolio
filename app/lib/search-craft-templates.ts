import { createId } from "@paralleldrive/cuid2";
import type { PresetRemapData, PresetSearchCraftData, PresetSearchCraftLoopData, PresetLoopStepData } from "./preset-utils";
import { normalizeKeyRemapType, toUiRemaps, type UiRemapInfo } from "./remap-utils";
import { isValidLoopStepsShape, type LoopTransition } from "./search-craft-loops";
import type { Translator } from "./messages";

/**
 * サーチクラフトテンプレート共有ユーティリティ。
 * craftsData / remapsData は config_presets のスナップショット
 * （PresetSearchCraftData[] / PresetRemapData[]）と同一のJSON形式で保存する。
 * loopsData も同様に config_presets.search_craft_loops_data と同一形式で保存する
 * （craftSeq = craftIndex + 1 が恒等であることを利用し、プリセットと同じ
 * PresetSearchCraftLoopData[] 形式をそのまま流用する）。
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
/** JSON爆弾対策のサニティ上限（意味的な仕様上限ではない） */
export const MAX_TEMPLATE_LOOPS = 50;
export const MAX_LOOP_STEPS = 100;

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
    return raw
      .filter((r) => typeof r?.sourceKey === "string")
      .map((r) => ({ ...r, remapType: normalizeKeyRemapType(r.remapType) }));
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
      remapType: r.remapType,
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
// Loop（繋ぎ方）
// ============================================

/**
 * テンプレート・Playground用のLoop（繋ぎ方）表現。
 * crafts 配列内の位置（craftIndex、0始まり）でステップの参照先を表す
 * （テンプレート/Playgroundは crafts に安定した行 id を持たないため）。
 * 保存形式は config_presets.search_craft_loops_data と同一の PresetSearchCraftLoopData[]
 * （craftSeq = craftIndex + 1 が恒等）。
 */
export type TemplateLoop = {
  steps: { craftIndex: number; transition: LoopTransition | null }[];
  comment: string | null;
  timing: SearchCraftTiming | null;
};

/** isValidLoopStepsShape で構造検証するための仮の craftId 変換（craftIndex を文字列化するだけ） */
function toShapeCheckSteps(
  steps: { craftIndex: number; transition: LoopTransition | null }[],
): { craftId: string; transition: LoopTransition | null }[] {
  return steps.map((s) => ({ craftId: String(s.craftIndex), transition: s.transition }));
}

/**
 * loopsData（PresetSearchCraftLoopData[] のJSON、craftSeq = craftIndex + 1）を
 * 表示・編集用にデコードする。craftSeq が crafts の範囲外を指すステップは除去し、
 * 残りが2件未満になった Loop は除去する。不正なJSON・要素は捨てる（例外を投げない）。
 *
 * craftSeq は 1..n の連番前提（craftIndex = craftSeq - 1）。プリセット由来のスナップショットも
 * この前提が成立する（全書き込み経路が crafts の sequence を i+1 で振り直すため）。
 */
export function parseTemplateLoops(loopsData: string | null, craftCount: number): TemplateLoop[] {
  if (!loopsData) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(loopsData);
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];

  const result: TemplateLoop[] = [];
  for (const rawLoop of (raw as unknown[]).slice(0, MAX_TEMPLATE_LOOPS) as PresetSearchCraftLoopData[]) {
    if (!rawLoop || !Array.isArray(rawLoop.steps)) continue;

    const steps: { craftIndex: number; transition: LoopTransition | null }[] = [];
    for (const rawStep of rawLoop.steps.slice(0, MAX_LOOP_STEPS)) {
      if (!rawStep || typeof rawStep !== "object") continue;
      const craftIndex = (rawStep as PresetLoopStepData).craftSeq - 1;
      if (!Number.isInteger(craftIndex) || craftIndex < 0 || craftIndex >= craftCount) continue;
      steps.push({ craftIndex, transition: (rawStep as PresetLoopStepData).transition ?? null });
    }
    if (steps.length < 2) continue;
    // 除去でズレる場合に備え、先頭ステップの transition は常に null に統一する
    steps[0] = { ...steps[0], transition: null };

    if (!isValidLoopStepsShape(toShapeCheckSteps(steps))) continue;

    result.push({
      steps,
      comment: typeof rawLoop.comment === "string" ? rawLoop.comment : null,
      timing: normalizeTiming(rawLoop.timing),
    });
  }

  return result;
}

/** Loop配列を PresetSearchCraftLoopData[] のJSON文字列にシリアライズする（parseTemplateLoops の逆変換） */
export function serializeTemplateLoops(loops: TemplateLoop[]): string {
  const data: PresetSearchCraftLoopData[] = loops.map((loop, index) => ({
    sequence: index + 1,
    steps: loop.steps.map((s) => ({ craftSeq: s.craftIndex + 1, transition: s.transition })),
    comment: loop.comment,
    timing: loop.timing,
  }));
  return JSON.stringify(data);
}

/**
 * フォームの loops フィールド（TemplateLoop[] 形状、craftIndex 参照）を検証する。
 * 構造不正（非配列・craftIndex 範囲外・bsCount 非負整数でない等）は { error: true } を返す。
 * timing の不正値は既存の normalizeTiming と同じ流儀で null に正規化する（エラーにはしない）。
 */
export function parseLoopsField(
  formData: FormData,
  craftCount: number,
): TemplateLoop[] | { error: true } {
  let raw: unknown;
  try {
    raw = JSON.parse((formData.get("loops") as string | null) || "[]");
  } catch {
    return { error: true };
  }
  if (!Array.isArray(raw) || raw.length > MAX_TEMPLATE_LOOPS) {
    return { error: true };
  }

  const loops: TemplateLoop[] = [];
  for (const rawLoop of raw as Array<Partial<TemplateLoop>>) {
    if (!rawLoop || !Array.isArray(rawLoop.steps) || rawLoop.steps.length > MAX_LOOP_STEPS) {
      return { error: true };
    }

    const steps: { craftIndex: number; transition: LoopTransition | null }[] = [];
    for (const rawStep of rawLoop.steps as Array<{ craftIndex?: unknown; transition?: unknown }>) {
      if (!rawStep || typeof rawStep !== "object") {
        return { error: true };
      }
      const craftIndex = rawStep.craftIndex;
      if (
        typeof craftIndex !== "number" ||
        !Number.isInteger(craftIndex) ||
        craftIndex < 0 ||
        craftIndex >= craftCount
      ) {
        return { error: true };
      }
      steps.push({ craftIndex, transition: (rawStep.transition ?? null) as LoopTransition | null });
    }

    if (!isValidLoopStepsShape(toShapeCheckSteps(steps))) {
      return { error: true };
    }

    loops.push({
      steps,
      comment: typeof rawLoop.comment === "string" && rawLoop.comment.trim() ? rawLoop.comment : null,
      timing: normalizeTiming(rawLoop.timing),
    });
  }

  return loops;
}

// ============================================
// テンプレートエディタ（作成・編集ページ）用ヘルパー
// ============================================

export const TEMPLATE_LANGUAGE_MAX = 32;

/** パース済みデータにエディタ用のIDを振る（クラフト） */
export function toEditorCrafts(crafts: TemplateCraft[]): (TemplateCraft & { id: string })[] {
  return crafts.map((c) => ({ ...c, id: draftId("craft") }));
}

/**
 * 編集用の Loop（SearchCraftLoopDraft 相当、craftId 参照）を、フォーム送信用の
 * TemplateLoop[]（craftIndex 参照）へ変換する。/me/search-craft の saveAll と異なり、
 * テンプレート・Playground は crafts に安定した行 id を持たないため、送信直前に
 * 現在の crafts 配列内の位置（index）へ変換する。
 * crafts に見つからない craftId を含むステップがあれば、その Loop ごと除外する
 * （エディタは保存前に「未選択ステップ」を拒否しているため通常は到達しない想定の安全網）。
 */
export function toSubmittableLoops(
  crafts: { id: string }[],
  loops: {
    steps: { craftId: string; transition: LoopTransition | null }[];
    comment: string | null;
    timing: SearchCraftTiming | null;
  }[],
): TemplateLoop[] {
  const indexById = new Map(crafts.map((c, idx) => [c.id, idx]));
  const result: TemplateLoop[] = [];
  for (const loop of loops) {
    const steps: { craftIndex: number; transition: LoopTransition | null }[] = [];
    let allResolved = true;
    for (const step of loop.steps) {
      const craftIndex = indexById.get(step.craftId);
      if (craftIndex === undefined) {
        allResolved = false;
        break;
      }
      steps.push({ craftIndex, transition: step.transition });
    }
    if (!allResolved || steps.length < 2) continue;
    result.push({ steps, comment: loop.comment, timing: loop.timing });
  }
  return result;
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
  loopsData: string | null;
};

/**
 * テンプレートエディタから送信されたフォームデータを検証し、DB保存用の形式に変換する。
 * 不正な場合は { error } を返す。
 */
export function parseEditorSubmission(
  t: Translator,
  formData: FormData,
): EditorSubmission | { error: string } {
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

  const loopsResult = parseLoopsField(formData, crafts.length);
  if ("error" in loopsResult) {
    return { error: t("templates.invalidTemplateData") };
  }

  return {
    title,
    description: description || null,
    gameLanguage: gameLanguage || null,
    craftsData: serializeTemplateCrafts(crafts),
    remapsData: remaps.length > 0 ? serializeTemplateRemaps(remaps) : null,
    loopsData: loopsResult.length > 0 ? serializeTemplateLoops(loopsResult) : null,
  };
}
