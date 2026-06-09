import { useLoaderData, useSearchParams, useNavigation } from "react-router";
import type { ReactNode } from "react";
import type { Route } from "./+types/rankings";
import { createDb } from "@/lib/db";
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Trophy, Timer, Swords, Video, ExternalLink, Clock, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { t } from "@/lib/messages";
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

/** スクロールアウト → 上スクロール時に表示する sticky ヘッダ用テーブルラッパ */
function StickyHeaderShell({ children }: { children: ReactNode }) {
  return (
    <table className="w-full caption-bottom text-sm">
      <TableHeader>{children}</TableHeader>
    </table>
  );
}

export const meta: Route.MetaFunction = ({ data }) => {
  const title = t("rankings.title");
  const description = t("rankings.description");
  const appUrl = data?.appUrl || "https://minefolio.pages.dev";
  const ogImage = `${appUrl}/og-image`;
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

export async function loader({ context, request }: Route.LoaderArgs) {
  const env = context.env ?? getEnv();
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
    appUrl: env.APP_URL || "https://minefolio.pages.dev",
  };
}

export default function RankingsPage() {
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
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Trophy className="h-6 w-6" />
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

      {/* ランキングテーブル */}
      {isLoading ? (
        <RankingsTableSkeleton />
      ) : data.tab === "speedruncom" ? (
        items.length > 0 ? (
          <SpeedruncomRankingsTable rankings={items} />
        ) : (
          <div className="text-center py-12 text-muted-foreground">
            {data.categories.length === 0
              ? "カテゴリが登録されていません"
              : "ランキングデータがありません"}
          </div>
        )
      ) : items.length > 0 ? (
        data.rankedType === "pb" ? (
          <RankedPbTable rankings={items} />
        ) : (
          <RankedEloTable rankings={items} />
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
  const headerRow = (
    <TableRow>
      <TableHead className="sticky top-0 left-0 bg-muted z-30 w-15 text-center border-r border-b-2">#</TableHead>
      <TableHead className="sticky top-0 bg-muted z-20 border-b-2">プレイヤー</TableHead>
      <TableHead className="sticky top-0 bg-muted z-20 w-30 text-right border-b-2">タイム</TableHead>
      <TableHead className="sticky top-0 bg-muted z-20 w-25 border-b-2">日付</TableHead>
      <TableHead className="sticky top-0 bg-muted z-20 w-25 text-center border-b-2">リンク</TableHead>
    </TableRow>
  );
  return (
    <ScrollUpStickyHeader
      className="relative border rounded-lg overflow-hidden"
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
                      skinUrl={entry.customSkinUrl}
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
    </ScrollUpStickyHeader>
  );
}

// Ranked PB テーブル
function RankedPbTable({ rankings }: { rankings: RankingEntry[] }) {
  const headerRow = (
    <TableRow>
      <TableHead className="sticky top-0 left-0 bg-muted z-30 w-15 text-center border-r border-b-2">#</TableHead>
      <TableHead className="sticky top-0 bg-muted z-20 border-b-2">プレイヤー</TableHead>
      <TableHead className="sticky top-0 bg-muted z-20 w-30 text-right border-b-2">ベストタイム</TableHead>
    </TableRow>
  );
  return (
    <ScrollUpStickyHeader
      className="relative border rounded-lg overflow-hidden"
      stickyHeader={<StickyHeaderShell>{headerRow}</StickyHeaderShell>}
    >
      <table className="w-full caption-bottom text-sm">
        <TableHeader>{headerRow}</TableHeader>
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
                    skinUrl={entry.customSkinUrl}
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
    </ScrollUpStickyHeader>
  );
}

// Ranked Elo テーブル
function RankedEloTable({ rankings }: { rankings: RankingEntry[] }) {
  const headerRow = (
    <TableRow>
      <TableHead className="sticky top-0 left-0 bg-muted z-30 w-15 text-center border-r border-b-2">#</TableHead>
      <TableHead className="sticky top-0 bg-muted z-20 border-b-2">プレイヤー</TableHead>
      <TableHead className="sticky top-0 bg-muted z-20 w-25 text-right border-b-2">Elo</TableHead>
      <TableHead className="sticky top-0 bg-muted z-20 w-25 text-right border-b-2">勝敗</TableHead>
      <TableHead className="sticky top-0 bg-muted z-20 w-20 text-right border-b-2">勝率</TableHead>
    </TableRow>
  );
  return (
    <ScrollUpStickyHeader
      className="relative border rounded-lg overflow-hidden"
      stickyHeader={<StickyHeaderShell>{headerRow}</StickyHeaderShell>}
    >
      <table className="w-full caption-bottom text-sm">
        <TableHeader>{headerRow}</TableHeader>
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
                    skinUrl={entry.customSkinUrl}
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
    </ScrollUpStickyHeader>
  );
}

// スケルトンローダー
function RankingsTableSkeleton() {
  return (
    <div className="relative border rounded-lg overflow-hidden">
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
