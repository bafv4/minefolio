// /browse と /api/browse 共通のクエリビルダー。
// 検索 / フィルタ / ソート + ページネーションを一元管理し、二重実装を防ぐ。
import { and, asc, desc, eq, inArray, or, sql } from "drizzle-orm";
import { users } from "./schema";
import type { Database } from "./db";
import { excludeViewersCondition } from "./users-filter";
import { nullsLast } from "./sort-order";
import { getFavoritesFromDb } from "./favorites";
import { profilePageViewsSql } from "./page-view-stats.server";

export const BROWSE_ITEMS_PER_PAGE = 12;
// ページ番号の上限。巨大な page 値で offset が整数範囲を超え SQL エラー(500)になるのを防ぐ。
const MAX_BROWSE_PAGE = 100_000;

/** LIKE のワイルドカード(%,_)とエスケープ文字(\)を無害化する。 */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** page パラメータを安全な整数範囲にクランプする。 */
function parseBrowsePage(raw: string | null): number {
  const p = parseInt(raw || "1", 10);
  if (!Number.isFinite(p) || p < 1) return 1;
  return Math.min(p, MAX_BROWSE_PAGE);
}

/** popular は直近7日のプロフィール閲覧数（page_view_stats）。他は users の列で並べる */
export const BROWSE_SORTS = ["updatedAt", "mcid", "displayName", "popular"] as const;

export type BrowseSortOption = (typeof BROWSE_SORTS)[number];

/** 既定のソート（不正な `sort` はここへ正規化する） */
const DEFAULT_BROWSE_SORT: BrowseSortOption = "updatedAt";

function parseBrowseSort(raw: string | null): BrowseSortOption {
  return (BROWSE_SORTS as readonly string[]).includes(raw ?? "")
    ? (raw as BrowseSortOption)
    : DEFAULT_BROWSE_SORT;
}

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
    sort: parseBrowseSort(searchParams.get("sort")),
    page: parseBrowsePage(searchParams.get("page")),
    roles: searchParams.getAll("role") as BrowseFilterRole[],
    editions: searchParams.getAll("edition") as BrowseFilterEdition[],
    inputMethods: searchParams.getAll("input") as BrowseFilterInputMethod[],
    platforms: searchParams.getAll("platform") as BrowseFilterPlatform[],
  };
}

/** 一覧で取得する列 */
const BROWSE_LIST_COLUMNS = {
  mcid: true,
  uuid: true,
  slug: true,
  displayName: true,
  displayNameAlphabet: true,
  pronouns: true,
  role: true,
  mainEdition: true,
  mainPlatform: true,
  inputMethod: true,
  updatedAt: true,
  shortBio: true,
  customSkinUrl: true,
} as const;

/**
 * 検索 + フィルタ条件を組み立てる（共通）。
 * デフォルトの視聴者除外もここで吸収する。
 */
function buildWhere(args: BrowseQueryArgs) {
  const conditions = [eq(users.profileVisibility, "public")];

  // 検索対象は mcid と displayName のみ。
  // slug は MCID 登録時は mcid と同一、未登録時は `@{discordId}`（Discord の数値ID）に
  // なるため、検索に含めると数字パターン等で Discord ID にヒットしてしまう。
  if (args.q) {
    // LIKE のワイルドカードをエスケープし、ユーザー入力を部分一致リテラルとして扱う。
    const likePattern = `%${escapeLike(args.q)}%`;
    conditions.push(
      or(
        sql`${users.mcid} LIKE ${likePattern} ESCAPE '\\'`,
        sql`${users.displayName} LIKE ${likePattern} ESCAPE '\\'`,
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
      or(...args.inputMethods.map((i) => eq(users.inputMethod, i)))!,
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

  // 未設定（NULL）の行は必ず末尾へ送る（sort-order.ts の共通ルール）。
  // SQLite の既定では昇順で NULL が先頭に来てしまい、MCID 未登録・表示名未設定の
  // 走者が並び替えのたびに 1 ページ目を占有する。
  const orderByClause =
    args.sort === "mcid"
      ? [nullsLast(users.mcid), asc(users.mcid)]
      : args.sort === "displayName"
      ? [nullsLast(users.displayName), asc(users.displayName)]
      : args.sort === "popular"
      ? // ページビュー集計が無い間は全件0になるので、更新順へ素直に落ちる
        [desc(profilePageViewsSql()), desc(users.updatedAt)]
      : // updatedAt は NOT NULL なので NULL 対策は不要
        [desc(users.updatedAt)];

  const orderBy = favoritePriority
    ? [favoritePriority, ...orderByClause]
    : orderByClause;

  // count と一覧取得は独立。Turso は HTTP のため RTT を 1 つでも減らすため並列化。
  const [totalCountResult, playerList] = await Promise.all([
    db
      .select({ count: sql<number>`count(*)` })
      .from(users)
      .where(whereCondition),
    db.query.users.findMany({
      where: whereCondition,
      columns: BROWSE_LIST_COLUMNS,
      orderBy,
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
