// ガイド一覧・テンプレート一覧の並び順の定義。
// URLクエリ `?sort=` を唯一の指定元にする（共有・ブックマーク可）。
//
// UI（components/content-sort-select.tsx）とローダー（likes.server.ts の
// guideListOrderBy）の両方が参照するため、React に依存しないここに置く。

export type ContentSort = "new" | "popular" | "recommended";

/** 既定の並び順（`?sort=` 未指定・不正値のときの落とし先） */
export const DEFAULT_CONTENT_SORT: ContentSort = "new";

/**
 * ガイド一覧で使える並び順。
 * 「おすすめ順」は直近のいいねを主軸にするので、ガイドにのみ用意している。
 */
export const GUIDE_SORTS = ["new", "recommended", "popular"] as const satisfies readonly ContentSort[];

/** テンプレート一覧で使える並び順 */
export const TEMPLATE_SORTS = ["new", "popular"] as const satisfies readonly ContentSort[];

/**
 * URLクエリ文字列から並び順を解釈する。
 * `allowed` を必須にしているのは、一覧ごとに選択肢が違うため
 * （テンプレート一覧で `?sort=recommended` を受けると、UI の表示と実際の順序がずれる）。
 */
export function parseContentSort(
  value: string | null,
  allowed: readonly ContentSort[],
): ContentSort {
  return allowed.includes(value as ContentSort) ? (value as ContentSort) : DEFAULT_CONTENT_SORT;
}
