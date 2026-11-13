// /browse と /api/browse 共通のクエリビルダー。
// 検索 / フィルタ / ソート + ページネーションを一元管理し、二重実装を防ぐ。
import { and, asc, desc, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { categoryRecords, favorites, users } from "./schema";
import type { Database } from "./db";
import { excludeViewersCondition } from "./users-filter";
import { nullsLast } from "./sort-order";
import { profilePageViewsSql } from "./page-view-stats.server";
import { pickHighlightPb } from "./profile-highlights";

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
    // role 未設定（NULL）は走者として扱う（excludeViewersCondition / 既定の一覧と同じ解釈）
    conditions.push(
      or(
        ...args.roles.map((r) =>
          r === "runner" ? or(isNull(users.role), eq(users.role, "runner"))! : eq(users.role, r),
        ),
      )!,
    );
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
  favoriteSlugs: string[] | Promise<string[]>,
) {
  // buildWhere が同期 throw しても favoriteSlugs（Promise）が未処理 rejection にならないよう先に握る
  Promise.resolve(favoriteSlugs).catch(() => {});
  const whereCondition = buildWhere(args);

  // count はお気に入りに依存しないので、お気に入り取得（Promise 可）と並行して発行する。
  // （drizzle のクエリは await されるまで実行されないため Promise.all に直接渡す）
  const buildList = async () => {
    const resolvedFavoriteSlugs = await favoriteSlugs;
    // ソート: お気に入りを最優先（ログイン中のみ）→ 通常ソート
    // ORDER BY に組み込むことで、append しても一貫した順序になる。
    const favoritePriority =
      resolvedFavoriteSlugs.length > 0
        ? sql`CASE WHEN ${inArray(users.slug, resolvedFavoriteSlugs)} THEN 0 ELSE 1 END`
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

    // 末尾に一意キー（id）を付けて全順序にする。updatedAt / displayName / mcid が同値（NULL 同士含む）の
    // 行があると offset ページングで順序が揺れ、隣接ページ間で同じ走者が重複して返る
    // （一覧の React key 重複警告の原因）。
    const orderBy = favoritePriority
      ? [favoritePriority, ...orderByClause, asc(users.id)]
      : [...orderByClause, asc(users.id)];

    return db.query.users.findMany({
      where: whereCondition,
      columns: BROWSE_LIST_COLUMNS,
      // 走者を見分ける表示用（メインカテゴリ + その PB）。with で一括取得し N+1 にしない
      with: {
        playstyle: { columns: { mainCategory: true } },
        categoryRecords: {
          columns: { category: true, categoryDisplayName: true, personalBest: true },
          where: and(eq(categoryRecords.isVisible, true), isNotNull(categoryRecords.personalBest)),
        },
      },
      orderBy,
      limit: BROWSE_ITEMS_PER_PAGE,
      offset: (args.page - 1) * BROWSE_ITEMS_PER_PAGE,
    });
  };

  const [totalCountResult, playerList] = await Promise.all([
    db
      .select({ count: sql<number>`count(*)` })
      .from(users)
      .where(whereCondition),
    buildList(),
  ]);

  const totalCount = totalCountResult[0]?.count ?? 0;
  const totalPages = Math.ceil(totalCount / BROWSE_ITEMS_PER_PAGE);
  const hasMore = args.page < totalPages;

  const players = playerList.map(({ playstyle, categoryRecords: records, ...rest }) => {
    const mainCategory = playstyle?.mainCategory ?? null;
    const pb = pickHighlightPb(mainCategory, records);
    return { ...rest, mainCategory, mainCategoryPb: pb?.record.personalBest ?? null };
  });

  return {
    players,
    totalCount,
    totalPages,
    hasMore,
  };
}

/**
 * discordId からユーザーの存在とお気に入り slug を 1 クエリ（users LEFT JOIN favorites）で取得する。
 * ユーザーが存在しなければ null。favoriteSlug の辞書順で返す（変更前の既定順＝idx_favorites_user_slug の走査順を維持）。
 */
export async function getFavoriteSlugsByDiscordId(
  db: Database,
  discordId: string,
): Promise<string[] | null> {
  const rows = await db
    .select({ favoriteSlug: favorites.favoriteSlug })
    .from(users)
    .leftJoin(favorites, eq(favorites.userId, users.id))
    .where(eq(users.discordId, discordId))
    .orderBy(asc(favorites.favoriteSlug));
  if (rows.length === 0) return null;
  return rows.flatMap((r) => (r.favoriteSlug ? [r.favoriteSlug] : []));
}

/** ログイン中ユーザーのお気に入り slug を取得（未ログインは [] ） */
export async function getViewerFavoriteSlugs(
  db: Database,
  discordId: string | null,
): Promise<string[]> {
  if (!discordId) return [];
  return (await getFavoriteSlugsByDiscordId(db, discordId)) ?? [];
}
