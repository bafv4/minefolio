// /compare の類似走者の並び順（純粋関数）。
// ルートモジュール（app/routes/compare.tsx）に置くと、React Router のルート分割（split-route-modules）が
// export した定数の依存解析で落ちるため、通常のモジュールに分けている。

/** 「比べられる設定が十分ある」とみなす最低の分母（比較対象の操作数の半数以上） */
export function minComparableActions(actionCount: number): number {
  return Math.ceil(actionCount / 2);
}

/**
 * 類似走者の並び順。比べられた操作の数（total）が最低の分母以上の人を先に、足りない人を後ろへ回し、
 * それぞれの中を 一致率 → 分母の大きい順 → slug 順 に並べる。
 * 「10/10」が「25/26」より上に来て、設定の少ない人ほど上位になるのを防ぐ。足りない人も除外はせず後ろに残す。
 */
export function sortSimilarPlayers<T extends { slug: string; total: number; similarity: number }>(
  rows: T[],
  minTotal: number,
): T[] {
  return [...rows].sort((a, b) => {
    const aOk = a.total >= minTotal;
    const bOk = b.total >= minTotal;
    if (aOk !== bOk) return aOk ? -1 : 1;
    return b.similarity - a.similarity || b.total - a.total || a.slug.localeCompare(b.slug);
  });
}
