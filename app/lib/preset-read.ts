// プリセットのスナップショット（config_presets の *Data JSON 列)を、
// ライブテーブル行相当の表示用構造にデコードする共通ヘルパー。
//
// 公開面（プロフィール・操作設定一覧・比較・CSV・ガイド埋め込み）は
// 「メイン（公開用）プリセットのスナップショット優先・無ければライブテーブル」で表示するため、
// 各デコーダはスナップショットが null / 破損のとき null を返し、呼び出し側でライブへフォールバックする。
//
// JSON の行形状はシリアライズ側（preset-utils.ts の serialize*）が書く Preset*Data と
// 同一契約。型を共有することでシリアライザへのフィールド追加がここで型エラーとして現れる。
//
// 合成する行の id は `preset-<kind>-<idx>` 形式（表示専用。DB の行 id とは無関係)。
// 並び順はライブテーブル取得時の orderBy と揃える。
import { normalizeKeyRemapType } from "./remap-utils";
import { isValidLoopTransitionValue, normalizeVariationIndex, type LoopStepData } from "./search-craft-loops";
import { resolveVariations, variationMirror } from "./search-craft-variations";
import type {
  PresetKeybindingData,
  PresetPlayerConfigData,
  PresetRemapData,
  PresetItemLayoutData,
  PresetSearchCraftData,
  PresetSearchCraftLoopData,
  PresetLoopStepData,
  PresetCustomKeyData,
  PresetCustomActionData,
} from "./preset-utils";

export type PresetSnapshot = {
  keybindingsData?: string | null;
  playerConfigData?: string | null;
  remapsData?: string | null;
  fingerAssignmentsData?: string | null;
  itemLayoutsData?: string | null;
  searchCraftsData?: string | null;
  searchCraftLoopsData?: string | null;
  customKeysData?: string | null;
  customActionsData?: string | null;
};

export function safeParseArray<T>(json: string | null | undefined): T[] | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? (parsed as T[]) : null;
  } catch {
    // 破損スナップショットで公開ページを落とさない（ライブへフォールバック）
    return null;
  }
}

/**
 * JSON 文字列（例: searchCrafts.items）または既にデコード済みの値を、安全に string[] へ矯正する。
 * 破損 JSON・非配列（`{}` 等）・非文字列要素はすべて捨てて空配列に倒し、
 * 公開ページの SSR を `.map` の TypeError で落とさない（safeParseArray と同じ「破損データで公開面を落とさない」方針）。
 */
export function coerceStringArray(value: unknown): string[] {
  const arr =
    typeof value === "string"
      ? safeParseArray<unknown>(value)
      : Array.isArray(value)
        ? (value as unknown[])
        : null;
  return arr ? arr.filter((item): item is string => typeof item === "string") : [];
}

// ライブ取得時の orderBy（SQLite の BINARY 照合）と揃えるため、ロケール非依存の比較を使う
function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function decodePresetKeybindings(json: string | null | undefined, userId: string) {
  const rows = safeParseArray<PresetKeybindingData>(json);
  if (!rows) return null;
  const now = new Date();
  return rows
    .map((kb, idx) => ({
      id: `preset-kb-${idx}`,
      userId,
      action: kb.action,
      keyCode: kb.keyCode,
      category: kb.category as "movement" | "combat" | "inventory" | "ui",
      createdAt: now,
      updatedAt: now,
    }))
    .sort((a, b) => compareStrings(a.category, b.category) || compareStrings(a.action, b.action));
}

export function decodePresetRemaps(json: string | null | undefined, userId: string) {
  const rows = safeParseArray<PresetRemapData>(json);
  if (!rows) return null;
  const now = new Date();
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
      createdAt: now,
      updatedAt: now,
    }))
    .sort((a, b) => compareStrings(a.sourceKey, b.sourceKey));
}

/** playerConfig はスナップショットの設定オブジェクトをそのまま返す（表示への当てはめは呼び出し側） */
export function decodePresetPlayerConfig(
  json: string | null | undefined,
): PresetPlayerConfigData | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as PresetPlayerConfigData)
      : null;
  } catch {
    return null;
  }
}

export function decodePresetItemLayouts(json: string | null | undefined, userId: string) {
  const rows = safeParseArray<PresetItemLayoutData>(json);
  if (!rows) return null;
  const now = new Date();
  return rows
    .map((layout, idx) => ({
      id: `preset-layout-${idx}`,
      userId,
      segment: layout.segment,
      slots: layout.slots,
      offhand: layout.offhand,
      notes: layout.notes,
      displayOrder: layout.displayOrder,
      createdAt: now,
      updatedAt: now,
    }))
    .sort((a, b) => a.displayOrder - b.displayOrder);
}

/**
 * サーチクラフトのスナップショットを表示用にデコードする。
 * variations は resolveVariations() で正準化し、searchStr/withShift/searchVariations
 * （JSON文字列）は variationMirror() 由来のミラーとして併せて持つ。
 * 戻り値は raw な search_crafts 行（SearchCraft）と構造的に互換なので、
 * ライブ行との入れ替えが必要な既存の呼び出し側（プロフィール等）をそのまま通す。
 * variations フィールドは新しい呼び出し側がバリエーション表示に直接使える追加情報。
 */
export function decodePresetSearchCrafts(json: string | null | undefined, userId: string) {
  const rows = safeParseArray<PresetSearchCraftData>(json);
  if (!rows) return null;
  const now = new Date();
  return rows
    .map((craft, idx) => {
      const variations = resolveVariations({
        variations: craft.variations,
        searchStr: craft.searchStr,
        withShift: craft.withShift,
      });
      const mirror = variationMirror(variations);
      return {
        id: `preset-craft-${idx}`,
        userId,
        sequence: craft.sequence,
        items: craft.items,
        keys: craft.keys,
        searchStr: mirror.searchStr,
        comment: craft.comment,
        timing: craft.timing ?? null,
        withShift: mirror.withShift,
        searchVariations: JSON.stringify(variations),
        variations,
        createdAt: now,
        updatedAt: now,
      };
    })
    .sort((a, b) => a.sequence - b.sequence);
}

/**
 * サーチクラフトLoop（繋ぎ方）のスナップショットを表示用にデコードする。
 * ステップの craftSeq は decodedCrafts（decodePresetSearchCrafts の結果）の
 * sequence フィールドで突合し、合成 id（`preset-craft-${idx}`）へ解決する
 * （decodedCrafts は sequence でソート済みのため、配列位置とは無関係に突合する）。
 * 解決できないステップ（参照切れ）は除去し、残りが2件未満になった Loop は除去する。
 * 破損 JSON・要素の型不正は空配列にフォールバックする（公開ページの SSR を落とさないため）。
 */
export function decodePresetSearchCraftLoops(
  json: string | null | undefined,
  decodedCrafts: { id: string; sequence: number }[],
) {
  const rows = safeParseArray<PresetSearchCraftLoopData>(json);
  if (!rows) return [];

  const seqToId = new Map(decodedCrafts.map((c) => [c.sequence, c.id]));

  const result: {
    id: string;
    sequence: number;
    steps: LoopStepData[];
    comment: string | null;
    timing: PresetSearchCraftLoopData["timing"];
  }[] = [];

  rows.forEach((loop, idx) => {
    if (!loop || !Array.isArray(loop.steps)) return;

    // craftSeq が解決できないステップに加え、transition が構造的に不正なステップも除去する
    // （null は先頭のみ許可 = isValidLoopStepsShape と同じ規則。除去は逐次構築のため、
    // 生存した最初のステップが常に「先頭」として null に上書きされる）
    const steps: LoopStepData[] = [];
    for (const rawStep of loop.steps) {
      if (!rawStep || typeof rawStep !== "object") continue;
      const craftId = seqToId.get((rawStep as PresetLoopStepData).craftSeq);
      if (craftId === undefined) continue;

      const variationIndex = normalizeVariationIndex((rawStep as PresetLoopStepData).variationIndex);
      if (steps.length === 0) {
        // 先頭は transition の形を問わず null に統一する
        steps.push({ craftId, transition: null, variationIndex });
        continue;
      }
      const transition = (rawStep as PresetLoopStepData).transition ?? null;
      if (!isValidLoopTransitionValue(transition)) continue;
      steps.push({ craftId, transition, variationIndex });
    }
    if (steps.length < 2) return;

    result.push({
      id: `preset-loop-${idx}`,
      sequence: loop.sequence,
      steps,
      comment: loop.comment ?? null,
      timing: loop.timing ?? null,
    });
  });

  return result.sort((a, b) => a.sequence - b.sequence);
}

export function decodePresetCustomKeys(json: string | null | undefined, userId: string) {
  const rows = safeParseArray<PresetCustomKeyData>(json);
  if (!rows) return null;
  const now = new Date();
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
      createdAt: now,
      updatedAt: now,
    }))
    .sort((a, b) => compareStrings(a.category, b.category) || compareStrings(a.keyName, b.keyName));
}

export function decodePresetCustomActions(json: string | null | undefined, userId: string) {
  const rows = safeParseArray<PresetCustomActionData>(json);
  if (!rows) return null;
  const now = new Date();
  return rows
    .map((ca, idx) => ({
      id: `preset-customaction-${idx}`,
      userId,
      actionName: ca.actionName,
      description: ca.description,
      category: ca.category,
      triggerKey: ca.triggerKey,
      displayOrder: ca.displayOrder,
      createdAt: now,
      updatedAt: now,
    }))
    .sort(
      (a, b) => a.displayOrder - b.displayOrder || compareStrings(a.actionName, b.actionName),
    );
}

/**
 * 公開面（操作設定一覧・比較・CSV・ガイド埋め込み）が、メイン（公開用）プリセットの
 * スナップショットを表示に使ってよいかを判定する単一の決定点。
 *
 * メインプリセットが同時に「編集中（isActive）」の場合は使ってはならない。
 * 「アクティブプリセット = ライブテーブル」が本システムの不変条件であり、
 * ライブテーブルこそが現在適用中の設定そのものだからである。
 * スナップショットは同期漏れや同期機構の導入前データで古くなりうるため、
 * これを表示すると「現在適用中でない設定」が公開面に出てしまう
 * （プロフィールページは元からライブを表示するため、両者が食い違う）。
 *
 * メインが非アクティブなときだけスナップショットが唯一の情報源になる。
 */
export function shouldUsePresetSnapshot<T extends { isActive: boolean }>(
  preset: T | null | undefined,
): preset is T {
  return !!preset && !preset.isActive;
}

/**
 * スナップショット全種別を一括デコードし、そのプリセットの「完全な内容」を返す。
 * スナップショットが null の種別は「空」を意味する（apply-preset の対称復元と同じ正準解釈）ため
 * 空配列を返す — ライブテーブルへフォールバックしてはならない（編集中データの漏出になる）。
 * ライブへのフォールバックは「プリセット自体が存在しない」場合にのみ呼び出し側で行うこと。
 * playerConfig / fingerAssignments のみ null があり得る（設定なし）。
 */
export function decodePresetConfig(preset: PresetSnapshot, userId: string) {
  const searchCrafts = decodePresetSearchCrafts(preset.searchCraftsData, userId) ?? [];
  return {
    keybindings: decodePresetKeybindings(preset.keybindingsData, userId) ?? [],
    keyRemaps: decodePresetRemaps(preset.remapsData, userId) ?? [],
    playerConfig: decodePresetPlayerConfig(preset.playerConfigData),
    fingerAssignments: preset.fingerAssignmentsData ?? null,
    itemLayouts: decodePresetItemLayouts(preset.itemLayoutsData, userId) ?? [],
    searchCrafts,
    searchCraftLoops: decodePresetSearchCraftLoops(preset.searchCraftLoopsData, searchCrafts),
    customKeys: decodePresetCustomKeys(preset.customKeysData, userId) ?? [],
    customActions: decodePresetCustomActions(preset.customActionsData, userId) ?? [],
  };
}
