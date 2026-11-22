// /rankings のクエリビルダー。
// 3 タブ（speedruncom / ranked-pb / ranked-elo）を全件取得する。
// 元々ページング対応だったが、UI 側で無限スクロールを採用しなかったため
// シンプルな全件版に整理した（dead infrastructure 削除）。
import { and, asc, desc, eq, isNotNull, notExists, or, sql } from "drizzle-orm";
import {
  categoryRecords,
  playerRankings,
  speedrunCategories,
  users,
} from "./schema";
import type { Database } from "./db";

export type RankingsTab = "speedruncom" | "ranked";
export type RankedType = "pb" | "elo";

export interface RankingEntry {
  rank: number | null;
  userId: string;
  mcid: string | null;
  uuid: string | null;
  slug: string;
  displayName: string | null;
  displayNameAlphabet: string | null;
  timeMs: number | null;
  timeFormatted: string | null;
  recordDate: string | null;
  videoUrl: string | null;
  runWeblink: string | null;
  eloRate: number | null;
  wins: number | null;
  losses: number | null;
  winRate: number | null;
  verificationStatus: "verified" | "new" | null;
  customSkinUrl: string | null;
}

export interface RankingsArgs {
  tab: RankingsTab;
  categorySlug: string | null;
  rankedType: RankedType;
}

/** カテゴリ一覧（speedruncom 用、UI ナビ用） */
export async function loadRankingCategories(db: Database) {
  const categories = await db.query.speedrunCategories.findMany({
    where: eq(speedrunCategories.isActive, true),
    orderBy: (cat, { asc }) => [asc(cat.displayOrder)],
  });
  return categories.filter((c) => c.categoryType === "speedruncom");
}

interface LoadedRankings {
  rankings: RankingEntry[];
  selectedCategory?: {
    id: string;
    slug: string;
    name: string;
  } | null;
  /** 表の行のうち最新の集計時刻（cron が `player_rankings.lastFetched` に書く。UNIX ms）。行が無ければ null */
  lastFetchedMs: number | null;
}

function latestFetchedMs(rows: { lastFetched: Date | null }[]): number | null {
  let max: number | null = null;
  for (const r of rows) {
    const ms = r.lastFetched ? r.lastFetched.getTime() : null;
    if (ms !== null && (max === null || ms > max)) max = ms;
  }
  return max;
}

const playerColumns = {
  mcid: users.mcid,
  uuid: users.uuid,
  slug: users.slug,
  displayName: users.displayName,
  displayNameAlphabet: users.displayNameAlphabet,
  customSkinUrl: users.customSkinUrl,
} as const;

type PlayerRow = {
  userId: string;
  mcid: string | null;
  uuid: string | null;
  slug: string;
  displayName: string | null;
  displayNameAlphabet: string | null;
  customSkinUrl: string | null;
};

function emptyEntry(rank: number | null, row: PlayerRow): Omit<RankingEntry, "timeMs" | "timeFormatted" | "recordDate" | "videoUrl" | "runWeblink" | "eloRate" | "wins" | "losses" | "winRate" | "verificationStatus"> {
  return {
    rank,
    userId: row.userId,
    mcid: row.mcid,
    uuid: row.uuid,
    slug: row.slug,
    displayName: row.displayName,
    displayNameAlphabet: row.displayNameAlphabet,
    customSkinUrl: row.customSkinUrl,
  };
}

export async function loadRankings(
  db: Database,
  args: RankingsArgs,
  speedruncomCategories: Awaited<ReturnType<typeof loadRankingCategories>>,
): Promise<LoadedRankings> {
  if (args.tab === "speedruncom") {
    const selectedCategory = args.categorySlug
      ? speedruncomCategories.find((c) => c.slug === args.categorySlug)
      : speedruncomCategories[0];

    if (!selectedCategory) {
      return { rankings: [], selectedCategory: null, lastFetchedMs: null };
    }

    const rows = await db
      .select({
        userId: playerRankings.userId,
        timeMs: playerRankings.timeMs,
        timeFormatted: playerRankings.timeFormatted,
        recordDate: playerRankings.recordDate,
        videoUrl: playerRankings.videoUrl,
        runWeblink: playerRankings.runWeblink,
        verificationStatus: playerRankings.verificationStatus,
        lastFetched: playerRankings.lastFetched,
        ...playerColumns,
      })
      .from(playerRankings)
      .innerJoin(users, eq(playerRankings.userId, users.id))
      .where(
        and(
          eq(playerRankings.rankingType, "speedruncom"),
          eq(playerRankings.categoryId, selectedCategory.id),
          isNotNull(playerRankings.timeMs),
          eq(users.profileVisibility, "public"),
          or(
            eq(playerRankings.verificationStatus, "verified"),
            eq(playerRankings.verificationStatus, "new"),
          ),
          notExists(
            db
              .select({ id: categoryRecords.id })
              .from(categoryRecords)
              .where(
                and(
                  eq(categoryRecords.userId, playerRankings.userId),
                  eq(categoryRecords.categoryRefId, selectedCategory.id),
                  eq(categoryRecords.isVisible, false),
                ),
              ),
          ),
        ),
      )
      .orderBy(asc(playerRankings.timeMs));

    // 承認済み記録に順位を付ける（未承認は順位なし）
    let verifiedRank = 0;
    const rankings: RankingEntry[] = rows.map((r) => {
      const isVerified = r.verificationStatus === "verified";
      if (isVerified) verifiedRank++;
      return {
        ...emptyEntry(isVerified ? verifiedRank : null, r),
        timeMs: r.timeMs,
        timeFormatted: r.timeFormatted,
        recordDate: r.recordDate,
        videoUrl: r.videoUrl,
        runWeblink: r.runWeblink,
        eloRate: null,
        wins: null,
        losses: null,
        winRate: null,
        verificationStatus: r.verificationStatus as "verified" | "new" | null,
      };
    });
    return {
      rankings,
      lastFetchedMs: latestFetchedMs(rows),
      selectedCategory: {
        id: selectedCategory.id,
        slug: selectedCategory.slug,
        name: selectedCategory.name,
      },
    };
  }

  if (args.rankedType === "pb") {
    const rows = await db
      .select({
        userId: playerRankings.userId,
        timeMs: playerRankings.timeMs,
        timeFormatted: playerRankings.timeFormatted,
        lastFetched: playerRankings.lastFetched,
        ...playerColumns,
      })
      .from(playerRankings)
      .innerJoin(users, eq(playerRankings.userId, users.id))
      .where(
        and(
          eq(playerRankings.rankingType, "ranked_pb"),
          isNotNull(playerRankings.timeMs),
          eq(users.profileVisibility, "public"),
          eq(users.showRankedStats, true),
        ),
      )
      .orderBy(asc(playerRankings.timeMs));

    const rankings: RankingEntry[] = rows.map((r, index) => ({
      ...emptyEntry(index + 1, r),
      timeMs: r.timeMs,
      timeFormatted: r.timeFormatted,
      recordDate: null,
      videoUrl: null,
      runWeblink: null,
      eloRate: null,
      wins: null,
      losses: null,
      winRate: null,
      verificationStatus: null,
    }));
    return { rankings, lastFetchedMs: latestFetchedMs(rows) };
  }

  // ranked elo
  const rows = await db
    .select({
      userId: playerRankings.userId,
      eloRate: playerRankings.eloRate,
      wins: playerRankings.wins,
      losses: playerRankings.losses,
      winRate: playerRankings.winRate,
      lastFetched: playerRankings.lastFetched,
      ...playerColumns,
    })
    .from(playerRankings)
    .innerJoin(users, eq(playerRankings.userId, users.id))
    .where(
      and(
        eq(playerRankings.rankingType, "ranked_elo"),
        isNotNull(playerRankings.eloRate),
        eq(users.profileVisibility, "public"),
        eq(users.showRankedStats, true),
      ),
    )
    .orderBy(desc(playerRankings.eloRate));

  const rankings: RankingEntry[] = rows.map((r, index) => ({
    ...emptyEntry(index + 1, r),
    timeMs: null,
    timeFormatted: null,
    recordDate: null,
    videoUrl: null,
    runWeblink: null,
    eloRate: r.eloRate,
    wins: r.wins,
    losses: r.losses,
    winRate: r.winRate,
    verificationStatus: null,
  }));
  return { rankings, lastFetchedMs: latestFetchedMs(rows) };
}

/**
 * Minefolio 登録ユーザー内での Elo 順位を返す。
 * `loadRankings` の ranked_elo タブと同じ絞り込み（rankingType='ranked_elo'、eloRate not null、
 * 公開プロフィール、Ranked統計公開ON）で全件を取得し、対象ユーザーの順位（同率同順位）と総数を返す。
 * 対象ユーザーが絞り込み条件に含まれない（未登録・非公開等）場合は null。
 */
export async function getMinefolioEloRank(
  db: Database,
  userId: string,
): Promise<{ rank: number; total: number } | null> {
  const eligible = and(
    eq(playerRankings.rankingType, "ranked_elo"),
    isNotNull(playerRankings.eloRate),
    eq(users.profileVisibility, "public"),
    eq(users.showRankedStats, true),
  );

  // 全件を取得して JS で数える代わりに、SQL の集計で総数・自分より高い Elo の件数・
  // 自分の Elo（絞り込みに含まれなければ null）を1往復で求める。同率は同順位（higher + 1）
  const [row] = await db
    .select({
      total: sql<number>`count(*)`,
      higher: sql<number>`coalesce(sum(case when ${playerRankings.eloRate} > (select max(pr2.elo_rate) from player_rankings pr2 inner join users u2 on pr2.user_id = u2.id where pr2.ranking_type = 'ranked_elo' and pr2.elo_rate is not null and u2.profile_visibility = 'public' and u2.show_ranked_stats = 1 and pr2.user_id = ${userId}) then 1 else 0 end), 0)`,
      targetElo: sql<number | null>`max(case when ${playerRankings.userId} = ${userId} then ${playerRankings.eloRate} end)`,
    })
    .from(playerRankings)
    .innerJoin(users, eq(playerRankings.userId, users.id))
    .where(eligible);

  if (!row || row.targetElo === null) return null;
  return { rank: Number(row.higher) + 1, total: Number(row.total) };
}
