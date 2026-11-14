// ホーム（ログイン時）の欄の並び順。users.homeSectionOrder（JSON 配列文字列、null = 既定順）で保存する。
// クライアントからも使うため .server ではない。

export const HOME_SECTION_IDS = ["favoriteActivity", "live", "videos", "guides", "featured", "profiles"] as const;

export type HomeSectionId = (typeof HOME_SECTION_IDS)[number];

/** 既定の並び（保存値が無い場合・不正な場合はこれ） */
export const DEFAULT_HOME_SECTION_ORDER: readonly HomeSectionId[] = HOME_SECTION_IDS;

/** 欄 ID に対応する翻訳キー（既存のホーム見出しキーを流用） */
export const HOME_SECTION_LABEL_KEYS = {
  favoriteActivity: "home.favTitle",
  live: "home.liveTitle",
  videos: "home.sectionVideos",
  guides: "home.sectionGuides",
  featured: "home.featuredTitle",
  profiles: "home.sectionProfiles",
} as const satisfies Record<HomeSectionId, string>;

const ID_SET: ReadonlySet<string> = new Set(HOME_SECTION_IDS);

/**
 * 保存値（JSON 文字列 or 配列）を、全欄が1回ずつ並ぶ配列へ正規化する。
 * 解釈できなければ既定順。未知 ID・重複は除き、欠けた ID は既定順で末尾に補う。
 */
export function normalizeHomeSectionOrder(raw: unknown): HomeSectionId[] {
  let value: unknown = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return [...DEFAULT_HOME_SECTION_ORDER];
    }
  }
  if (!Array.isArray(value)) return [...DEFAULT_HOME_SECTION_ORDER];
  const seen = new Set<HomeSectionId>();
  for (const item of value) {
    if (typeof item === "string" && ID_SET.has(item)) seen.add(item as HomeSectionId);
  }
  for (const id of DEFAULT_HOME_SECTION_ORDER) seen.add(id);
  return [...seen];
}

export function isDefaultHomeSectionOrder(order: readonly HomeSectionId[]): boolean {
  return order.length === DEFAULT_HOME_SECTION_ORDER.length && order.every((id, i) => id === DEFAULT_HOME_SECTION_ORDER[i]);
}
