// プロフィールのハイライト行 / 一覧カードで使う「メインカテゴリの PB」選択ロジック（純粋関数）。
// category_records.category は自由入力（例: "rsg_any"）で playstyle.mainCategory（"rsg" 等）と
// 厳密には紐づかないため、キー一致（前方一致）で突き合わせる。

export interface HighlightPbRecord {
  category: string;
  categoryDisplayName: string;
  personalBest: number | null;
}

/** 記録の category が playstyle.mainCategory に属するか（"rsg" と "rsg_any" / "rsg-any" / "RSG"） */
export function recordMatchesMainCategory(category: string, mainCategory: string): boolean {
  if (mainCategory === "other") return false;
  const c = category.trim().toLowerCase();
  return c === mainCategory || c.startsWith(`${mainCategory}_`) || c.startsWith(`${mainCategory}-`);
}

/**
 * ハイライト用の PB 記録を選ぶ。records は呼び出し側の表示順（ピン留め → displayOrder）のまま渡す。
 * - mainCategory に一致する PB 付き記録のうち最速のもの（matched: true）
 * - 無ければ allowFallback のとき、先頭の PB 付き記録（matched: false）
 */
export function pickHighlightPb<T extends HighlightPbRecord>(
  mainCategory: string | null | undefined,
  records: readonly T[],
  allowFallback = false,
): { record: T; matched: boolean } | null {
  const withPb = records.filter((r) => r.personalBest != null && r.personalBest > 0);
  if (mainCategory) {
    const matched = withPb
      .filter((r) => recordMatchesMainCategory(r.category, mainCategory))
      .sort((a, b) => (a.personalBest as number) - (b.personalBest as number));
    if (matched[0]) return { record: matched[0], matched: true };
  }
  if (allowFallback && withPb[0]) return { record: withPb[0], matched: false };
  return null;
}
