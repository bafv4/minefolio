/**
 * /me/search-craft の保存ペイロード（クラフト・Loop）の行単位の検証。
 * Loop の steps の構造検証は search-craft-loops の isValidLoopStepsShape に委ねる。
 */
import { SAVE_LIMITS, isStringWithin } from "@/lib/save-limits";
import { MAX_LOOP_STEPS, SEARCH_CRAFT_TIMINGS, type SearchCraftTiming } from "@/lib/search-craft-templates";

/**
 * 区間（timing）の入力を解釈する。未指定・null・空文字は「区分なし」（null）。
 * 許可リスト（SEARCH_CRAFT_TIMINGS）にない値は undefined（呼び出し側でエラーにする。null に丸めない）。
 */
export function parseTimingInput(value: unknown, stored?: string | null): SearchCraftTiming | null | undefined {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") return undefined;
  // 既に保存されている値と同じなら通す（過去に許可リスト外の値が保存された行を、別の編集のたびに拒否しない）。
  // null には丸めず保存値のまま書き戻す
  if (stored !== undefined && stored !== null && value === stored) return value as SearchCraftTiming;
  return (SEARCH_CRAFT_TIMINGS as readonly string[]).includes(value) ? (value as SearchCraftTiming) : undefined;
}

/** 既存行の保存値（id が一致する行）。同じ値が送り返された欄は許可リスト・長さの検査を免除する */
export type StoredRow = { timing: string | null; comment: string | null };

function isValidComment(value: unknown, stored?: StoredRow): boolean {
  if (typeof value === "string" && stored?.comment === value) return true;
  return value === undefined || value === null || isStringWithin(value, SAVE_LIMITS.craftComment);
}

/** クラフト1行（id 以外の中身）。items は string[]（公開ガイド埋め込みの SSR が items.map で落ちないように） */
export function isValidCraftRow(craft: Record<string, unknown>, stored?: StoredRow): boolean {
  if (
    !Array.isArray(craft.items) ||
    craft.items.length > SAVE_LIMITS.craftItems ||
    !craft.items.every((item) => isStringWithin(item, SAVE_LIMITS.shortText))
  ) {
    return false;
  }
  if (!isValidComment(craft.comment, stored)) return false;
  if (parseTimingInput(craft.timing, stored?.timing) === undefined) return false;
  if (craft.searchStr !== undefined && craft.searchStr !== null && !isStringWithin(craft.searchStr, SAVE_LIMITS.craftSearchString)) {
    return false;
  }
  if (Array.isArray(craft.variations)) {
    for (const v of craft.variations as unknown[]) {
      const str = (v as { str?: unknown } | null)?.str;
      if (typeof str === "string" && str.length > SAVE_LIMITS.craftSearchString) return false;
    }
  }
  return true;
}

/** Loop 1行（id 以外）。steps の数は MAX_LOOP_STEPS まで */
export function isValidLoopRow(loop: Record<string, unknown>, stored?: StoredRow): boolean {
  if (!isValidComment(loop.comment, stored)) return false;
  if (parseTimingInput(loop.timing, stored?.timing) === undefined) return false;
  return !Array.isArray(loop.steps) || loop.steps.length <= MAX_LOOP_STEPS;
}

/** 行の id: 空でない文字列で、ペイロード内で重複しない */
export function hasValidUniqueIds(rows: Array<{ id?: unknown }>): boolean {
  const seen = new Set<string>();
  for (const row of rows) {
    if (!isStringWithin(row.id, SAVE_LIMITS.shortText) || !row.id || seen.has(row.id)) return false;
    seen.add(row.id);
  }
  return true;
}
