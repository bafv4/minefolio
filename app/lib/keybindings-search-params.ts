// /keybindings 配下の URL ↔ state 同期用 nuqs parser 定義。
// すべてのビュー（grid/table/stats）とサブタブ、フィルタを統合管理する。
import {
  parseAsArrayOf,
  parseAsFloat,
  parseAsString,
  parseAsStringEnum,
} from "nuqs";

/**
 * 表ビュー内のサブタブ。操作はプレイヤー画面と同じ粒度
 * （移動 / インベントリ / 戦闘・UI）で分け、加えてリマップ・カスタム・マウス。
 * ビュー（表 / ビジュアル / 統計）自体は独立ルートに分割済み。
 */
export const TAB_OPTIONS = [
  "movement",
  "inventory",
  "combat-ui",
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
  tab: parseAsStringEnum([...TAB_OPTIONS]).withDefault("movement"),
  dpiMin: parseAsFloat,
  dpiMax: parseAsFloat,
  sensMin: parseAsFloat,
  sensMax: parseAsFloat,
  cm360Min: parseAsFloat,
  cm360Max: parseAsFloat,
  /** 表示するユーザーを限定する slug 一覧（空なら全件表示）。表・ビジュアル横断で適用。 */
  users: parseAsArrayOf(parseAsString).withDefault([]),
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
