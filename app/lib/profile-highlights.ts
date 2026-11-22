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

/** pickRepresentativePb が参照する speedrun.com PB の最小形（SpeedrunComPersonalBest の部分集合） */
export interface HighlightSpeedrunComPb {
  place: number;
  run: { id: string; level?: string; values?: Record<string, string>; times: { primary_t: number } };
  /** speedrun.com の game 資源（`abbreviation`。embed=game.platforms で取得済み。`names` は表示名用） */
  game?: { data?: { abbreviation?: string; names?: { international?: string } } };
  category?: {
    data?: {
      name?: string;
      /** speedrun.com の category 資源の `miscellaneous`（Co-op 等の「その他」カテゴリ。API 応答には含まれるが外部統計の型には未定義） */
      miscellaneous?: boolean;
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
 * 公式カテゴリの game（speedrun.com の abbreviation）。Minecraft の Java / Bedrock 本体のリーダーボードのみ。
 * Category Extensions（mcce / mcbece）・Unofficial（mc_juice / mcbeuce）・Datapack & Modded（mc_dmce）等は別 game なので対象外
 */
const OFFICIAL_GAME_ABBREVIATIONS: ReadonlySet<string> = new Set(["mc", "mcbe"]);

/**
 * 代表 PB に使える「公式カテゴリ」の PB か。
 * - 別 game の拡張・非公式カテゴリ（上記以外の abbreviation）は false。abbreviation が取れないデータは判定できないので除外しない
 * - 「その他（miscellaneous）」カテゴリ（Co-op 等）とレベル（IL）は false
 */
export function isOfficialSpeedrunComPb(pb: HighlightSpeedrunComPb): boolean {
  if (pb.run.level) return false;
  if (pb.category?.data?.miscellaneous) return false;
  const abbreviation = pb.game?.data?.abbreviation?.toLowerCase();
  return abbreviation === undefined || OFFICIAL_GAME_ABBREVIATIONS.has(abbreviation);
}

/** 表示対象の PB（非表示・記録時間 0 以下を除く）。同名カテゴリの判定（speedrunComPbDisplayName の siblings）にもこれを使う */
export function visibleSpeedrunComPbs<T extends HighlightSpeedrunComPb>(
  personalBests: readonly T[],
  hiddenRunIds: readonly string[],
): T[] {
  const hidden = new Set(hiddenRunIds);
  return personalBests.filter((pb) => !hidden.has(pb.run.id) && pb.run.times.primary_t > 0);
}

function pickPinnedPb<T extends HighlightSpeedrunComPb>(visible: readonly T[], pinnedRunIds: readonly string[]): T | null {
  const pinned = new Set(pinnedRunIds);
  return visible.find((pb) => pinned.has(pb.run.id)) ?? null;
}

function pickMainCategoryPb<T extends HighlightSpeedrunComPb>(
  visible: readonly T[],
  mainCategory: string | null | undefined,
): T | null {
  if (!mainCategory) return null;
  const matched = visible
    .filter((pb) => speedrunComPbMatchesMainCategory(pb, mainCategory))
    .sort((a, b) => a.run.times.primary_t - b.run.times.primary_t);
  return matched[0] ?? null;
}

function pickOfficialPb<T extends HighlightSpeedrunComPb>(visible: readonly T[]): T | null {
  const official = visible.filter(isOfficialSpeedrunComPb);
  if (official.length === 0) return null;
  return official.reduce((best, pb) => (pb.place < best.place ? pb : best));
}

/** 記録タブの speedrun.com カードの DOM id（身元帯の代表 PB タイルからのスクロール先） */
export function statsSrcCardId(runId: string): string {
  return `stats-src-${runId}`;
}

/** 表示名の組み立て（speedrunComPbDisplayName）が参照する PB の形（SpeedrunComPersonalBest の部分集合） */
export interface LabelableSpeedrunComPb extends HighlightSpeedrunComPb {
  platformName?: string;
  versionName?: string;
  subcategoryName?: string;
}

/** 版の短い名前。game 名 "Minecraft: Java Edition" → "Java"。game 名が無ければ platformName、それも無ければ空文字 */
function speedrunComEditionLabel(pb: LabelableSpeedrunComPb): string {
  const name = pb.game?.data?.names?.international;
  if (name) {
    const short = name.replace(/^minecraft\s*:?\s*/i, "").replace(/\s*edition$/i, "").trim();
    if (short) return short;
  }
  return pb.platformName?.trim() ?? "";
}

/**
 * speedrun.com の PB の表示名（カテゴリ名）。同じカテゴリ名の PB が siblings にほかにあるときだけ、版を添える
 * （"Java · Any% Glitchless"。Java と Bedrock の両方に Any% Glitchless がある走者の見分け用）。
 * 版まで同じならさらに versionName を括弧で足す。siblings は表示対象（非表示を除いたもの）を渡す
 */
export function speedrunComPbDisplayName<T extends LabelableSpeedrunComPb>(
  pb: T,
  siblings: readonly T[],
  unknownLabel: string,
): string {
  const { title, detail } = speedrunComPbNameParts(pb, siblings, unknownLabel);
  return detail ? `${title} (${detail})` : title;
}

/**
 * speedrunComPbDisplayName を「名前」と「見分けの語（バージョン・サブカテゴリ）」に分けたもの。
 * カードでは title を名前に、detail を2行目の小さな文字に出して、末尾が切れて見分けられなくなるのを防ぐ
 */
export function speedrunComPbNameParts<T extends LabelableSpeedrunComPb>(
  pb: T,
  siblings: readonly T[],
  unknownLabel: string,
): { title: string; detail: string } {
  const name = pb.category?.data?.name ?? unknownLabel;
  const same = siblings.filter((o) => o.run.id !== pb.run.id && (o.category?.data?.name ?? unknownLabel) === name);
  if (same.length === 0) return { title: name, detail: "" };
  const edition = speedrunComEditionLabel(pb);
  const base = edition ? `${edition} · ${name}` : name;
  const sameEdition = same.some((o) => speedrunComEditionLabel(o) === edition);
  if (!sameEdition) return { title: base, detail: "" };
  // 版まで同じなら、バージョン名とサブカテゴリ（人数など）で見分ける
  return { title: base, detail: [pb.versionName, pb.subcategoryName].filter(Boolean).join(", ") };
}

/** 記録カードの「機種 / バージョン / サブカテゴリ（人数など）」の行。無ければ空文字。走者画面と /me/records で共有する */
export function speedrunComPbMetaLine(pb: LabelableSpeedrunComPb): string {
  return [pb.platformName, pb.versionName, pb.subcategoryName].filter(Boolean).join(" / ");
}

/** MCSR Ranked の自己ベスト判定に使う最小形（MCSRRankedStats の部分集合） */
export interface HighlightRankedStats {
  isRegistered: boolean;
  seasonData?: { bestTimeAllTime?: number; bestTime?: number } | null;
}

/** Ranked の代表記録（ミリ秒）。全期間のベストを優先し、無ければ今シーズンのベスト。未登録・記録なしは null */
export function rankedBestTimeMs(ranked: HighlightRankedStats | null | undefined): number | null {
  if (!ranked?.isRegistered) return null;
  const time = ranked.seasonData?.bestTimeAllTime ?? ranked.seasonData?.bestTime;
  return typeof time === "number" && time > 0 ? time : null;
}

export type RepresentativePb<R extends HighlightPbRecord, S extends HighlightSpeedrunComPb> =
  | { kind: "speedruncom"; pb: S }
  | { kind: "ranked"; timeMs: number }
  | { kind: "custom"; record: R };

/**
 * 身元帯・活動記録タブの代表 PB を選ぶ（両者はこの関数を共有して食い違わせない）。優先順:
 * 1) 活動・記録タブでピン留めした speedrun.com の記録
 * 2) メインカテゴリの記録（speedrun.com で対応するもの。メインカテゴリが ranked なら MCSR Ranked の自己ベスト）
 * 3) speedrun.com の公式カテゴリの記録（順位が最上位）
 * 4) 手入力のカスタム記録（メインカテゴリ一致の最速 → 先頭の PB 付き記録）
 * 非表示にした speedrun.com の記録は候補から外す。どれも無ければ null
 */
export function pickRepresentativePb<R extends HighlightPbRecord, S extends HighlightSpeedrunComPb>(args: {
  mainCategory: string | null | undefined;
  records: readonly R[];
  speedrunComPbs: readonly S[];
  hiddenRunIds: readonly string[];
  pinnedRunIds: readonly string[];
  /** MCSR Ranked の代表記録（ms）。メインカテゴリが ranked のときだけ使われる */
  rankedTimeMs: number | null;
}): RepresentativePb<R, S> | null {
  const { mainCategory, records, speedrunComPbs, hiddenRunIds, pinnedRunIds, rankedTimeMs } = args;
  const visible = visibleSpeedrunComPbs(speedrunComPbs, hiddenRunIds);

  const pinned = pickPinnedPb(visible, pinnedRunIds);
  if (pinned) return { kind: "speedruncom", pb: pinned };

  if (mainCategory === "ranked" && rankedTimeMs != null) return { kind: "ranked", timeMs: rankedTimeMs };
  const main = pickMainCategoryPb(visible, mainCategory);
  if (main) return { kind: "speedruncom", pb: main };

  const official = pickOfficialPb(visible);
  if (official) return { kind: "speedruncom", pb: official };

  const custom = pickHighlightPb(mainCategory, records, true);
  return custom ? { kind: "custom", record: custom.record } : null;
}
