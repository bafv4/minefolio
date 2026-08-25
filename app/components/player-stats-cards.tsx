import { cn } from "@/lib/utils";
import { formatTime } from "@/lib/time-utils";
import { formatRelativeTimeInHours, formatRelativeTimeInMinutes } from "@/lib/relative-time";
import { getSpeedrunComVideoEmbedUrl } from "@/lib/external-stats";
import type { MCSRRankedStats, SpeedrunComStats } from "@/lib/external-stats";
import { getRankTier, type RankTierKey } from "@/lib/mcsr-ranked-tiers";
import type { GroupedPaceEntry } from "@/lib/paceman-cache";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { EloRateGraph } from "@/components/elo-rate-graph";
import { YouTubeEmbed } from "@/components/youtube-embed";
import { PaceManSplitMark } from "@/components/paceman-split-mark";
import { Swords, Timer, Trophy, ExternalLink, Flame, Clock, Pin, Loader2 } from "lucide-react";
import { useT } from "@/hooks/use-locale";

// MCSR Ranked / PaceMan / Speedrun.com の統計カード。
// プロフィール（player/profile.tsx の活動・記録タブ）と /player/:slug/stats（player/stats.tsx）で
// マークアップがほぼ重複していたため共有化。ロード状態・エラー表示・ピン留めなど、各ページ固有の
// 挙動は呼び出し側の条件分岐に残し、このモジュールはデータ + 表示オプションのみを受け取る
// ドメイン非依存の見た目コンポーネントに徹する。

// ============================================
// MCSR Ranked
// ============================================

// Tailwind は動的クラス名構築を検出できないため、階級ごとの完全なクラス文字列を静的に定義する
// （--rank-coal〜--rank-netherite トークン。app.css の --color-rank-* により
// border-rank-X / bg-rank-X / text-rank-X ユーティリティが使える）
const RANK_TIER_CHIP_CLASSES: Record<RankTierKey, string> = {
  coal: "border-rank-coal/40 bg-rank-coal/10 text-rank-coal",
  iron: "border-rank-iron/40 bg-rank-iron/10 text-rank-iron",
  gold: "border-rank-gold/40 bg-rank-gold/10 text-rank-gold",
  emerald: "border-rank-emerald/40 bg-rank-emerald/10 text-rank-emerald",
  diamond: "border-rank-diamond/40 bg-rank-diamond/10 text-rank-diamond",
  netherite: "border-rank-netherite/40 bg-rank-netherite/10 text-rank-netherite",
};

export function MCSRRankedCard({
  ranked,
  minefolioRank,
}: {
  ranked: MCSRRankedStats;
  /** Minefolio 登録ユーザー内での Elo 順位（rankings-query.server.ts の cron キャッシュ基準。
   *  非公開プロフィール・Ranked統計非公開・Minefolio未登録などは null/undefined） */
  minefolioRank?: { rank: number; total: number } | null;
}) {
  const t = useT();

  // Win Rate / FF Rate: 分母が0（対戦データ無し）の場合は非表示（null）
  const seasonWins = ranked.seasonData?.records.win ?? 0;
  const seasonLoses = ranked.seasonData?.records.lose ?? 0;
  const seasonGames = seasonWins + seasonLoses;
  const winRatePercent = seasonGames > 0 ? (seasonWins / seasonGames) * 100 : null;

  const forfeits = ranked.seasonData?.forfeits ?? 0;
  const playedMatches = ranked.seasonData?.playedMatches ?? 0;
  const ffRatePercent = playedMatches > 0 ? (forfeits / playedMatches) * 100 : null;

  return (
    <Card className="gap-3 py-5">
      <CardHeader className="px-5">
        <CardTitle className="text-base flex items-center gap-2">
          <Swords className="h-5 w-5" />
          MCSR Ranked
        </CardTitle>
        <CardDescription>{t("playerStatsCards.rankedDescription")}</CardDescription>
      </CardHeader>
      <CardContent className="px-5 space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {ranked.user?.eloRate && (
            <div className="text-center p-3 bg-secondary/50 rounded-lg">
              <p className="text-2xl font-bold">{ranked.user.eloRate}</p>
              <p className="text-xs text-muted-foreground">{t("playerStatsCards.eloRate")}</p>
              {(() => {
                const tier = getRankTier(ranked.user.eloRate);
                return (
                  <span
                    className={cn(
                      "mt-1.5 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold",
                      RANK_TIER_CHIP_CLASSES[tier.key],
                    )}
                  >
                    {tier.label}
                  </span>
                );
              })()}
            </div>
          )}
          {ranked.user?.eloRank && (
            <div className="text-center p-3 bg-secondary/50 rounded-lg">
              <p className="text-2xl font-bold">#{ranked.user.eloRank}</p>
              <p className="text-xs text-muted-foreground">{t("playerStatsCards.ranking")}</p>
            </div>
          )}
          {ranked.seasonData && (
            <div className="text-center p-3 bg-secondary/50 rounded-lg">
              <p className="text-2xl font-bold">
                {ranked.seasonData.records.win}W - {ranked.seasonData.records.lose}L
              </p>
              <p className="text-xs text-muted-foreground">{t("playerStatsCards.seasonRecord")}</p>
            </div>
          )}
          {winRatePercent !== null && (
            <div className="text-center p-3 bg-secondary/50 rounded-lg">
              <p className="text-2xl font-bold">{winRatePercent.toFixed(1)}%</p>
              <p className="text-xs text-muted-foreground">{t("playerStatsCards.winRate")}</p>
            </div>
          )}
          {ffRatePercent !== null && (
            <div className="text-center p-3 bg-secondary/50 rounded-lg">
              <p className="text-2xl font-bold">{ffRatePercent.toFixed(1)}%</p>
              <p className="text-xs text-muted-foreground">{t("playerStatsCards.ffRate")}</p>
            </div>
          )}
          {ranked.countryRank !== null && (
            <div className="text-center p-3 bg-secondary/50 rounded-lg">
              <p className="text-2xl font-bold">#{ranked.countryRank}</p>
              <p className="text-xs text-muted-foreground">{t("playerStatsCards.jpRank")}</p>
            </div>
          )}
          {minefolioRank && (
            <div className="text-center p-3 bg-secondary/50 rounded-lg">
              <p className="text-2xl font-bold">#{minefolioRank.rank}</p>
              <p className="text-xs text-muted-foreground">
                {t("playerStatsCards.minefolioRank")}
                <span className="block">
                  {t("playerStatsCards.minefolioRankOutOf", { total: minefolioRank.total })}
                </span>
              </p>
            </div>
          )}
        </div>

        {/* PB表示（全期間 / 今シーズン） */}
        {ranked.seasonData &&
        (typeof ranked.seasonData.bestTimeAllTime === "number" ||
          typeof ranked.seasonData.bestTime === "number") ? (
          <div className="grid grid-cols-2 gap-4">
            {typeof ranked.seasonData.bestTimeAllTime === "number" && (
              <div className="p-3 bg-secondary/50 rounded-lg">
                <p className="text-xs text-muted-foreground mb-1">{t("playerStatsCards.allTimePb")}</p>
                <p className="text-xl font-mono font-bold">{formatTime(ranked.seasonData.bestTimeAllTime)}</p>
              </div>
            )}
            {typeof ranked.seasonData.bestTime === "number" && (
              <div className="p-3 bg-secondary/50 rounded-lg">
                <p className="text-xs text-muted-foreground mb-1">{t("playerStatsCards.seasonPb")}</p>
                <p className="text-xl font-mono font-bold">{formatTime(ranked.seasonData.bestTime)}</p>
              </div>
            )}
          </div>
        ) : null}

        {/* Eloレートグラフ */}
        {ranked.recentMatches.length > 1 && <EloRateGraph matches={ranked.recentMatches} />}

        {/* 最近のマッチ */}
        {ranked.recentMatches.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-sm font-medium text-muted-foreground">{t("playerStatsCards.recentMatches")}</h4>
            <div className="space-y-1">
              {ranked.recentMatches.slice(0, 5).map((match) => (
                <div
                  key={match.id}
                  className={cn(
                    "flex flex-wrap items-center justify-between gap-x-3 gap-y-1 p-2 rounded text-sm",
                    match.result === "win" && "bg-success/10",
                    match.result === "lose" && "bg-destructive/10",
                    match.result === "draw" && "bg-warning/10",
                  )}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <Badge
                      variant={match.result === "win" ? "default" : match.result === "lose" ? "destructive" : "secondary"}
                      className="w-12 shrink-0 justify-center"
                    >
                      {match.result === "win" ? "WIN" : match.result === "lose" ? "LOSE" : "DRAW"}
                    </Badge>
                    <span className="truncate">vs {match.opponentNickname}</span>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    {match.time && (
                      <span className="font-mono text-muted-foreground">{formatTime(match.time)}</span>
                    )}
                    <span
                      className={cn(
                        "font-medium",
                        match.eloChange > 0 && "text-success",
                        match.eloChange < 0 && "text-destructive",
                      )}
                    >
                      {match.eloChange > 0 ? "+" : ""}
                      {match.eloChange}
                    </span>
                  </div>
                  {match.date > 0 && (
                    <span className="w-full text-xs text-muted-foreground">
                      {formatRelativeTimeInHours(t, new Date(match.date * 1000))}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ============================================
// PaceMan
// ============================================

/** PaceManに登録済みだが、詳細な週間データはここでは持たない場合のリンクのみカード（profile.tsx専用） */
export function PaceManLinkCard({ mcid }: { mcid: string }) {
  const t = useT();
  return (
    <Card className="gap-3 py-5">
      <CardHeader className="px-5">
        <CardTitle className="text-base flex items-center gap-2">
          <Timer className="h-5 w-5" />
          PaceMan Stats
        </CardTitle>
        <CardDescription>{t("playerStatsCards.pacemanLinkDescription")}</CardDescription>
      </CardHeader>
      <CardContent className="px-5">
        <Button asChild variant="outline" className="w-full">
          <a
            href={`https://paceman.gg/stats/player/${encodeURIComponent(mcid)}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            <ExternalLink className="mr-2 h-4 w-4" />
            {t("playerStatsCards.pacemanOpenDetails")}
          </a>
        </Button>
      </CardContent>
    </Card>
  );
}

function PaceRow({ pace }: { pace: GroupedPaceEntry }) {
  const t = useT();
  const isFinish = pace.latestSplit.timeline === "Finish";
  return (
    <a
      href={`https://paceman.gg/stats/run/${pace.pacemanRunId}`}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "flex items-center justify-between p-2 rounded text-sm transition-colors",
        isFinish
          ? "border border-info/60 bg-info/10 hover:bg-info/15"
          : "bg-secondary/30 hover:bg-secondary/60",
      )}
    >
      <div className="min-w-0">
        <PaceManSplitMark timeline={pace.latestSplit.timeline} className="font-medium" />
        <p className="text-xs text-muted-foreground">{formatRelativeTimeInMinutes(t, pace.date)}</p>
      </div>
      <div className="flex items-center gap-2">
        {pace.splits.length > 1 ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="font-mono font-medium cursor-default underline decoration-dotted underline-offset-4 decoration-muted-foreground/50">
                {formatTime(pace.latestSplit.rta)}
              </span>
            </TooltipTrigger>
            <TooltipContent side="left" className="p-0">
              <div className="px-3 py-2 space-y-1">
                {pace.splits.map((split) => (
                  <div key={split.timeline} className="flex items-center justify-between gap-4 text-xs">
                    <span className="opacity-80">{split.timeline}</span>
                    <span className="font-mono font-semibold">{formatTime(split.rta)}</span>
                  </div>
                ))}
              </div>
            </TooltipContent>
          </Tooltip>
        ) : (
          <span className="font-mono font-medium">{formatTime(pace.latestSplit.rta)}</span>
        )}
        <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
      </div>
    </a>
  );
}

/**
 * ネザーイン回数・主なペース（過去1週間）の統計カード。
 * `openDetailsMcid` を渡すと末尾に PaceMan Stats への外部リンクボタンを併せて表示する
 * （profile.tsx は別カード = PaceManLinkCard で出すためここでは渡さない。
 * stats.tsx は単一カードにまとめるため渡す）。
 */
export function PaceManStatsCard({
  netherEnterCount,
  mainPaces,
  openDetailsMcid,
}: {
  netherEnterCount: number;
  mainPaces: GroupedPaceEntry[];
  openDetailsMcid?: string | null;
}) {
  const t = useT();
  return (
    <Card className="gap-3 py-5">
      <CardHeader className="px-5">
        <CardTitle className="text-base flex items-center gap-2">
          <Timer className="h-5 w-5" />
          PaceMan Stats
        </CardTitle>
        <CardDescription>{t("playerStatsCards.pacemanStatsDescription")}</CardDescription>
      </CardHeader>
      <CardContent className="px-5 space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="text-center p-3 bg-secondary/50 rounded-lg">
            <div className="flex items-center justify-center gap-2">
              <Flame className="h-5 w-5 text-warning" />
              <p className="text-2xl font-bold">{netherEnterCount}</p>
            </div>
            <p className="text-xs text-muted-foreground">{t("playerStatsCards.netherEntryCount")}</p>
          </div>
          <div className="text-center p-3 bg-secondary/50 rounded-lg">
            <div className="flex items-center justify-center gap-2">
              <Clock className="h-5 w-5 text-info" />
              <p className="text-2xl font-bold">{mainPaces.length}</p>
            </div>
            <p className="text-xs text-muted-foreground">{t("playerStatsCards.mainPacesCount")}</p>
          </div>
        </div>

        {mainPaces.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-sm font-medium text-muted-foreground">{t("playerStatsCards.mainPacesListTitle")}</h4>
            <div className="space-y-1">
              {mainPaces.map((pace) => (
                <PaceRow key={pace.pacemanRunId} pace={pace} />
              ))}
            </div>
          </div>
        )}

        {openDetailsMcid && (
          <Button asChild variant="outline" className="w-full">
            <a
              href={`https://paceman.gg/stats/player/${encodeURIComponent(openDetailsMcid)}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              <ExternalLink className="mr-2 h-4 w-4" />
              {t("playerStatsCards.pacemanOpenDetails")}
            </a>
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

// ============================================
// Speedrun.com
// ============================================
export function SpeedrunComCard({
  speedruncom,
  hiddenRunIds,
  pinnedRunIds,
  showVideoEmbed = false,
  showUsername = false,
}: {
  speedruncom: SpeedrunComStats;
  /** 非表示にする run.id（owner設定。無指定なら何も隠さない） */
  hiddenRunIds?: Set<string>;
  /** ピン留めする run.id（先頭表示＋2列拡大。無指定ならピン留めなし） */
  pinnedRunIds?: Set<string>;
  /** 動画リンクをYouTube埋め込みで表示するか */
  showVideoEmbed?: boolean;
  /** CardDescriptionにSpeedrun.comのユーザー名を併記するか */
  showUsername?: boolean;
}) {
  const t = useT();
  const hiddenSet = hiddenRunIds ?? new Set<string>();
  const pinnedSet = pinnedRunIds ?? new Set<string>();
  return (
    <Card className="gap-3 py-5">
      <CardHeader className="px-5">
        <CardTitle className="text-base flex items-center gap-2">
          <Trophy className="h-5 w-5" />
          Speedrun.com
        </CardTitle>
        <CardDescription>
          {t("playerStatsCards.officialRecords")}
          {showUsername && speedruncom.user && (
            <span className="ml-2">- {speedruncom.user.names.international}</span>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="px-5">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {speedruncom.personalBests
            .filter((pb) => !hiddenSet.has(pb.run.id))
            // ピン留めを先頭に（同順位は元の順序を維持する安定ソート）
            .sort((a, b) => Number(pinnedSet.has(b.run.id)) - Number(pinnedSet.has(a.run.id)))
            .slice(0, 6)
            .map((pb) => {
              const isPinned = pinnedSet.has(pb.run.id);
              const videoEmbedUrl = showVideoEmbed ? getSpeedrunComVideoEmbedUrl(pb) : null;
              return (
                <div
                  key={pb.run.id}
                  className={cn(
                    "p-3 bg-secondary/50 rounded-lg space-y-1",
                    isPinned && "md:col-span-2 border border-primary/40",
                  )}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-sm truncate flex items-center gap-1.5">
                      {isPinned && <Pin className="h-3.5 w-3.5 text-primary shrink-0" />}
                      {pb.category?.data?.name ?? t("common.unknown")}
                    </span>
                    <Badge variant="outline" className="shrink-0">
                      #{pb.place}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground truncate">
                    {pb.game?.data?.names?.international ?? t("common.unknownGame")}
                  </p>
                  {(pb.platformName || pb.versionName) && (
                    <p className="text-xs text-muted-foreground">
                      {[pb.platformName, pb.versionName].filter(Boolean).join(" / ")}
                    </p>
                  )}
                  <p className={cn("font-mono font-bold", isPinned ? "text-3xl" : "text-xl")}>
                    {formatTime(pb.run.times.primary_t * 1000)}
                  </p>
                  {videoEmbedUrl && (
                    <YouTubeEmbed embedUrl={videoEmbedUrl} title={pb.category?.data?.name ?? "Speedrun video"} />
                  )}
                  {pb.run.weblink && (
                    <a
                      href={pb.run.weblink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-primary hover:underline flex items-center gap-1"
                    >
                      <ExternalLink className="h-3 w-3" />
                      {t("playerStatsCards.viewRecord")}
                    </a>
                  )}
                </div>
              );
            })}
        </div>
      </CardContent>
    </Card>
  );
}

// ============================================
// ロード中カード（profile.tsx専用。clientでの外部API取得中に表示）
// ============================================
function LoadingProgressRing() {
  return (
    <div className="relative h-10 w-10 shrink-0">
      <div className="absolute inset-0 rounded-full border-4 border-muted" />
      <div className="absolute inset-0 rounded-full border-4 border-primary border-t-transparent animate-spin" />
    </div>
  );
}

export function StatsServiceLoadingCard({
  title,
  description,
  state,
}: {
  title: string;
  description: string;
  state: "loading" | "done" | "error";
}) {
  const t = useT();
  const isLoading = state === "loading";
  const isError = state === "error";

  return (
    <Card className="py-5">
      <CardContent className="px-5">
        <div className="flex items-center gap-4">
          {isLoading ? (
            <LoadingProgressRing />
          ) : isError ? (
            <div className="h-10 w-10 shrink-0 rounded-full border-2 border-destructive/40 flex items-center justify-center">
              <span className="text-destructive text-sm font-bold">!</span>
            </div>
          ) : (
            <div className="h-10 w-10 shrink-0 rounded-full border-2 border-primary/40 flex items-center justify-center">
              <Loader2 className="h-4 w-4 text-primary" />
            </div>
          )}
          <div>
            <p className="font-medium">{title}</p>
            <p className="text-sm text-muted-foreground">
              {isLoading ? description : isError ? t("common.loadFailed") : t("common.loadComplete")}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
