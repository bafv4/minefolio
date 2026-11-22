// ガイドの tags 列（JSON文字列）を防御的にパースする（葉モジュール・依存なし）。
// DB に不正な JSON が1行でも混入すると、無防備な JSON.parse がそのまま例外化して
// 一覧・詳細ページ全体が 500 になるため、guides 関連の全画面はこれを単一情報源として使う。
export function parseGuideTags(tags: string | null | undefined): string[] {
  if (!tags) return [];
  try {
    const v = JSON.parse(tags);
    return Array.isArray(v) ? v.filter((t): t is string => typeof t === "string") : [];
  } catch {
    return [];
  }
}

/**
 * タグ絞り込みのレールに並べるタグを返す。
 * 件数の多い順、同数は名前順（`localeCompare`。ロケールに合わせる）。
 * 一覧の並び替え（新着・人気）に依存しないよう、入力の順序には左右されない。
 */
export function rankGuideTags(
  tagCounts: Record<string, number>,
  locale: string,
  limit = 20,
): string[] {
  return Object.entries(tagCounts)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], locale))
    .slice(0, limit)
    .map(([name]) => name);
}
