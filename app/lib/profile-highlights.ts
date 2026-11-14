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

// ============================================
// speedrun.com の PB（手入力記録に PB が無いときのフォールバック）
// ============================================

/** pickHighlightSpeedrunComPb が参照する speedrun.com PB の最小形（SpeedrunComPersonalBest の部分集合） */
export interface HighlightSpeedrunComPb {
  place: number;
  run: { id: string; level?: string; values?: Record<string, string>; times: { primary_t: number } };
  category?: {
    data?: {
      name?: string;
      variables?: { data?: { id: string; values: { values: Record<string, { label: string }> } }[] };
    };
  };
}

/** run が選んでいる variables の値ラベル（"Random Seed" / "Set Seed" 等）を小文字で返す */
function variableLabels(pb: HighlightSpeedrunComPb): string[] {
  const labels: string[] = [];
  for (const variable of pb.category?.data?.variables?.data ?? []) {
    const valueId = pb.run.values?.[variable.id];
    const label = valueId ? variable.values.values[valueId]?.label : undefined;
    if (label) labels.push(label.toLowerCase());
  }
  return labels;
}

/**
 * speedrun.com の PB が playstyle.mainCategory に確実に対応するか。曖昧なものは false。
 * - rsg / ssg: カテゴリ名が "Any%" で始まり（"glitched" を含まない）、シード種別の値ラベルが
 *   "random seed" / "set seed"（または rsg / ssg）であること
 * - aa: カテゴリ名が "All Advancements"（または単語としての "AA"）
 * - ce / ranked / other: speedrun.com 側に確実な対応が無いので常に false
 */
export function speedrunComPbMatchesMainCategory(pb: HighlightSpeedrunComPb, mainCategory: string): boolean {
  if (pb.run.level) return false;
  const name = (pb.category?.data?.name ?? "").trim().toLowerCase();
  if (!name) return false;
  if (mainCategory === "rsg" || mainCategory === "ssg") {
    if (!name.startsWith("any%") || name.includes("glitched")) return false;
    const seedWord = mainCategory === "rsg" ? "random seed" : "set seed";
    const short = mainCategory;
    return variableLabels(pb).some((l) => l.includes(seedWord) || l === short);
  }
  if (mainCategory === "aa") return name.includes("all advancements") || /\baa\b/.test(name);
  return false;
}

/**
 * ハイライト用の speedrun.com PB を選ぶ（非表示は除外）。
 * 1) ピン留め（speedrun.com カードの表示順＝personalBests の並びの先頭）
 * 2) mainCategory に確実に対応するもののうち最速
 * 3) 順位（place）が最上位（同順位は並びの先頭）
 */
export function pickHighlightSpeedrunComPb<T extends HighlightSpeedrunComPb>(
  mainCategory: string | null | undefined,
  personalBests: readonly T[],
  hiddenRunIds: readonly string[],
  pinnedRunIds: readonly string[],
): T | null {
  const hidden = new Set(hiddenRunIds);
  const pinned = new Set(pinnedRunIds);
  const visible = personalBests.filter((pb) => !hidden.has(pb.run.id) && pb.run.times.primary_t > 0);
  if (visible.length === 0) return null;

  const pinnedPb = visible.find((pb) => pinned.has(pb.run.id));
  if (pinnedPb) return pinnedPb;

  if (mainCategory) {
    const matched = visible
      .filter((pb) => speedrunComPbMatchesMainCategory(pb, mainCategory))
      .sort((a, b) => a.run.times.primary_t - b.run.times.primary_t);
    if (matched[0]) return matched[0];
  }

  return visible.reduce((best, pb) => (pb.place < best.place ? pb : best));
}

// ============================================
// ハイライト行の無限ループ自動スクロール（純粋関数）
// ============================================

/** 現在位置より右にある最初のタイルの左端（相対オフセット）。無ければ null */
export function nextTileOffset(scrollLeft: number, tileOffsets: readonly number[]): number | null {
  const next = tileOffsets.find((o) => o > scrollLeft + 1);
  return next ?? null;
}

/**
 * 複製セットに入ったスクロール位置を元セットの対応位置へ戻す。
 * period は元セット先頭から複製セット先頭までの距離（タイル幅の合計 + gap）。
 * 元セット内（period 未満）ならそのまま返す。
 */
export function normalizeLoopScroll(scrollLeft: number, period: number): number {
  if (period <= 0 || scrollLeft < period) return scrollLeft;
  return scrollLeft - Math.floor(scrollLeft / period) * period;
}
