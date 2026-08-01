// ガイド一覧・テンプレート一覧の並び順の定義。
// URLクエリ `?sort=` を唯一の指定元にする（共有・ブックマーク可）。
//
// UI（components/content-sort-select.tsx）とローダー（likes.server.ts の
// guideListOrderBy）の両方が参照するため、React に依存しないここに置く。

export type ContentSort = "new" | "likes" | "views" | "popular";

/** 既定の並び順（`?sort=` 未指定・不正値のときの落とし先） */
export const DEFAULT_CONTENT_SORT: ContentSort = "new";

/**
 * ガイド一覧で使える並び順（この順で UI に表示する）。
 * - new: 更新日時
 * - likes: 総いいね数
 * - views: 累計閲覧数（guides.view_count）
 * - popular: 直近7日のページビュー（page_view_stats）
 */
export const GUIDE_SORTS = ["new", "likes", "views", "popular"] as const satisfies readonly ContentSort[];

/**
 * テンプレート一覧で使える並び順。
 * - new: 作成日時
 * - likes: 総いいね数
 *
 * ※ `popular`（＝直近7日のページビュー）はガイド専用。テンプレートには
 *    ページビュー集計が無い（個別ページの URL が /guides/templates/:id で
 *    page-view-paths.ts の対象外）ため、以前は同じ「人気順」ラベルのまま
 *    総いいね数で並べていた。一覧ごとにラベルと基準が食い違うのを避けるため、
 *    テンプレート側は基準どおり `likes`（いいね数順）を出す。
 */
export const TEMPLATE_SORTS = ["new", "likes"] as const satisfies readonly ContentSort[];

/**
 * URLクエリ文字列から並び順を解釈する。
 * `allowed` を必須にしているのは、一覧ごとに選択肢が違うため
 * （テンプレート一覧で `?sort=views` を受けると、UI の表示と実際の順序がずれる）。
 */
export function parseContentSort(
  value: string | null,
  allowed: readonly ContentSort[],
): ContentSort {
  return allowed.includes(value as ContentSort) ? (value as ContentSort) : DEFAULT_CONTENT_SORT;
}
