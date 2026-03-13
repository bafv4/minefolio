import { useLoaderData, useSearchParams, useNavigation } from "react-router";
import type { Route } from "./+types/rankings";
import { createDb } from "@/lib/db";
import { speedrunCategories, playerRankings, users, categoryRecords } from "@/lib/schema";
import { eq, and, desc, asc, isNotNull, or, notExists } from "drizzle-orm";
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Trophy, Timer, Swords, Video, ExternalLink, Loader2, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { t } from "@/lib/messages";
import { Link } from "react-router";
import { MinecraftAvatar } from "@/components/minecraft-avatar";

export const meta: Route.MetaFunction = () => {
  return [
    { title: t("rankings.title") },
    { name: "description", content: t("rankings.description") },
  ];
};

type TabType = "speedruncom" | "ranked";
type RankedType = "pb" | "elo";

// ランキングエントリの型
interface RankingEntry {
  rank: number | null; // 未承認記録はnull
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
  verificationStatus: "verified" | "new" | null; // 承認状態
}

export async function loader({ request }: Route.LoaderArgs) {
  const db = createDb();
  const url = new URL(request.url);
  const tab = (url.searchParams.get("tab") as TabType) ?? "speedruncom";
  const categorySlug = url.searchParams.get("category");
  const rankedType = (url.searchParams.get("rankedType") as RankedType) ?? "pb";

  // カテゴリ一覧を取得
  const categories = await db.query.speedrunCategories.findMany({
    where: eq(speedrunCategories.isActive, true),
    orderBy: (cat, { asc }) => [asc(cat.displayOrder)],
  });

  const speedruncomCategories = categories.filter((c) => c.categoryType === "speedruncom");

  let rankings: RankingEntry[] = [];
  let selectedCategory: typeof categories[0] | undefined;

  if (tab === "speedruncom") {
    // デフォルトカテゴリを選択
    selectedCategory = categorySlug
      ? speedruncomCategories.find((c) => c.slug === categorySlug)
      : speedruncomCategories[0];

    if (selectedCategory) {
      // DBからランキングを取得（公開ユーザーのみ、承認済み + 未承認）
      // categoryRecordsでisVisible=falseに設定されている記録は除外
      const dbRankings = await db
        .select({
          id: playerRankings.id,
          userId: playerRankings.userId,
          timeMs: playerRankings.timeMs,
          timeFormatted: playerRankings.timeFormatted,
          recordDate: playerRankings.recordDate,
          videoUrl: playerRankings.videoUrl,
          runWeblink: playerRankings.runWeblink,
          verificationStatus: playerRankings.verificationStatus,
          mcid: users.mcid,
          uuid: users.uuid,
          slug: users.slug,
          displayName: users.displayName,
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
              eq(playerRankings.verificationStatus, "new")
            ),
            // categoryRecordsでisVisible=falseに設定されていないこと
            notExists(
              db.select({ id: categoryRecords.id })
                .from(categoryRecords)
                .where(
                  and(
                    eq(categoryRecords.userId, playerRankings.userId),
                    eq(categoryRecords.categoryRefId, selectedCategory.id),
                    eq(categoryRecords.isVisible, false)
                  )
                )
            )
          )
        )
        .orderBy(asc(playerRankings.timeMs));

      // 承認済み記録に順位を付ける（未承認は順位なし）
      let verifiedRank = 0;
      rankings = dbRankings.map((r) => {
        const isVerified = r.verificationStatus === "verified";
        if (isVerified) {
          verifiedRank++;
        }
        return {
          rank: isVerified ? verifiedRank : null,
          userId: r.userId,
          mcid: r.mcid,
          uuid: r.uuid,
          slug: r.slug,
          displayName: r.displayName,
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
    }
  } else if (tab === "ranked") {
    if (rankedType === "pb") {
      // MCSR Ranked PB ランキング（公開ユーザー＋Ranked統計公開のみ）
      const dbRankings = await db
        .select({
          id: playerRankings.id,
          userId: playerRankings.userId,
          timeMs: playerRankings.timeMs,
          timeFormatted: playerRankings.timeFormatted,
          mcid: users.mcid,
          uuid: users.uuid,
          slug: users.slug,
          displayName: users.displayName,
        })
        .from(playerRankings)
        .innerJoin(users, eq(playerRankings.userId, users.id))
        .where(
          and(
            eq(playerRankings.rankingType, "ranked_pb"),
            isNotNull(playerRankings.timeMs),
            eq(users.profileVisibility, "public"),
            eq(users.showRankedStats, true)
          )
        )
        .orderBy(asc(playerRankings.timeMs));

      rankings = dbRankings.map((r, index) => ({
        rank: index + 1,
        userId: r.userId,
        mcid: r.mcid,
        uuid: r.uuid,
        slug: r.slug,
        displayName: r.displayName,
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
    } else {
      // MCSR Ranked Elo ランキング（公開ユーザー＋Ranked統計公開のみ）
      const dbRankings = await db
        .select({
          id: playerRankings.id,
          userId: playerRankings.userId,
          eloRate: playerRankings.eloRate,
          wins: playerRankings.wins,
          losses: playerRankings.losses,
          winRate: playerRankings.winRate,
          mcid: users.mcid,
          uuid: users.uuid,
          slug: users.slug,
          displayName: users.displayName,
        })
        .from(playerRankings)
        .innerJoin(users, eq(playerRankings.userId, users.id))
        .where(
          and(
            eq(playerRankings.rankingType, "ranked_elo"),
            isNotNull(playerRankings.eloRate),
            eq(users.profileVisibility, "public"),
            eq(users.showRankedStats, true)
          )
        )
        .orderBy(desc(playerRankings.eloRate));

      rankings = dbRankings.map((r, index) => ({
        rank: index + 1,
        userId: r.userId,
        mcid: r.mcid,
        uuid: r.uuid,
        slug: r.slug,
        displayName: r.displayName,
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
    }
  }

  return {
    tab,
    categories: speedruncomCategories,
    selectedCategory,
    rankings,
    rankedType,
  };
}

export default function RankingsPage() {
  const data = useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigation = useNavigation();
  const isLoading = navigation.state === "loading";

  const handleCategoryClick = (category: {
    type: "speedruncom" | "ranked";
    slug: string;
    subType?: "pb" | "elo";
  }) => {
    const params = new URLSearchParams(searchParams);
    if (category.type === "speedruncom") {
      params.set("tab", "speedruncom");
      params.set("category", category.slug);
      params.delete("rankedType");
    } else {
      params.set("tab", "ranked");
      params.set("rankedType", category.subType ?? "pb");
      params.delete("category");
    }
    setSearchParams(params);
  };

  return (
    <div className="flex-1 flex flex-col space-y-6">
      <div>
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <Trophy className="h-8 w-8" />
          {t("rankings.pageTitle")}
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          記録の公開設定によってはランキングに表示されないことがあります。
        </p>
      </div>

      {/* カテゴリ選択 */}
      <div className="space-y-3">
        {/* Speedrun.com カテゴリ */}
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Timer className="h-4 w-4" />
            <span>Speedrun.com</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {data.categories.map((cat) => {
              const isSelected = data.tab === "speedruncom" && data.selectedCategory?.slug === cat.slug;
              return (
                <Button
                  key={cat.id}
                  variant={isSelected ? "default" : "outline"}
                  size="sm"
                  onClick={() => handleCategoryClick({ type: "speedruncom", slug: cat.slug })}
                  className={cn("transition-all", isSelected && "shadow-sm")}
                >
                  {cat.name}
                </Button>
              );
            })}
          </div>
        </div>

        {/* MCSR Ranked カテゴリ */}
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Swords className="h-4 w-4" />
            <span>MCSR Ranked</span>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant={data.tab === "ranked" && data.rankedType === "pb" ? "default" : "outline"}
              size="sm"
              onClick={() => handleCategoryClick({ type: "ranked", slug: "ranked-pb", subType: "pb" })}
              className={cn("transition-all", data.tab === "ranked" && data.rankedType === "pb" && "shadow-sm")}
            >
              PB ランキング
            </Button>
            <Button
              variant={data.tab === "ranked" && data.rankedType === "elo" ? "default" : "outline"}
              size="sm"
              onClick={() => handleCategoryClick({ type: "ranked", slug: "ranked-elo", subType: "elo" })}
              className={cn("transition-all", data.tab === "ranked" && data.rankedType === "elo" && "shadow-sm")}
            >
              Elo ランキング
            </Button>
          </div>
        </div>
      </div>

      {/* ローディングインジケーター */}
      {isLoading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>読み込み中...</span>
        </div>
      )}

      {/* ランキングテーブル */}
      {isLoading ? (
        <RankingsTableSkeleton />
      ) : data.tab === "speedruncom" ? (
        data.rankings.length > 0 ? (
          <SpeedruncomRankingsTable rankings={data.rankings} />
        ) : (
          <div className="text-center py-12 text-muted-foreground">
            {data.categories.length === 0
              ? "カテゴリが登録されていません"
              : "ランキングデータがありません"}
          </div>
        )
      ) : data.rankings.length > 0 ? (
        data.rankedType === "pb" ? (
          <RankedPbTable rankings={data.rankings} />
        ) : (
          <RankedEloTable rankings={data.rankings} />
        )
      ) : (
        <div className="text-center py-12 text-muted-foreground">
          ランキングデータがありません
        </div>
      )}
    </div>
  );
}

// Speedrun.com ランキングテーブル
function SpeedruncomRankingsTable({ rankings }: { rankings: RankingEntry[] }) {
  return (
    <div className="relative border rounded-lg overflow-auto max-h-150">
      <table className="w-full caption-bottom text-sm">
        <TableHeader>
          <TableRow>
            <TableHead className="sticky top-0 left-0 bg-muted z-30 w-15 text-center border-r border-b-2">#</TableHead>
            <TableHead className="sticky top-0 bg-muted z-20 border-b-2">プレイヤー</TableHead>
            <TableHead className="sticky top-0 bg-muted z-20 w-30 text-right border-b-2">タイム</TableHead>
            <TableHead className="sticky top-0 bg-muted z-20 w-25 border-b-2">日付</TableHead>
            <TableHead className="sticky top-0 bg-muted z-20 w-25 text-center border-b-2">リンク</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rankings.map((entry, index) => {
            const isPending = entry.verificationStatus === "new";
            return (
              <TableRow
                key={`${entry.userId}-${entry.verificationStatus}-${index}`}
                className={isPending ? "bg-muted/30 hover:bg-muted/40" : "hover:bg-muted/30"}
              >
                <TableCell className="sticky left-0 bg-background z-10 text-center font-medium">
                  {isPending ? (
                    <span className="text-muted-foreground" title="審査待ち">
                      <Clock className="h-4 w-4 inline" />
                    </span>
                  ) : entry.rank !== null && entry.rank <= 3 ? (
                    <span className={
                      entry.rank === 1 ? "text-yellow-500" :
                      entry.rank === 2 ? "text-gray-400" :
                      "text-amber-600"
                    }>
                      {entry.rank}
                    </span>
                  ) : entry.rank}
                </TableCell>
                <TableCell>
                  <Link
                    to={`/player/${entry.slug}`}
                    className="flex items-center gap-2 hover:opacity-80 transition-opacity"
                  >
                    <MinecraftAvatar
                      uuid={entry.uuid}
                      size={28}
                      className={`rounded-sm shrink-0 ${isPending ? "opacity-70" : ""}`}
                    />
                    <div className="min-w-0">
                      <p className={`font-medium text-sm truncate ${isPending ? "text-muted-foreground" : ""}`}>
                        {entry.displayName ?? entry.mcid ?? "Unknown"}
                        {isPending && (
                          <span className="ml-2 text-xs text-yellow-600 dark:text-yellow-500">
                            (審査待ち)
                          </span>
                        )}
                      </p>
                    </div>
                  </Link>
                </TableCell>
                <TableCell className={`font-mono text-right ${isPending ? "text-muted-foreground" : ""}`}>
                  {entry.timeFormatted ?? "-"}
                </TableCell>
                <TableCell className="text-muted-foreground text-sm">
                  {entry.recordDate ?? "-"}
                </TableCell>
                <TableCell className="text-center">
                  <div className="flex items-center justify-center gap-2">
                    {entry.videoUrl && (
                      <a
                        href={entry.videoUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-muted-foreground hover:text-foreground"
                      >
                        <Video className="h-4 w-4" />
                      </a>
                    )}
                    {entry.runWeblink && (
                      <a
                        href={entry.runWeblink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-muted-foreground hover:text-foreground"
                      >
                        <ExternalLink className="h-4 w-4" />
                      </a>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </table>
    </div>
  );
}

// Ranked PB テーブル
function RankedPbTable({ rankings }: { rankings: RankingEntry[] }) {
  return (
    <div className="relative border rounded-lg overflow-auto max-h-150">
      <table className="w-full caption-bottom text-sm">
        <TableHeader>
          <TableRow>
            <TableHead className="sticky top-0 left-0 bg-muted z-30 w-15 text-center border-r border-b-2">#</TableHead>
            <TableHead className="sticky top-0 bg-muted z-20 border-b-2">プレイヤー</TableHead>
            <TableHead className="sticky top-0 bg-muted z-20 w-30 text-right border-b-2">ベストタイム</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rankings.map((entry) => (
            <TableRow key={entry.userId} className="hover:bg-muted/30">
              <TableCell className="sticky left-0 bg-background z-10 text-center font-medium">
                {entry.rank !== null && entry.rank <= 3 ? (
                  <span className={
                    entry.rank === 1 ? "text-yellow-500" :
                    entry.rank === 2 ? "text-gray-400" :
                    "text-amber-600"
                  }>
                    {entry.rank}
                  </span>
                ) : entry.rank ?? "-"}
              </TableCell>
              <TableCell>
                <Link
                  to={`/player/${entry.slug}`}
                  className="flex items-center gap-2 hover:opacity-80 transition-opacity"
                >
                  <MinecraftAvatar
                    uuid={entry.uuid}
                    size={28}
                    className="rounded-sm shrink-0"
                  />
                  <div className="min-w-0">
                    <p className="font-medium text-sm truncate">
                      {entry.displayName ?? entry.mcid ?? "Unknown"}
                    </p>
                  </div>
                </Link>
              </TableCell>
              <TableCell className="font-mono text-right">{entry.timeFormatted ?? "-"}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </table>
    </div>
  );
}

// Ranked Elo テーブル
function RankedEloTable({ rankings }: { rankings: RankingEntry[] }) {
  return (
    <div className="relative border rounded-lg overflow-auto max-h-150">
      <table className="w-full caption-bottom text-sm">
        <TableHeader>
          <TableRow>
            <TableHead className="sticky top-0 left-0 bg-muted z-30 w-15 text-center border-r border-b-2">#</TableHead>
            <TableHead className="sticky top-0 bg-muted z-20 border-b-2">プレイヤー</TableHead>
            <TableHead className="sticky top-0 bg-muted z-20 w-25 text-right border-b-2">Elo</TableHead>
            <TableHead className="sticky top-0 bg-muted z-20 w-25 text-right border-b-2">勝敗</TableHead>
            <TableHead className="sticky top-0 bg-muted z-20 w-20 text-right border-b-2">勝率</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rankings.map((entry) => (
            <TableRow key={entry.userId} className="hover:bg-muted/30">
              <TableCell className="sticky left-0 bg-background z-10 text-center font-medium">
                {entry.rank !== null && entry.rank <= 3 ? (
                  <span className={
                    entry.rank === 1 ? "text-yellow-500" :
                    entry.rank === 2 ? "text-gray-400" :
                    "text-amber-600"
                  }>
                    {entry.rank}
                  </span>
                ) : entry.rank ?? "-"}
              </TableCell>
              <TableCell>
                <Link
                  to={`/player/${entry.slug}`}
                  className="flex items-center gap-2 hover:opacity-80 transition-opacity"
                >
                  <MinecraftAvatar
                    uuid={entry.uuid}
                    size={28}
                    className="rounded-sm shrink-0"
                  />
                  <div className="min-w-0">
                    <p className="font-medium text-sm truncate">
                      {entry.displayName ?? entry.mcid ?? "Unknown"}
                    </p>
                  </div>
                </Link>
              </TableCell>
              <TableCell className="text-right font-mono">{entry.eloRate ?? "-"}</TableCell>
              <TableCell className="text-right text-sm">
                <span className="text-green-600">{entry.wins ?? 0}W</span>
                {" / "}
                <span className="text-red-600">{entry.losses ?? 0}L</span>
              </TableCell>
              <TableCell className="text-right">{entry.winRate ?? 0}%</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </table>
    </div>
  );
}

// スケルトンローダー
function RankingsTableSkeleton() {
  return (
    <div className="relative border rounded-lg overflow-auto max-h-150">
      <table className="w-full caption-bottom text-sm">
        <TableHeader>
          <TableRow>
            <TableHead className="sticky top-0 left-0 bg-muted z-30 w-15 border-r border-b-2">#</TableHead>
            <TableHead className="sticky top-0 bg-muted z-20 border-b-2">プレイヤー</TableHead>
            <TableHead className="sticky top-0 bg-muted z-20 w-30 text-right border-b-2">タイム</TableHead>
            <TableHead className="sticky top-0 bg-muted z-20 w-25 border-b-2">日付</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {Array.from({ length: 10 }).map((_, i) => (
            <TableRow key={i}>
              <TableCell className="sticky left-0 bg-background z-10"><Skeleton className="h-4 w-8" /></TableCell>
              <TableCell><Skeleton className="h-4 w-32" /></TableCell>
              <TableCell className="text-right"><Skeleton className="h-4 w-20 ml-auto" /></TableCell>
              <TableCell><Skeleton className="h-4 w-24" /></TableCell>
            </TableRow>
          ))}
        </TableBody>
      </table>
    </div>
  );
}
