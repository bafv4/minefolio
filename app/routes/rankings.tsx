import { createTranslator } from "@/lib/messages";
import { localeFromMatches } from "@/lib/locale";
import { useLoaderData, useSearchParams, useNavigation } from "react-router";
import type { ReactNode } from "react";
import type { Route } from "./+types/rankings";
import { createDb } from "@/lib/db";
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Trophy, Timer, Swords, Video, ExternalLink, Clock, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useT, useLocale } from "@/hooks/use-locale";
import { pickDisplayName } from "@/lib/slug";
import { Link } from "react-router";
import { getEnv } from "@/lib/env.server";
import { MinecraftAvatar } from "@/components/minecraft-avatar";
import {
  loadRankingCategories,
  loadRankings,
  parseRankingsParams,
  type RankingEntry,
} from "@/lib/rankings-query.server";
import { ScrollUpStickyHeader } from "@/components/scroll-up-sticky-header";
import { EmptyState } from "@/components/empty-state";

// 1〜3位のメダル色（3テーブルで共通）。2位は素のグレーだとライトテーマでコントラスト不足のため
// text-muted-foreground を使う
function rankMedalClass(rank: number): string {
  if (rank === 1) return "text-gold";
  if (rank === 2) return "text-muted-foreground";
  if (rank === 3) return "text-bronze";
  return "";
}

/** スクロールアウト → 上スクロール時に表示する sticky ヘッダ用テーブルラッパ */
function StickyHeaderShell({ children }: { children: ReactNode }) {
  const t = useT();
  return (
    <table className="w-full caption-bottom text-sm">
      <TableHeader>{children}</TableHeader>
    </table>
  );
}

export const meta: Route.MetaFunction = ({ matches, loaderData }) => {
  const t = createTranslator(localeFromMatches(matches));
  const title = t("rankings.title");
  const description = t("rankings.description");
  const appUrl = loaderData?.appUrl || "https://minefolio.app";
  const ogImage = `${appUrl}/icon.png`;
  return [
    { title },
    { name: "description", content: description },
    { property: "og:type", content: "website" },
    { property: "og:title", content: title },
    { property: "og:description", content: description },
    { property: "og:image", content: ogImage },
    { name: "twitter:card", content: "summary" },
    { name: "twitter:title", content: title },
    { name: "twitter:description", content: description },
    { name: "twitter:image", content: ogImage },
  ];
};

export async function loader({ request }: Route.LoaderArgs) {
  const env = getEnv();
  const db = createDb();
  const url = new URL(request.url);
  const args = parseRankingsParams(url.searchParams);
  const speedruncomCategories = await loadRankingCategories(db);

  const { rankings, selectedCategory } = await loadRankings(
    db,
    args,
    speedruncomCategories,
  );

  return {
    tab: args.tab,
    categories: speedruncomCategories,
    selectedCategory,
    rankings,
    rankedType: args.rankedType,
    appUrl: env.APP_URL || "https://minefolio.app",
  };
}

export default function RankingsPage() {
  const t = useT();
  const data = useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigation = useNavigation();
  const isLoading = navigation.state === "loading";

  // /rankings は遅延読み込み無効。loader が全件返す。
  const items = data.rankings;

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
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-primary/10 p-2">
            <Trophy className="h-5 w-5 text-primary" />
          </div>
          <div className="min-w-0">
            <h1 className="text-2xl font-bold">{t("rankings.pageTitle")}</h1>
          </div>
          <span className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-background/75 px-2.5 py-1 text-xs text-muted-foreground">
            <Trophy className="h-3.5 w-3.5" />
            {t("rankings.count", { count: items.length })}
          </span>
        </div>
        <p className="text-muted-foreground mt-1 text-sm">
          {t("rankings.publicityNote")}
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
              {t("rankings.pbRanking")}
            </Button>
            <Button
              variant={data.tab === "ranked" && data.rankedType === "elo" ? "default" : "outline"}
              size="sm"
              onClick={() => handleCategoryClick({ type: "ranked", slug: "ranked-elo", subType: "elo" })}
              className={cn("transition-all", data.tab === "ranked" && data.rankedType === "elo" && "shadow-sm")}
            >
              {t("rankings.eloRanking")}
            </Button>
          </div>
        </div>
      </div>

      {/* ランキングテーブル */}
      {isLoading ? (
        <RankingsTableSkeleton />
      ) : data.tab === "speedruncom" ? (
        items.length > 0 ? (
          <SpeedruncomRankingsTable rankings={items} />
        ) : (
          <EmptyState
            icon={<Trophy className="h-12 w-12" />}
            title={
              data.categories.length === 0
                ? t("rankings.noCategories")
                : t("rankings.noRankingData")
            }
            description={t("rankings.publicityNote")}
          />
        )
      ) : items.length > 0 ? (
        data.rankedType === "pb" ? (
          <RankedPbTable rankings={items} />
        ) : (
          <RankedEloTable rankings={items} />
        )
      ) : (
        <EmptyState
          icon={<Trophy className="h-12 w-12" />}
          title={t("rankings.noRankingData")}
          description={t("rankings.publicityNote")}
        />
      )}
    </div>
  );
}

// Speedrun.com ランキングテーブル
function SpeedruncomRankingsTable({ rankings }: { rankings: RankingEntry[] }) {
  const t = useT();
  const locale = useLocale();
  const headerRow = (
    <TableRow>
      <TableHead className="sticky top-0 left-0 bg-muted z-30 w-15 text-center border-r border-b-2">#</TableHead>
      <TableHead className="sticky top-0 bg-muted z-20 border-b-2">{t("rankings.player")}</TableHead>
      <TableHead className="sticky top-0 bg-muted z-20 w-30 text-right border-b-2">{t("rankings.time")}</TableHead>
      <TableHead className="sticky top-0 bg-muted z-20 w-25 border-b-2">{t("rankings.date")}</TableHead>
      <TableHead className="sticky top-0 bg-muted z-20 w-25 text-center border-b-2">{t("rankings.links")}</TableHead>
    </TableRow>
  );
  return (
    <ScrollUpStickyHeader
      className="relative border rounded-xl overflow-hidden"
      stickyHeader={<StickyHeaderShell>{headerRow}</StickyHeaderShell>}
    >
      <table className="w-full caption-bottom text-sm">
        <TableHeader>{headerRow}</TableHeader>
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
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="text-muted-foreground">
                          <Clock className="h-4 w-4 inline" />
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>{t("rankings.pendingVerification")}</TooltipContent>
                    </Tooltip>
                  ) : entry.rank !== null && entry.rank <= 3 ? (
                    <span className={rankMedalClass(entry.rank)}>
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
                      skinUrl={entry.customSkinUrl}
                      size={28}
                      className={`rounded-sm shrink-0 ${isPending ? "opacity-70" : ""}`}
                    />
                    <div className="min-w-0">
                      <p className={`font-medium text-sm truncate ${isPending ? "text-muted-foreground" : ""}`}>
                        {pickDisplayName(entry, locale) ?? entry.mcid ?? t("rankings.unknownPlayer")}
                        {isPending && (
                          <span className="ml-2 text-xs text-warning">
                            {t("rankings.pendingVerificationSuffix")}
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
                        aria-label={t("rankings.watchVideo")}
                        className="rounded-md p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                      >
                        <Video className="h-4 w-4" />
                      </a>
                    )}
                    {entry.runWeblink && (
                      <a
                        href={entry.runWeblink}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={t("rankings.viewExternal")}
                        className="rounded-md p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
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
    </ScrollUpStickyHeader>
  );
}

// Ranked PB テーブル
function RankedPbTable({ rankings }: { rankings: RankingEntry[] }) {
  const t = useT();
  const locale = useLocale();
  const headerRow = (
    <TableRow>
      <TableHead className="sticky top-0 left-0 bg-muted z-30 w-15 text-center border-r border-b-2">#</TableHead>
      <TableHead className="sticky top-0 bg-muted z-20 border-b-2">{t("rankings.player")}</TableHead>
      <TableHead className="sticky top-0 bg-muted z-20 w-30 text-right border-b-2">{t("rankings.bestTime")}</TableHead>
    </TableRow>
  );
  return (
    <ScrollUpStickyHeader
      className="relative border rounded-xl overflow-hidden"
      stickyHeader={<StickyHeaderShell>{headerRow}</StickyHeaderShell>}
    >
      <table className="w-full caption-bottom text-sm">
        <TableHeader>{headerRow}</TableHeader>
        <TableBody>
          {rankings.map((entry) => (
            <TableRow key={entry.userId} className="hover:bg-muted/30">
              <TableCell className="sticky left-0 bg-background z-10 text-center font-medium">
                {entry.rank !== null && entry.rank <= 3 ? (
                  <span className={rankMedalClass(entry.rank)}>
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
                    skinUrl={entry.customSkinUrl}
                    size={28}
                    className="rounded-sm shrink-0"
                  />
                  <div className="min-w-0">
                    <p className="font-medium text-sm truncate">
                      {pickDisplayName(entry, locale) ?? entry.mcid ?? t("rankings.unknownPlayer")}
                    </p>
                  </div>
                </Link>
              </TableCell>
              <TableCell className="font-mono text-right">{entry.timeFormatted ?? "-"}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </table>
    </ScrollUpStickyHeader>
  );
}

// Ranked Elo テーブル
function RankedEloTable({ rankings }: { rankings: RankingEntry[] }) {
  const t = useT();
  const locale = useLocale();
  const headerRow = (
    <TableRow>
      <TableHead className="sticky top-0 left-0 bg-muted z-30 w-15 text-center border-r border-b-2">#</TableHead>
      <TableHead className="sticky top-0 bg-muted z-20 border-b-2">{t("rankings.player")}</TableHead>
      <TableHead className="sticky top-0 bg-muted z-20 w-25 text-right border-b-2">Elo</TableHead>
      <TableHead className="sticky top-0 bg-muted z-20 w-25 text-right border-b-2">{t("rankings.winLoss")}</TableHead>
      <TableHead className="sticky top-0 bg-muted z-20 w-20 text-right border-b-2">{t("rankings.winRate")}</TableHead>
    </TableRow>
  );
  return (
    <ScrollUpStickyHeader
      className="relative border rounded-xl overflow-hidden"
      stickyHeader={<StickyHeaderShell>{headerRow}</StickyHeaderShell>}
    >
      <table className="w-full caption-bottom text-sm">
        <TableHeader>{headerRow}</TableHeader>
        <TableBody>
          {rankings.map((entry) => (
            <TableRow key={entry.userId} className="hover:bg-muted/30">
              <TableCell className="sticky left-0 bg-background z-10 text-center font-medium">
                {entry.rank !== null && entry.rank <= 3 ? (
                  <span className={rankMedalClass(entry.rank)}>
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
                    skinUrl={entry.customSkinUrl}
                    size={28}
                    className="rounded-sm shrink-0"
                  />
                  <div className="min-w-0">
                    <p className="font-medium text-sm truncate">
                      {pickDisplayName(entry, locale) ?? entry.mcid ?? t("rankings.unknownPlayer")}
                    </p>
                  </div>
                </Link>
              </TableCell>
              <TableCell className="text-right font-mono">{entry.eloRate ?? "-"}</TableCell>
              <TableCell className="text-right text-sm">
                <span className="text-success">{entry.wins ?? 0}W</span>
                {" / "}
                <span className="text-destructive">{entry.losses ?? 0}L</span>
              </TableCell>
              <TableCell className="text-right">{entry.winRate ?? 0}%</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </table>
    </ScrollUpStickyHeader>
  );
}

// スケルトンローダー
function RankingsTableSkeleton() {
  const t = useT();
  return (
    <div className="relative border rounded-xl overflow-hidden">
      <table className="w-full caption-bottom text-sm">
        <TableHeader>
          <TableRow>
            <TableHead className="sticky top-0 left-0 bg-muted z-30 w-15 border-r border-b-2">#</TableHead>
            <TableHead className="sticky top-0 bg-muted z-20 border-b-2">{t("rankings.player")}</TableHead>
            <TableHead className="sticky top-0 bg-muted z-20 w-30 text-right border-b-2">{t("rankings.time")}</TableHead>
            <TableHead className="sticky top-0 bg-muted z-20 w-25 border-b-2">{t("rankings.date")}</TableHead>
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
