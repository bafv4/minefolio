import type { RankingsArgs } from "./rankings-query.server";

/**
 * /rankings の URL の検索条件（tab / category / rankedType）を解釈する。loader とクライアント（遷移先の表の種類）で共有するため
 * `.server` ではないモジュールに置く（型だけ server から import する）。
 * - tab: "ranked" / "speedruncom" の明示を優先。無い・不正なときは、Speedrun.com のカテゴリがあれば speedruncom、
 *   1件も無ければデータのある Ranked へ
 * - rankedType: "elo" 以外は pb（URL の値をそのまま型に流さない）
 */
export function resolveRankingsParams(
  searchParams: URLSearchParams,
  { hasCategories }: { hasCategories: boolean },
): RankingsArgs {
  const tabParam = searchParams.get("tab");
  const tab = tabParam === "ranked" || tabParam === "speedruncom" ? tabParam : hasCategories ? "speedruncom" : "ranked";
  return {
    tab,
    categorySlug: searchParams.get("category"),
    rankedType: searchParams.get("rankedType") === "elo" ? "elo" : "pb",
  };
}
