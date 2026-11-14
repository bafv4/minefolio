// ホーム（ログイン時）の欄の並び順・表示。users.homeSectionOrder（JSON。`{"order":[...],"hidden":[...]}`、旧形式は並びのみの配列、null = 既定）で保存する。
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

export interface HomeLayout {
  /** 全欄が1回ずつ並ぶ順序 */
  order: HomeSectionId[];
  /** 非表示にする欄（全欄にはならない） */
  hidden: HomeSectionId[];
}

export function defaultHomeLayout(): HomeLayout {
  return { order: [...DEFAULT_HOME_SECTION_ORDER], hidden: [] };
}

export function pickKnownHomeSectionIds(value: unknown): HomeSectionId[] {
  const seen = new Set<HomeSectionId>();
  if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item === "string" && ID_SET.has(item)) seen.add(item as HomeSectionId);
    }
  }
  return [...seen];
}

/**
 * 保存値（JSON 文字列 or 配列 or オブジェクト）をホームのレイアウトへ正規化する。
 * - 旧形式（欄 ID の配列）= 並びのみ、hidden は空
 * - 新形式（{ order, hidden }）
 * 解釈できなければ既定。未知 ID・重複は除き、order の欠けは既定順で末尾に補う。
 * hidden が全欄を覆う場合は hidden を空として扱う（全部消えたホームにしない）。
 */
export function normalizeHomeLayout(raw: unknown): HomeLayout {
  let value: unknown = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return defaultHomeLayout();
    }
  }
  let rawOrder: unknown;
  let rawHidden: unknown;
  if (Array.isArray(value)) {
    rawOrder = value;
  } else if (value && typeof value === "object") {
    rawOrder = (value as { order?: unknown }).order;
    rawHidden = (value as { hidden?: unknown }).hidden;
  } else {
    return defaultHomeLayout();
  }
  const seen = new Set<HomeSectionId>(pickKnownHomeSectionIds(rawOrder));
  for (const id of DEFAULT_HOME_SECTION_ORDER) seen.add(id);
  const order = [...seen];
  const hidden = pickKnownHomeSectionIds(rawHidden);
  return { order, hidden: hidden.length >= order.length ? [] : hidden };
}

export function isDefaultHomeLayout(layout: HomeLayout): boolean {
  return (
    layout.hidden.length === 0 &&
    layout.order.length === DEFAULT_HOME_SECTION_ORDER.length &&
    layout.order.every((id, i) => id === DEFAULT_HOME_SECTION_ORDER[i])
  );
}

/** 保存用の文字列。既定のときは null（列を空にする） */
export function serializeHomeLayout(layout: HomeLayout): string | null {
  return isDefaultHomeLayout(layout) ? null : JSON.stringify({ order: layout.order, hidden: layout.hidden });
}
