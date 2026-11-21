import { useRef, useState, type ReactNode } from "react";
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
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { EloRateGraph } from "@/components/elo-rate-graph";
import { YouTubeClickEmbed } from "@/components/youtube-click-embed";
import { speedrunComPbDisplayName, speedrunComPbMetaLine, speedrunComPbNameParts, statsSrcCardId, visibleSpeedrunComPbs } from "@/lib/profile-highlights";
import { PaceManSplitMark } from "@/components/paceman-split-mark";
import { PageSection } from "@/components/page-section";
import { Swords, Timer, Trophy, ExternalLink, Flame, Clock, Pin, Loader2, RotateCw } from "lucide-react";
import { useT } from "@/hooks/use-locale";
import type { PendingSpeedrunRecord } from "@/lib/speedruncom-pending.server";

// MCSR Ranked / PaceMan / Speedrun.com の統計カード。
// プロフィール（player/profile.tsx の活動・記録タブ）と /player/:slug/stats（player/stats.tsx）で
// マークアップがほぼ重複していたため共有化。ロード状態・エラー表示・ピン留めなど、各ページ固有の
// 挙動は呼び出し側の条件分岐に残し、このモジュールはデータ + 表示オプションのみを受け取る
// ドメイン非依存の見た目コンポーネントに徹する。

// ============================================
// 箱あり / 箱なしの切り替え
// ============================================
// 各カード部品は `framed`（既定 true）を受け取る。true は従来どおりの Card（既定の表示。単独ページ /player/:slug/stats も今は箱なし）。
// false は走者画面の記録タブ用の「箱なし・上罫線」で、Card の代わりに PageSection（h3・アイコンなし）で描く。
// 箱なしのときだけ、中の1件ずつのタイルは rounded-xl、中の小見出しは h4（text-base。走者画面はタブタイトル h2 ＞ 欄 h3 ＞ 小見出し h4）にする。

/** 箱なしのときの中の1件ずつのタイル（角丸 2 層ルール: ページ直置きの個別アイテムは rounded-xl） */
const SECTION_TILE_RADIUS = "rounded-xl";
/** 箱なしのときの欄内の小見出し（h4）の class */
const SECTION_SUBHEADING_CLASS = "text-base font-semibold";

/** 欄内の小見出し。箱あり（既定の Card 表示。単独ページ /player/:slug/stats も今は箱なし）は従来どおり h3、箱なし（走者画面: タブ h2 ＞ 欄 h3 ＞ 小見出し）は h4 */
function SubHeading({ framed, children }: { framed: boolean; children: ReactNode }) {
  const Tag = framed ? "h3" : "h4";
  return <Tag className={framed ? "text-sm font-medium text-muted-foreground" : SECTION_SUBHEADING_CLASS}>{children}</Tag>;
}

function StatsFrame({
  framed,
  id,
  title,
  icon,
  description,
  action,
  contentClassName,
  children,
}: {
  framed: boolean;
  /** 箱なし（PageSection）のときの id 接頭辞 */
  id: string;
  title: string;
  /** 箱ありのときだけ見出しの左に置く（箱なしは付けない） */
  icon?: ReactNode;
  description?: ReactNode;
  /** 箱なしのときだけ見出し右に置く */
  action?: ReactNode;
  contentClassName?: string;
  children: ReactNode;
}) {
  if (!framed) {
    return (
      <PageSection id={id} title={title} action={action} headingLevel="h3">
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
        <div className={contentClassName}>{children}</div>
      </PageSection>
    );
  }
  return (
    <Card className="gap-3 py-5">
      <CardHeader className="px-5">
        <CardTitle role="heading" aria-level={2} className="text-base flex items-center gap-2">
          {icon}
          {title}
        </CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent className={cn("px-5", contentClassName)}>{children}</CardContent>
    </Card>
  );
}

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
  framed = true,
}: {
  ranked: MCSRRankedStats;
  /** Minefolio 登録ユーザー内での Elo 順位（rankings-query.server.ts の cron キャッシュ基準。
   *  非公開プロフィール・Ranked統計非公開・Minefolio未登録などは null/undefined） */
  minefolioRank?: { rank: number; total: number } | null;
  /** false で箱なし（PageSection）。統計タイルは 2 列（md 以上は 3 列）で 3+3 に並べる */
  framed?: boolean;
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

  const tile = framed ? "rounded-lg" : SECTION_TILE_RADIUS;

  return (
    <StatsFrame
      framed={framed}
      id="stats-ranked"
      title="MCSR Ranked"
      icon={<Swords className="h-5 w-5" />}
      description={t("playerStatsCards.rankedDescription")}
      contentClassName="space-y-4"
    >
      <div className={cn("grid grid-cols-2 gap-4", framed ? "md:grid-cols-4" : "md:grid-cols-3")}>
        {ranked.user?.eloRate && (
          <div className={cn("text-center p-3 bg-secondary/50", tile)}>
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
          <div className={cn("text-center p-3 bg-secondary/50", tile)}>
            <p className="text-2xl font-bold">#{ranked.user.eloRank}</p>
            <p className="text-xs text-muted-foreground">{t("playerStatsCards.ranking")}</p>
          </div>
        )}
        {ranked.seasonData && (
          <div className={cn("text-center p-3 bg-secondary/50", tile)}>
            {seasonGames > 0 ? (
              <p className="text-2xl font-bold">
                {seasonWins}W - {seasonLoses}L
              </p>
            ) : (
              // 今シーズン未出場: 0W - 0L を大きく出さず控えめな表示にする
              <p className="text-sm text-muted-foreground py-1">{t("playerStatsCards.seasonNoMatches")}</p>
            )}
            <p className="text-xs text-muted-foreground">{t("playerStatsCards.seasonRecord")}</p>
          </div>
        )}
        {winRatePercent !== null && (
          <div className={cn("text-center p-3 bg-secondary/50", tile)}>
            <p className="text-2xl font-bold">{winRatePercent.toFixed(1)}%</p>
            <p className="text-xs text-muted-foreground">{t("playerStatsCards.winRate")}</p>
          </div>
        )}
        {ffRatePercent !== null && (
          <div className={cn("text-center p-3 bg-secondary/50", tile)}>
            <p className="text-2xl font-bold">{ffRatePercent.toFixed(1)}%</p>
            <p className="text-xs text-muted-foreground">{t("playerStatsCards.ffRate")}</p>
          </div>
        )}
        {ranked.countryRank !== null && (
          <div className={cn("text-center p-3 bg-secondary/50", tile)}>
            <p className="text-2xl font-bold">#{ranked.countryRank}</p>
            <p className="text-xs text-muted-foreground">{t("playerStatsCards.jpRank")}</p>
          </div>
        )}
        {minefolioRank && (
          <div className={cn("text-center p-3 bg-secondary/50", tile)}>
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
            <div className={cn("p-3 bg-secondary/50", tile)}>
              <p className="text-xs text-muted-foreground mb-1">{t("playerStatsCards.allTimePb")}</p>
              <p className="text-xl font-mono font-bold">{formatTime(ranked.seasonData.bestTimeAllTime)}</p>
            </div>
          )}
          {typeof ranked.seasonData.bestTime === "number" && (
            <div className={cn("p-3 bg-secondary/50", tile)}>
              <p className="text-xs text-muted-foreground mb-1">{t("playerStatsCards.seasonPb")}</p>
              <p className="text-xl font-mono font-bold">{formatTime(ranked.seasonData.bestTime)}</p>
            </div>
          )}
        </div>
      ) : null}

      {/* Eloレートグラフ */}
      {ranked.recentMatches.length > 1 && (
        <EloRateGraph
          matches={ranked.recentMatches}
          {...(framed ? {} : { headingLevel: "h4" as const, headingClassName: SECTION_SUBHEADING_CLASS, labelChange: true })}
        />
      )}

      {/* 最近のマッチ */}
      {ranked.recentMatches.length > 0 && (
        <div className="space-y-2">
          <SubHeading framed={framed}>{t("playerStatsCards.recentMatches")}</SubHeading>
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
                    className={cn("shrink-0 justify-center", framed ? "w-12" : "min-w-12 px-2 whitespace-nowrap")}
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
    </StatsFrame>
  );
}

// ============================================
// PaceMan
// ============================================

/** PaceManに登録済みだが、詳細な週間データはここでは持たない場合のリンクのみカード（profile.tsx専用） */
export function PaceManLinkCard({
  mcid,
  framed = true,
  weeklyStatsHidden = false,
}: {
  mcid: string;
  framed?: boolean;
  /** 走者が週間統計を非公開にしている。「ペースはありません」と事実と違うことを書かないよう従来の説明に戻す */
  weeklyStatsHidden?: boolean;
}) {
  const t = useT();
  if (!framed) {
    // 箱なし: 見出しは週間統計つきの欄（PaceManStatsCard framed=false）と同じ「PaceMan」。リンクは見出し右
    return (
      <StatsFrame
        framed={false}
        id="stats-paceman"
        title="PaceMan"
        description={t(weeklyStatsHidden ? "playerStatsCards.pacemanLinkDescription" : "playerStatsCards.pacemanNoWeeklyData")}
        action={<PaceManHeaderLink mcid={mcid} />}
      >
        {null}
      </StatsFrame>
    );
  }
  return (
    <Card className="gap-3 py-5">
      <CardHeader className="px-5">
        <CardTitle role="heading" aria-level={2} className="text-base flex items-center gap-2">
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

/** 箱なしの PaceMan 欄の見出し右リンク。sm 未満はアイコンのみ（44px 角・ラベルは sr-only） */
function PaceManHeaderLink({ mcid }: { mcid: string }) {
  const t = useT();
  return (
    <Button variant="ghost" size="sm" asChild className="size-11 shrink-0 sm:size-auto sm:min-h-8">
      <a href={`https://paceman.gg/stats/player/${encodeURIComponent(mcid)}`} target="_blank" rel="noopener noreferrer">
        <span className="sr-only sm:not-sr-only">{t("playerStatsCards.pacemanOpenDetails")}</span>
        <ExternalLink className="h-3.5 w-3.5 sm:ml-1" aria-hidden="true" />
      </a>
    </Button>
  );
}

/**
 * 取得失敗後の「再試行」ボタンを出すか。一度でも失敗したら、再試行中（loading）も同じボタンを DOM に残す
 * （外すと、押したボタンが消えてフォーカスが BODY に落ちる）
 */
function useShowServiceRetry(state: "loading" | "done" | "error" | undefined, hasRetry: boolean): boolean {
  const hadError = useRef(false);
  if (state === "error") hadError.current = true;
  return hasRetry && (state === "error" || (state === "loading" && hadError.current));
}

/** サービス別の「再試行」ボタン。再試行中（loading）は aria-disabled で押せなくし、アイコンを回す */
function ServiceRetryButton({
  name,
  loading,
  onRetry,
  variant,
  className,
}: {
  name: string;
  loading: boolean;
  onRetry: () => void;
  variant: "ghost" | "outline";
  className?: string;
}) {
  const t = useT();
  return (
    <Button
      variant={variant}
      size="sm"
      aria-disabled={loading}
      aria-label={t("common.serviceRetry", { name })}
      onClick={loading ? undefined : onRetry}
      className={cn(className, loading && "opacity-50")}
    >
      <RotateCw aria-hidden="true" className={cn(loading && "animate-spin")} />
      {t("common.retry")}
    </Button>
  );
}

/**
 * 箱なしの PaceMan 欄の見出し右。登録判定（クライアント取得）の状態でリンク位置を切り替える:
 * 読み込み中は小さなスピナー、失敗は「再試行」ボタン、成功はリンク（登録済みのときだけ）
 */
function PaceManHeaderAction({
  mcid,
  state,
  onRetry,
}: {
  mcid: string | null | undefined;
  state: "loading" | "done" | "error" | undefined;
  onRetry?: () => void;
}) {
  const t = useT();
  const showRetry = useShowServiceRetry(state, !!onRetry);
  if (onRetry && showRetry) {
    const loading = state === "loading";
    return (
      <>
        <ServiceRetryButton
          name="PaceMan"
          loading={loading}
          onRetry={onRetry}
          variant="ghost"
          className="shrink-0 max-md:min-h-11 max-md:px-3"
        />
        {/* 状態の変化（読み込み中 → 失敗）を読み上げさせる。ボタンと同じ間 DOM に残す */}
        <span role="status" className="sr-only">
          {loading ? t("loading.pacemanStats") : t("common.serviceLoadFailed", { name: "PaceMan" })}
        </span>
      </>
    );
  }
  if (state === "loading") {
    return (
      <span role="status" className="flex size-11 shrink-0 items-center justify-center sm:size-8">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden="true" />
        <span className="sr-only">{t("loading.pacemanStats")}</span>
      </span>
    );
  }
  return mcid ? <PaceManHeaderLink mcid={mcid} /> : null;
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
        <span className="-ml-1 text-[10px] text-muted-foreground">{t("home.igtTime")}</span>
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
  registrationState,
  onRetryRegistration,
  framed = true,
}: {
  netherEnterCount: number;
  mainPaces: GroupedPaceEntry[];
  openDetailsMcid?: string | null;
  /** 箱なしのみ。PaceMan 登録判定（クライアント取得）の状態。見出し右のリンク位置に反映する（省略時はリンクのみ） */
  registrationState?: "loading" | "done" | "error";
  onRetryRegistration?: () => void;
  /** false で箱なし。見出しは「PaceMan」で、openDetailsMcid のリンクは末尾のボタンではなく見出し右に置く */
  framed?: boolean;
}) {
  const t = useT();
  const tile = framed ? "rounded-lg" : SECTION_TILE_RADIUS;
  return (
    <StatsFrame
      framed={framed}
      id="stats-paceman"
      title={framed ? "PaceMan Stats" : "PaceMan"}
      icon={<Timer className="h-5 w-5" />}
      description={t("playerStatsCards.pacemanStatsDescription")}
      action={
        framed ? undefined : (
          <PaceManHeaderAction mcid={openDetailsMcid} state={registrationState} onRetry={onRetryRegistration} />
        )
      }
      contentClassName="space-y-4"
    >
      <div className="grid grid-cols-2 gap-4">
        <div className={cn("text-center p-3 bg-secondary/50", tile)}>
          <div className="flex items-center justify-center gap-2">
            <Flame className="h-5 w-5 text-warning" />
            <p className="text-2xl font-bold">{netherEnterCount}</p>
          </div>
          <p className="text-xs text-muted-foreground">{t("playerStatsCards.netherEntryCount")}</p>
        </div>
        <div className={cn("text-center p-3 bg-secondary/50", tile)}>
          <div className="flex items-center justify-center gap-2">
            <Clock className="h-5 w-5 text-info" />
            <p className="text-2xl font-bold">{mainPaces.length}</p>
          </div>
          <p className="text-xs text-muted-foreground">{t("playerStatsCards.mainPacesCount")}</p>
        </div>
      </div>

      {mainPaces.length > 0 && (
        <div className="space-y-2">
          <SubHeading framed={framed}>{t("playerStatsCards.mainPacesListTitle")}</SubHeading>
          <div className="space-y-1">
            {mainPaces.map((pace) => (
              <PaceRow key={pace.pacemanRunId} pace={pace} />
            ))}
          </div>
        </div>
      )}

      {framed && openDetailsMcid && (
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
    </StatsFrame>
  );
}

// ============================================
// Speedrun.com
// ============================================
/** Speedrun.com カードの既定の表示上限（PB の件数） */
const PB_PREVIEW_LIMIT = 6;

export function SpeedrunComCard({
  speedruncom,
  hiddenRunIds,
  pinnedRunIds,
  showVideoEmbed = false,
  showUsername = false,
  framed = true,
  highlightRunId,
  expandable = false,
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
  /** false で箱なし（PageSection）。PB の1件ずつのタイルは rounded-xl */
  framed?: boolean;
  /** 上限（6件）に関係なく必ず表示する run.id（身元帯のハイライトに選ばれた PB）。無指定なら上限どおり */
  highlightRunId?: string | null;
  /** true で表示対象が上限を超えるとき「すべて表示」（その場で展開・閉じる）を出す。既定は6件で打ち切り */
  expandable?: boolean;
}) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  const hiddenSet = hiddenRunIds ?? new Set<string>();
  const pinnedSet = pinnedRunIds ?? new Set<string>();
  const visiblePbs = speedruncom.personalBests
    .filter((pb) => !hiddenSet.has(pb.run.id))
    // ピン留めを先頭に（同順位は元の順序を維持する安定ソート）
    .sort((a, b) => Number(pinnedSet.has(b.run.id)) - Number(pinnedSet.has(a.run.id)));
  // 代表 PB（身元帯のハイライト）は「ピン留めの次」（ピン留めが無ければ先頭）へ移す。ほかの並びは保つ。
  // 先頭寄りに置くので、表示上限（6件）の外に押し出されることもない
  const representative = highlightRunId ? visiblePbs.find((pb) => pb.run.id === highlightRunId) : undefined;
  if (representative && !pinnedSet.has(representative.run.id)) {
    visiblePbs.splice(visiblePbs.indexOf(representative), 1);
    visiblePbs.splice(visiblePbs.filter((pb) => pinnedSet.has(pb.run.id)).length, 0, representative);
  }
  // 同名カテゴリの判定は身元帯と同じ表示対象（非表示・記録時間 0 以下を除く）で行う
  const nameSiblings = visibleSpeedrunComPbs(speedruncom.personalBests, [...hiddenSet]);
  const shownPbs = expandable && expanded ? visiblePbs : visiblePbs.slice(0, PB_PREVIEW_LIMIT);
  const canExpand = expandable && visiblePbs.length > PB_PREVIEW_LIMIT;
  const tileRadius = framed ? "rounded-lg" : SECTION_TILE_RADIUS;
  return (
    <StatsFrame
      framed={framed}
      id="stats-speedruncom"
      title="Speedrun.com"
      icon={<Trophy className="h-5 w-5" />}
      description={
        <>
          {t("playerStatsCards.officialRecords")}
          {showUsername && speedruncom.user && (
            <span className="ml-2">- {speedruncom.user.names.international}</span>
          )}
        </>
      }
    >
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {shownPbs
          .map((pb) => {
            const isPinned = pinnedSet.has(pb.run.id);
            const isRepresentative = pb === representative;
            const videoEmbedUrl = showVideoEmbed ? getSpeedrunComVideoEmbedUrl(pb) : null;
            // 同名のカテゴリがほかにあるときだけ版を添える（Java / Bedrock の Any% Glitchless など）
            const displayName = speedrunComPbDisplayName(pb, nameSiblings, t("common.unknown"));
            // 名前の末尾が切れて同名のカードを見分けられなくなるので、見分けの語は2行目（機種 / 版 / サブカテゴリ）に出す
            const nameParts = speedrunComPbNameParts(pb, nameSiblings, t("common.unknown"));
            const metaLine = speedrunComPbMetaLine(pb);
            const timeText = formatTime(pb.run.times.primary_t * 1000);
            const videoLabel = `${displayName} ${timeText}`;
            return (
              <div
                key={pb.run.id}
                // 身元帯の PB タイルから飛んでくる先（フォーカスはプログラムからだけ移す）
                id={statsSrcCardId(pb.run.id)}
                tabIndex={-1}
                // フォーカスを受けたとき中身全体を読み上げさせず、カテゴリ名で名前を付ける
                role="group"
                aria-labelledby={`${statsSrcCardId(pb.run.id)}-name`}
                className={cn(
                  "p-3 bg-secondary/50 space-y-1 outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  tileRadius,
                  isPinned && "md:col-span-2",
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="font-medium text-sm flex min-w-0 items-start gap-1.5">
                    {isPinned && <Pin className="mt-0.5 h-3.5 w-3.5 text-primary shrink-0" />}
                    <span id={`${statsSrcCardId(pb.run.id)}-name`} className="min-w-0 break-words leading-snug line-clamp-2">
                      {nameParts.title}
                      {/* 見えているのは2行目の行。読み上げの名前には見分けの語を含める */}
                      {nameParts.detail && <span className="sr-only"> ({nameParts.detail})</span>}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-1.5">
                    {isRepresentative && (
                      <Badge variant="secondary" className="rounded-full px-2 py-0.5 text-[11px]">
                        {t("playerStatsCards.representativeBadge")}
                      </Badge>
                    )}
                    <Badge variant="outline" className="shrink-0">
                      #{pb.place}
                    </Badge>
                  </span>
                </div>
                <p className="text-xs text-muted-foreground truncate">
                  {pb.game?.data?.names?.international ?? t("common.unknownGame")}
                </p>
                {metaLine && <p className="text-xs text-muted-foreground">{metaLine}</p>}
                <p className={cn("font-mono font-bold", isPinned ? "text-3xl" : "text-xl")}>
                  {timeText}
                </p>
                {videoEmbedUrl && (
                  <YouTubeClickEmbed
                    embedUrl={videoEmbedUrl}
                    title={t("playerStatsCards.videoTitle", { label: videoLabel })}
                    playLabel={t("playerStatsCards.playVideo", { label: videoLabel })}
                  />
                )}
                {pb.run.weblink && (
                  <a
                    href={pb.run.weblink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex min-h-6 items-center gap-1 text-xs text-primary hover:underline"
                  >
                    <ExternalLink className="h-3 w-3" aria-hidden />
                    {t("playerStatsCards.viewRecord")}
                    {/* 同じ文言のリンクが並ぶので、どの記録かを読み上げで補う */}
                    <span className="sr-only"> {displayName} #{pb.place}</span>
                  </a>
                )}
              </div>
            );
          })}
      </div>
      {canExpand && (
        <div className="mt-4 flex justify-center">
          <Button variant="outline" size="sm" aria-expanded={expanded} onClick={() => setExpanded((v) => !v)}>
            {expanded
              ? t("playerStatsCards.showFewerPbs")
              : t("playerStatsCards.showAllPbs", { count: visiblePbs.length })}
          </Button>
        </div>
      )}
    </StatsFrame>
  );
}

// ============================================
// Speedrun.com 審査中の記録（承認前のため公式記録カードには出ない）
// ============================================
export function PendingSpeedrunRecordsCard({
  records,
  show,
  onShowChange,
  framed = true,
}: {
  records: PendingSpeedrunRecord[];
  show: boolean;
  onShowChange: (show: boolean) => void;
  /** false で箱なし（PageSection）。id="pending-speedruncom-records" は箱なしでも保つ */
  framed?: boolean;
}) {
  const t = useT();
  const toggle = (
    <label className="flex shrink-0 items-center gap-2 text-sm">
      <Switch checked={show} onCheckedChange={onShowChange} />
      {t("playerStatsCards.pendingRecordsToggle")}
    </label>
  );
  const items = (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {records.map((r, i) => (
        <div
          key={r.runId ?? `${r.categoryName}-${i}`}
          className={cn("p-3 bg-secondary/50 space-y-1 border border-warning/40", framed ? "rounded-lg" : SECTION_TILE_RADIUS)}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium text-sm truncate">{r.categoryName}</span>
            <Badge variant="outline" className="shrink-0 border-warning/40 bg-warning/10 text-warning">
              {t("playerStatsCards.pendingBadge")}
            </Badge>
          </div>
          <p className="font-mono font-bold text-xl">{r.timeFormatted ?? formatTime(r.timeMs)}</p>
          {r.recordDate && <p className="text-xs text-muted-foreground">{r.recordDate}</p>}
          {r.runWeblink && (
            <a
              href={r.runWeblink}
              target="_blank"
              rel="noopener noreferrer"
              className="flex min-h-6 items-center gap-1 text-xs text-primary hover:underline"
            >
              <ExternalLink className="h-3 w-3" aria-hidden />
              {t("playerStatsCards.viewRecord")}
              <span className="sr-only"> {r.categoryName}</span>
            </a>
          )}
        </div>
      ))}
    </div>
  );
  if (!framed) {
    return (
      <div id="pending-speedruncom-records">
        <PageSection id="stats-pending-speedruncom" title={t("playerStatsCards.pendingRecordsTitle")} headingLevel="h3">
          {/* スイッチは見出し右ではなく本文の先頭に置く（モバイルで見出しを押しつぶさないため） */}
          {toggle}
          {show && <p className="text-sm text-muted-foreground">{t("playerStatsCards.pendingRecordsDescription")}</p>}
          {show && items}
        </PageSection>
      </div>
    );
  }
  return (
    <Card id="pending-speedruncom-records" className="gap-3 py-5">
      <CardHeader className="px-5">
        <div className="flex items-center justify-between gap-3">
          <CardTitle role="heading" aria-level={2} className="text-base flex items-center gap-2">
            <Clock className="h-5 w-5 text-warning" />
            {t("playerStatsCards.pendingRecordsTitle")}
          </CardTitle>
          {toggle}
        </div>
        {show && <CardDescription>{t("playerStatsCards.pendingRecordsDescription")}</CardDescription>}
      </CardHeader>
      {show && <CardContent className="px-5">{items}</CardContent>}
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
  framed = true,
  onRetry,
  loadingClassName,
}: {
  title: string;
  description: string;
  state: "loading" | "done" | "error";
  /** false で箱なし。確定後の欄と同じ見出し（title）の PageSection にして、取得完了で見出しの位置が跳ねないようにする */
  framed?: boolean;
  /** 渡すと、失敗時（state === "error"）だけ「再試行」ボタンを出す */
  onRetry?: () => void;
  /**
   * 箱なしのときだけ、読み込み中（state === "loading"）の欄に付けるクラス（最小の高さ）。届いたあとの中身に近い高さを
   * 確保して、初期表示で見えていたフッターなどが外部統計の到着で押し下げられる（CLS）のを抑える。
   * 到着後（done・error）は外すので、「記録なし」でも大きな空白は残らない
   */
  loadingClassName?: string;
}) {
  const t = useT();
  const isLoading = state === "loading";
  const isError = state === "error";
  const showRetry = useShowServiceRetry(state, !!onRetry);

  const indicator = isLoading ? (
    <LoadingProgressRing />
  ) : isError ? (
    <div className="h-10 w-10 shrink-0 rounded-full border-2 border-destructive/40 flex items-center justify-center" aria-hidden="true">
      <span className="text-destructive text-sm font-bold">!</span>
    </div>
  ) : (
    <div className="h-10 w-10 shrink-0 rounded-full border-2 border-primary/40 flex items-center justify-center">
      <Loader2 className="h-4 w-4 text-primary" />
    </div>
  );
  const message = isLoading ? description : isError ? t("common.loadFailed") : t("common.loadComplete");

  const retryButton = showRetry && onRetry ? (
    <ServiceRetryButton name={title} loading={isLoading} onRetry={onRetry} variant="outline" className="max-md:min-h-11 max-md:px-4" />
  ) : null;
  // 状態の変化（読み込み中 → 失敗）を読み上げさせる。この要素は状態が変わっても DOM に残す
  const messageEl = (
    <p role="status" className="text-sm text-muted-foreground">
      {/* 失敗は、見た目は今のまま、読み上げだけ「{サービス名} の読み込みに失敗しました」にする（3 つの欄で同文になるため） */}
      {isError ? (
        <>
          <span aria-hidden="true">{message}</span>
          <span className="sr-only">{t("common.serviceLoadFailed", { name: title })}</span>
        </>
      ) : (
        message
      )}
    </p>
  );

  if (!framed) {
    return (
      <PageSection
        id={`stats-status-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
        title={title}
        headingLevel="h3"
        className={isLoading ? loadingClassName : undefined}
      >
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {indicator}
          {messageEl}
          {retryButton}
        </div>
      </PageSection>
    );
  }

  return (
    <Card className="py-5">
      <CardContent className="px-5">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {indicator}
          <div>
            <p className="font-medium">{title}</p>
            {messageEl}
          </div>
          {retryButton}
        </div>
      </CardContent>
    </Card>
  );
}
