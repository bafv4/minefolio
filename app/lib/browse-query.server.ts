// /browse と /api/browse 共通のクエリビルダー。
// 検索 / フィルタ / ソート + ページネーションを一元管理し、二重実装を防ぐ。
import { and, asc, desc, eq, inArray, like, or, sql } from "drizzle-orm";
import { users } from "./schema";
import type { Database } from "./db";
import { excludeViewersCondition } from "./users-filter";
import { getFavoritesFromDb } from "./favorites";

export const BROWSE_ITEMS_PER_PAGE = 12;

export type BrowseSortOption = "updatedAt" | "mcid" | "displayName";

export type BrowseFilterRole = "runner" | "viewer";
export type BrowseFilterEdition = "java" | "bedrock";
export type BrowseFilterInputMethod = "keyboard_mouse" | "controller" | "touch";
export type BrowseFilterPlatform =
  | "pc_windows"
  | "pc_mac"
  | "pc_linux"
  | "switch"
  | "mobile"
  | "other";

export interface BrowseQueryArgs {
  q: string;
  sort: BrowseSortOption;
  page: number;
  roles: BrowseFilterRole[];
  editions: BrowseFilterEdition[];
  inputMethods: BrowseFilterInputMethod[];
  platforms: BrowseFilterPlatform[];
}

export function parseBrowseSearchParams(searchParams: URLSearchParams): BrowseQueryArgs {
  return {
    q: searchParams.get("q") ?? "",
    sort: (searchParams.get("sort") as BrowseSortOption) || "updatedAt",
    page: Math.max(1, parseInt(searchParams.get("page") || "1", 10)),
    roles: searchParams.getAll("role") as BrowseFilterRole[],
    editions: searchParams.getAll("edition") as BrowseFilterEdition[],
    inputMethods: searchParams.getAll("input") as BrowseFilterInputMethod[],
    platforms: searchParams.getAll("platform") as BrowseFilterPlatform[],
  };
}

/**
 * 検索 + フィルタ条件を組み立てる（共通）。
 * デフォルトの視聴者除外もここで吸収する。
 */
function buildWhere(args: BrowseQueryArgs) {
  const conditions = [eq(users.profileVisibility, "public")];

  if (args.q) {
    conditions.push(
      or(
        like(users.mcid, `%${args.q}%`),
        like(users.displayName, `%${args.q}%`),
        like(users.slug, `%${args.q}%`),
      )!,
    );
  }

  if (args.roles.length > 0) {
    conditions.push(or(...args.roles.map((r) => eq(users.role, r)))!);
  } else {
    conditions.push(excludeViewersCondition!);
  }
  if (args.editions.length > 0) {
    conditions.push(or(...args.editions.map((e) => eq(users.mainEdition, e)))!);
  }
  if (args.inputMethods.length > 0) {
    conditions.push(
      or(...args.inputMethods.map((i) => eq(users.inputMethodBadge, i)))!,
    );
  }
  if (args.platforms.length > 0) {
    conditions.push(
      or(...args.platforms.map((p) => eq(users.mainPlatform, p)))!,
    );
  }
  return and(...conditions);
}

/** 1 ページ分の走者リストを取得 */
export async function loadBrowsePage(
  db: Database,
  args: BrowseQueryArgs,
  favoriteSlugs: string[],
) {
  const whereCondition = buildWhere(args);

  // ソート: お気に入りを最優先（ログイン中のみ）→ 通常ソート
  // ORDER BY に組み込むことで、append しても一貫した順序になる。
  const favoritePriority =
    favoriteSlugs.length > 0
      ? sql`CASE WHEN ${inArray(users.slug, favoriteSlugs)} THEN 0 ELSE 1 END`
      : null;

  const orderByClause =
    args.sort === "mcid"
      ? asc(users.mcid)
      : args.sort === "displayName"
      ? asc(users.displayName)
      : desc(users.updatedAt);

  // count と一覧取得は独立。Turso は HTTP のため RTT を 1 つでも減らすため並列化。
  const [totalCountResult, playerList] = await Promise.all([
    db
      .select({ count: sql<number>`count(*)` })
      .from(users)
      .where(whereCondition),
    db.query.users.findMany({
      where: whereCondition,
      columns: {
        mcid: true,
        uuid: true,
        slug: true,
        displayName: true,
        pronouns: true,
        role: true,
        mainEdition: true,
        mainPlatform: true,
        inputMethodBadge: true,
        updatedAt: true,
        shortBio: true,
        customSkinUrl: true,
      },
      orderBy: favoritePriority
        ? [favoritePriority, orderByClause]
        : [orderByClause],
      limit: BROWSE_ITEMS_PER_PAGE,
      offset: (args.page - 1) * BROWSE_ITEMS_PER_PAGE,
    }),
  ]);

  const totalCount = totalCountResult[0]?.count ?? 0;
  const totalPages = Math.ceil(totalCount / BROWSE_ITEMS_PER_PAGE);
  const hasMore = args.page < totalPages;

  return {
    players: playerList,
    totalCount,
    totalPages,
    hasMore,
  };
}

/** ログイン中ユーザーのお気に入り slug を取得（未ログインは [] ） */
export async function getViewerFavoriteSlugs(
  db: Database,
  discordId: string | null,
): Promise<string[]> {
  if (!discordId) return [];
  const me = await db.query.users.findFirst({
    where: eq(users.discordId, discordId),
    columns: { id: true },
  });
  if (!me) return [];
  return getFavoritesFromDb(db, me.id);
}
