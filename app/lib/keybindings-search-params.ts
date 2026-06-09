// /keybindings 配下の URL ↔ state 同期用 nuqs parser 定義。
// すべてのビュー（table/grid/stats/compare）とサブタブ、フィルタを統合管理する。
import {
  parseAsArrayOf,
  parseAsFloat,
  parseAsString,
  parseAsStringEnum,
} from "nuqs";

/** ビュー */
export const VIEW_OPTIONS = ["table", "grid", "stats", "compare"] as const;
export type View = (typeof VIEW_OPTIONS)[number];

/** テーブルビュー内のサブタブ */
export const TAB_OPTIONS = [
  "actions",
  "remaps",
  "custom-actions",
  "mouse",
] as const;
export type Tab = (typeof TAB_OPTIONS)[number];

/**
 * nuqs の useQueryStates にそのまま渡せる parser マップ。
 * - `q` は loader に届ける必要があるため、利用側で `{ shallow: false }` を指定すること。
 * - 他のフィルタはクライアント側で完結する（loader 再走しない）。
 */
export const keybindingsParsers = {
  view: parseAsStringEnum([...VIEW_OPTIONS]).withDefault("table"),
  tab: parseAsStringEnum([...TAB_OPTIONS]).withDefault("actions"),
  q: parseAsString.withDefault(""),
  dpiMin: parseAsFloat,
  dpiMax: parseAsFloat,
  sensMin: parseAsFloat,
  sensMax: parseAsFloat,
  cm360Min: parseAsFloat,
  cm360Max: parseAsFloat,
  /** 比較バスケットの走者 slug 一覧 */
  ids: parseAsArrayOf(parseAsString).withDefault([]),
  /** ソート "key:dir" 形式（例: "cm360:asc"） */
  sort: parseAsString.withDefault(""),
} as const;

/** ソート文字列のパース */
export function parseSort(
  raw: string,
): { key: string; direction: "asc" | "desc" } | null {
  if (!raw) return null;
  const [key, dir] = raw.split(":");
  if (!key || (dir !== "asc" && dir !== "desc")) return null;
  return { key, direction: dir };
}

/** ソート文字列の組み立て */
export function formatSort(key: string, direction: "asc" | "desc"): string {
  return `${key}:${direction}`;
}
