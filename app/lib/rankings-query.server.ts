// /rankings のクエリビルダー。
// 3 タブ（speedruncom / ranked-pb / ranked-elo）を全件取得する。
// 元々ページング対応だったが、UI 側で無限スクロールを採用しなかったため
// シンプルな全件版に整理した（dead infrastructure 削除）。
import { and, asc, desc, eq, isNotNull, notExists, or } from "drizzle-orm";
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

export function parseRankingsParams(searchParams: URLSearchParams): RankingsArgs {
  return {
    tab: (searchParams.get("tab") as RankingsTab) ?? "speedruncom",
    categorySlug: searchParams.get("category"),
    rankedType: (searchParams.get("rankedType") as RankedType) ?? "pb",
  };
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
}

const playerColumns = {
  mcid: users.mcid,
  uuid: users.uuid,
  slug: users.slug,
  displayName: users.displayName,
  customSkinUrl: users.customSkinUrl,
} as const;

type PlayerRow = {
  userId: string;
  mcid: string | null;
  uuid: string | null;
  slug: string;
  displayName: string | null;
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
      return { rankings: [], selectedCategory: null };
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
    return { rankings };
  }

  // ranked elo
  const rows = await db
    .select({
      userId: playerRankings.userId,
      eloRate: playerRankings.eloRate,
      wins: playerRankings.wins,
      losses: playerRankings.losses,
      winRate: playerRankings.winRate,
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
  return { rankings };
}
