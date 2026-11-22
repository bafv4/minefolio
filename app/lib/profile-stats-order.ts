// 走者画面の記録タブ（tab=stats）で、外部統計の欄をどの順に並べるか（純粋関数）。
// 本人のメインカテゴリ（playstyle.mainCategory）に合う欄を先頭へ置く。

import { isCategoryKey, type CategoryKey } from "@/lib/playstyle";

/** paceman は PaceMan のリンク＋過去1週間統計、speedruncom は Speedrun.com ＋審査中の記録を含む欄の束 */
export type StatsSectionKey = "ranked" | "paceman" | "speedruncom";

const DEFAULT_ORDER: readonly StatsSectionKey[] = ["ranked", "paceman", "speedruncom"];

/**
 * メインカテゴリ別の外部統計欄の先頭:
 * - ranked → MCSR Ranked
 * - rsg / ssg / aa / ce → Speedrun.com（審査中の記録はその直後の同じ束）
 * - other / 未設定 / 不明な値 → 既定の並び（ranked → paceman → speedruncom）
 * 残りは既定の相対順のまま。
 */
export function orderStatsSections(mainCategory: string | null | undefined): StatsSectionKey[] {
  const category: CategoryKey | null = isCategoryKey(mainCategory) ? mainCategory : null;
  let first: StatsSectionKey | null = null;
  if (category === "ranked") first = "ranked";
  else if (category === "rsg" || category === "ssg" || category === "aa" || category === "ce") first = "speedruncom";
  if (!first) return [...DEFAULT_ORDER];
  return [first, ...DEFAULT_ORDER.filter((k) => k !== first)];
}
