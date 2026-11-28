// /browse と /api/browse 共通のクエリビルダー。
// 検索 / フィルタ / ソート + ページネーションを一元管理し、二重実装を防ぐ。
import { and, asc, desc, eq, inArray, isNull, or, sql, type AnyColumn } from "drizzle-orm";
import { configPresets, favorites, playerConfigs, users } from "./schema";
import { normalizeGameLanguage } from "./game-languages";
import type { Database } from "./db";
import { excludeViewersCondition } from "./users-filter";
import { nullsLast } from "./sort-order";
import {
  DEFAULT_PROFILE_EDITION,
  DEFAULT_PROFILE_INPUT_METHOD,
  DEFAULT_PROFILE_PLATFORM,
  DEFAULT_PROFILE_ROLE,
} from "./profile-defaults";
import { profilePageViewsSql } from "./page-view-stats.server";
import { escapeLike } from "./sql-like.server";

export const BROWSE_ITEMS_PER_PAGE = 12;
// ページ番号の上限。巨大な page 値で offset が整数範囲を超え SQL エラー(500)になるのを防ぐ。
const MAX_BROWSE_PAGE = 100_000;

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
  /** ゲーム内言語（正規化済みの言語コード。未知の値・重複は parse 時に捨てる） */
  languages: string[];
}

/** `?lang=` を許可リストで正規化し、未知の値と重複を捨てる */
function parseBrowseLanguages(raw: string[]): string[] {
  const out: string[] = [];
  for (const value of raw) {
    const lang = normalizeGameLanguage(value);
    if (lang && !out.includes(lang)) out.push(lang);
  }
  return out;
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
    languages: parseBrowseLanguages(searchParams.getAll("lang")),
  };
}

/**
 * 走者のプロフィールに表示されるゲーム内言語（小文字）。表示と絞り込みを食い違わせないため、
 * プロフィール（player/profile.tsx）と同じ解決をする:
 * - メインプリセットが「編集中でない」ときは、そのスナップショット（config_presets.player_config_data の gameLanguage）
 * - それ以外（メインが編集中、またはメイン無し＝編集中プリセットへフォールバック）はライブの player_configs.game_language
 * スナップショットが壊れた JSON のときは、プロフィールのデコードと同じく「設定なし」（NULL）。
 */
function effectiveGameLanguageSql() {
  // 内側の表は列名を付け替えた派生表にする。drizzle は単一テーブルの select では列を修飾せず出す
  // （外側の users.id が `"id"` になる）ため、内側に同名の列（id 等）があると外側を参照できなくなる
  // （profilePageViewsSql と同じ回避）。
  return sql`lower(trim(CASE
    WHEN EXISTS (SELECT 1 FROM (SELECT user_id AS cp_uid, is_main AS cp_main, is_active AS cp_active FROM ${configPresets}) WHERE cp_uid = ${users.id} AND cp_main = 1 AND cp_active = 0)
    THEN (SELECT CASE WHEN json_valid(cp_data) THEN json_extract(cp_data, '$.gameLanguage') END
          FROM (SELECT user_id AS cp_uid, is_main AS cp_main, is_active AS cp_active, player_config_data AS cp_data FROM ${configPresets})
          WHERE cp_uid = ${users.id} AND cp_main = 1 AND cp_active = 0 LIMIT 1)
    ELSE (SELECT pc_lang FROM (SELECT user_id AS pc_uid, game_language AS pc_lang FROM ${playerConfigs}) WHERE pc_uid = ${users.id})
  END))`;
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

/** 列 = value。value が既定値のときは、未設定（NULL）も既定値として含める */
function eqOrNullWhenDefault(column: AnyColumn, value: string, defaultValue: string) {
  return value === defaultValue ? or(isNull(column), eq(column, value))! : eq(column, value);
}

/**
 * 検索 + フィルタ条件を組み立てる（共通）。
 * デフォルトの視聴者除外もここで吸収する。
 */
function buildWhere(args: BrowseQueryArgs, { skipLanguage = false } = {}) {
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
    conditions.push(or(...args.roles.map((r) => eqOrNullWhenDefault(users.role, r, DEFAULT_PROFILE_ROLE)))!);
  } else {
    conditions.push(excludeViewersCondition!);
  }
  // 未設定（NULL）は既定値（Java・Windows・キーボード＆マウス）として扱う。
  // カード（profile-feed-card.tsx）が既定値を出さないのと意味をそろえ、既定値で絞るときは NULL も含める
  if (args.editions.length > 0) {
    conditions.push(
      or(...args.editions.map((e) => eqOrNullWhenDefault(users.mainEdition, e, DEFAULT_PROFILE_EDITION)))!,
    );
  }
  if (args.inputMethods.length > 0) {
    conditions.push(
      or(...args.inputMethods.map((i) => eqOrNullWhenDefault(users.inputMethod, i, DEFAULT_PROFILE_INPUT_METHOD)))!,
    );
  }
  if (args.platforms.length > 0) {
    conditions.push(
      or(...args.platforms.map((p) => eqOrNullWhenDefault(users.mainPlatform, p, DEFAULT_PROFILE_PLATFORM)))!,
    );
  }
  // 言語が未設定の走者は、言語を選んだ絞り込みには出さない（NULL は IN に一致しない）
  if (!skipLanguage && args.languages.length > 0) {
    conditions.push(inArray(effectiveGameLanguageSql(), args.languages));
  }
  return and(...conditions);
}

/**
 * 言語ごとの人数（絞り込みダイアログの選択肢用）。言語以外の条件（検索語・ロール等）は一覧と同じで、
 * 選んだ言語自体では絞らない（他の言語の人数も見えるように）。言語が未設定の走者は数えない。
 */
export async function countBrowseLanguages(
  db: Database,
  args: BrowseQueryArgs,
): Promise<Record<string, number>> {
  const lang = effectiveGameLanguageSql();
  const rows = await db
    .select({ lang: sql<string | null>`${lang}`, count: sql<number>`count(*)` })
    .from(users)
    .where(and(buildWhere(args, { skipLanguage: true }), sql`${lang} IS NOT NULL`))
    .groupBy(lang);
  const counts: Record<string, number> = {};
  for (const row of rows) {
    // 許可リスト外の保存値（旧データ・手編集）は選択肢にできないので数えない
    const code = normalizeGameLanguage(row.lang);
    if (code) counts[code] = (counts[code] ?? 0) + Number(row.count);
  }
  return counts;
}

/** 条件に一致する件数（一覧と同じ buildWhere を通す。行は取得せず count(*) のみ） */
export async function countBrowse(db: Database, args: BrowseQueryArgs): Promise<number> {
  const rows = await db
    .select({ count: sql<number>`count(*)` })
    .from(users)
    .where(buildWhere(args));
  return Number(rows[0]?.count ?? 0);
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
      // 走者を見分ける表示用（メインカテゴリ）。with で一括取得し N+1 にしない
      with: {
        playstyle: { columns: { mainCategory: true } },
      },
      orderBy,
      limit: BROWSE_ITEMS_PER_PAGE,
      offset: (args.page - 1) * BROWSE_ITEMS_PER_PAGE,
    });
  };

  const [totalCount, playerList] = await Promise.all([countBrowse(db, args), buildList()]);
  const totalPages = Math.ceil(totalCount / BROWSE_ITEMS_PER_PAGE);
  const hasMore = args.page < totalPages;

  const players = playerList.map(({ playstyle, ...rest }) => ({
    ...rest,
    mainCategory: playstyle?.mainCategory ?? null,
  }));

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
