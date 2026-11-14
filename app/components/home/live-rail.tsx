import type { ReactNode } from "react";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { MinecraftAvatar } from "@/components/minecraft-avatar";
import { PaceManSplitMark } from "@/components/paceman-split-mark";
import { StageBar } from "@/components/pace-stage-bar";
import { useT, useLocale } from "@/hooks/use-locale";
import { cn } from "@/lib/utils";
import { pickMcidDisplayName } from "@/lib/mcid-display-name";
import { pickDisplayName } from "@/lib/slug";
import { formatRelativeTimeInMinutes } from "@/lib/relative-time";
import { formatClock, splitMinutesSeconds } from "@/lib/home-format";
import { splitStage, type RankedLiveMatch } from "@/lib/home-live";
import { getLatestSplit, getSplitTimeline, type PaceManLiveRun } from "@/lib/paceman";
import type { CachedPace } from "@/lib/paceman-cache";
import { AlertCircle, ExternalLink, Heart, RefreshCw, Swords } from "lucide-react";
import { Twitch } from "@/components/brand-icons";
import type { HomeTwitchStream } from "@/components/home/twitch-recent-list";

export interface McidMaps {
  mcidToUuid: Record<string, string>;
  mcidToSlug: Record<string, string>;
  mcidToDisplayName: Record<string, string>;
  mcidToDisplayNameAlphabet: Record<string, string>;
  mcidToSkinUrl: Record<string, string>;
}

const CARD_CLASS =
  "group relative flex flex-col gap-3 rounded-xl border border-border/70 bg-background/80 p-4 transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md motion-reduce:transition-none motion-reduce:hover:translate-y-0";

/** カード全面クリック用のオーバーレイ（名前リンクの ::after）。配信リンク等は relative z-10 で手前に出す */
const NAME_LINK_CLASS =
  "min-w-0 truncate rounded-sm text-sm font-semibold after:absolute after:inset-0 after:z-0 after:rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function CardHead({
  slug,
  uuid,
  skinUrl,
  name,
  mcid,
  isFavorite,
  isStreaming,
  sub,
}: {
  slug: string | undefined;
  uuid: string | undefined;
  skinUrl: string | undefined | null;
  name: string;
  mcid: string;
  isFavorite: boolean;
  isStreaming: boolean;
  sub: string;
}) {
  const t = useT();
  return (
    <div className="flex items-center gap-2.5">
      <MinecraftAvatar uuid={uuid} skinUrl={skinUrl} mcid={mcid} size={36} className="shrink-0 rounded-lg" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          {slug ? (
            <Link to={`/player/${slug}`} prefetch="intent" className={NAME_LINK_CLASS}>
              {name}
            </Link>
          ) : (
            <span className="min-w-0 truncate text-sm font-semibold">{name}</span>
          )}
          {isFavorite && (
            <Heart className="h-3.5 w-3.5 shrink-0 fill-favorite text-favorite" aria-label={t("home.liveFavorite")} />
          )}
        </div>
        <p className="truncate text-xs text-muted-foreground">{sub}</p>
      </div>
      {isStreaming && (
        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-[11px] font-medium text-destructive">
          <span className="h-1.5 w-1.5 rounded-full bg-destructive" aria-hidden="true" />
          {t("home.liveStreaming")}
        </span>
      )}
    </div>
  );
}

function WatchLink({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="relative z-10 inline-flex min-h-11 items-center gap-1.5 rounded-md text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-8"
    >
      <Twitch className="h-3.5 w-3.5" />
      {label}
      <ExternalLink className="h-3 w-3" aria-hidden="true" />
    </a>
  );
}

/** 状態帯。種別（PaceMan バー / Ranked ピル / Twitch タイトル2行）によらず高さを固定し、下の時間ブロックの位置をそろえる */
function StateBand({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("flex h-10 flex-col justify-center", className)}>{children}</div>;
}

/** 時間ブロック。ラベル行（h-4）＋時刻（leading-8）の固定高。右側の補足は下端に揃える */
function TimeBlock({
  label,
  time,
  aria,
  aside,
  hydrationSafe,
}: {
  label: ReactNode;
  time: string;
  aria?: string;
  aside?: ReactNode;
  hydrationSafe?: boolean;
}) {
  return (
    <div className="flex items-end justify-between gap-2">
      <div className="min-w-0">
        <div className="flex h-4 items-center text-[11px] leading-4 text-muted-foreground">{label}</div>
        <p
          className="font-mono text-2xl font-semibold leading-8 tabular-nums"
          aria-label={aria}
          suppressHydrationWarning={hydrationSafe}
        >
          {time}
        </p>
      </div>
      {aside}
    </div>
  );
}

/** リンク行。リンクが無いカードでも同じ高さを確保し、カード下端に揃える */
function LinkRow({ children }: { children?: ReactNode }) {
  return <div className="mt-auto flex min-h-11 items-center sm:min-h-8">{children}</div>;
}

interface LiveRunCardProps {
  run: PaceManLiveRun;
  maps: McidMaps;
  bests: Record<string, number> | undefined;
  isFavorite: boolean;
  isStreaming: boolean;
  className?: string;
}

/** PaceMan のライブラン（ネザー入り以降）。進行バー・最新区間の IGT・同区間ベストとの差 */
function LiveRunCard({ run, maps, bests, isFavorite, isStreaming, className }: LiveRunCardProps) {
  const t = useT();
  const locale = useLocale();
  const key = run.nickname.toLowerCase();
  const latest = getLatestSplit(run);
  const timeline = latest ? getSplitTimeline(latest.eventId) : null;
  const stage = latest ? splitStage(latest.eventId) : 0;
  const name = pickMcidDisplayName(maps, key, locale) || run.nickname;
  // ネザーイン・バスティオン入場の段階は差が運（シード）に大きく左右され比較の意味が薄いため、ベスト比を出さない
  const best = timeline && stage > 2 ? bests?.[timeline] : undefined;
  const diff = latest && best != null ? latest.igt - best : null;
  const parts = latest ? splitMinutesSeconds(latest.igt) : null;
  const twitchUrl = run.user.liveAccount ? `https://www.twitch.tv/${encodeURIComponent(run.user.liveAccount)}` : null;

  return (
    <li className={cn(CARD_CLASS, className)}>
      <CardHead
        slug={maps.mcidToSlug[key]}
        uuid={maps.mcidToUuid[key]}
        skinUrl={maps.mcidToSkinUrl[key]}
        name={name}
        mcid={run.nickname}
        isFavorite={isFavorite}
        isStreaming={isStreaming}
        sub={`${run.gameVersion} · @${run.nickname}`}
      />
      <StateBand>
        <StageBar stage={stage} />
      </StateBand>
      <TimeBlock
        label={timeline ? <PaceManSplitMark timeline={timeline} size={13} /> : null}
        time={latest ? formatClock(latest.igt) : "-"}
        aria={parts ? t("home.igtAria", { minutes: parts.minutes, seconds: parts.seconds }) : undefined}
        aside={
          diff != null && (
            <p
              title={t("home.liveBestDiffTitle")}
              className={cn(
                "shrink-0 font-mono text-xs tabular-nums",
                diff <= 0 ? "text-success" : "text-muted-foreground",
              )}
            >
              <span className="mr-1 font-sans text-[11px]">{t("home.liveBestDiff")}</span>
              {diff <= 0 ? "-" : "+"}
              {formatClock(Math.abs(diff))}
            </p>
          )
        }
      />
      <LinkRow>{twitchUrl && <WatchLink href={twitchUrl} label={t("home.liveWatchTwitch")} />}</LinkRow>
    </li>
  );
}

/** Ranked 対戦中のカード。相手・両者のレート・試合の経過時間 */
function RankedMatchCard({
  match,
  isFavorite,
  isStreaming,
  className,
}: {
  match: RankedLiveMatch;
  isFavorite: boolean;
  isStreaming: boolean;
  className?: string;
}) {
  const t = useT();
  const locale = useLocale();
  const name = pickDisplayName(match, locale) || match.mcid;
  const parts = splitMinutesSeconds(match.currentTimeMs);
  return (
    <li className={cn(CARD_CLASS, className)}>
      <CardHead
        slug={match.slug}
        uuid={match.uuid}
        skinUrl={match.skinUrl}
        name={name}
        mcid={match.mcid}
        isFavorite={isFavorite}
        isStreaming={isStreaming}
        sub={`@${match.mcid}`}
      />
      <StateBand>
        <span className="inline-flex w-fit items-center gap-1 rounded-full border border-border/70 bg-background/75 px-2.5 py-1 text-xs text-muted-foreground">
          <Swords className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
          {t("home.rankedLiveBadge")}
        </span>
      </StateBand>
      <TimeBlock
        label={t("home.rankedElapsed")}
        time={formatClock(match.currentTimeMs)}
        aria={t("home.igtAria", { minutes: parts.minutes, seconds: parts.seconds })}
        aside={
          <p className="min-w-0 truncate text-right text-xs text-muted-foreground">
            <span className="font-mono tabular-nums">{match.eloRate ?? "-"}</span>
            {" vs "}
            <span className="font-medium">{match.opponent.nickname || "?"}</span>{" "}
            <span className="font-mono tabular-nums">({match.opponent.eloRate ?? "-"})</span>
          </p>
        }
      />
      <LinkRow>{match.liveUrl && <WatchLink href={match.liveUrl} label={t("home.liveWatchTwitch")} />}</LinkRow>
    </li>
  );
}

/** Twitch で配信中（Minecraft カテゴリ）の Minefolio 登録者。PaceMan・Ranked に出ていない人だけがここに来る */
function TwitchLiveCard({
  item,
  isFavorite,
  className,
}: {
  item: HomeTwitchStream;
  isFavorite: boolean;
  className?: string;
}) {
  const t = useT();
  const locale = useLocale();
  const { stream } = item;
  const name = item.displayName || stream.user_name;
  const elapsedMs = Math.max(0, Date.now() - new Date(stream.started_at).getTime());
  const href = `https://www.twitch.tv/${encodeURIComponent(stream.user_login)}`;
  return (
    <li className={cn(CARD_CLASS, className)}>
      <CardHead
        slug={item.slug || undefined}
        uuid={item.uuid ?? undefined}
        skinUrl={item.customSkinUrl}
        name={name}
        mcid={item.mcid ?? stream.user_login}
        isFavorite={isFavorite}
        isStreaming={false}
        sub={`@${stream.user_login}`}
      />
      <StateBand>
        <p className="line-clamp-2 text-sm leading-5" title={stream.title}>
          {stream.title}
        </p>
      </StateBand>
      <TimeBlock
        label={t("home.twitchElapsed")}
        time={formatClock(elapsedMs)}
        hydrationSafe
        aside={
          typeof stream.viewer_count === "number" && (
            <p className="shrink-0 text-xs text-muted-foreground tabular-nums">
              {t("home.twitchViewers", { count: stream.viewer_count.toLocaleString(locale) })}
            </p>
          )
        }
      />
      <LinkRow>
        <WatchLink href={href} label={t("home.liveWatchTwitch")} />
      </LinkRow>
    </li>
  );
}

/** 0件時の「最近のペース」（同じカードの静止版）。区間進行バー・区間の IGT・相対時刻 */
function RecentPaceCard({ run, maps, className }: { run: CachedPace; maps: McidMaps; className?: string }) {
  const t = useT();
  const locale = useLocale();
  const key = run.mcid.toLowerCase();
  const name = pickMcidDisplayName(maps, key, locale) || run.nickname || run.mcid;
  const parts = splitMinutesSeconds(run.rta);
  return (
    <li className={cn(CARD_CLASS, className)}>
      <CardHead
        slug={maps.mcidToSlug[key]}
        uuid={maps.mcidToUuid[key]}
        skinUrl={maps.mcidToSkinUrl[key]}
        name={name}
        mcid={run.mcid}
        isFavorite={false}
        isStreaming={false}
        sub={`@${run.mcid}`}
      />
      <StateBand>
        <StageBar stage={splitStage(run.timeline)} />
      </StateBand>
      <TimeBlock
        label={<PaceManSplitMark timeline={run.timeline} size={13} />}
        time={formatClock(run.rta)}
        aria={t("home.igtAria", { minutes: parts.minutes, seconds: parts.seconds })}
        aside={
          <p className="shrink-0 text-xs text-muted-foreground" suppressHydrationWarning>
            {formatRelativeTimeInMinutes(t, new Date(run.time * 1000))}
          </p>
        }
      />
      <LinkRow />
    </li>
  );
}

// レールの1枚の幅: モバイル 1.2 枚 / タブレット 2.5 枚 / デスクトップ 4 枚見え（gap-4 = 1rem 込み）
const RAIL_ITEM = "w-[83%] shrink-0 snap-start sm:w-[40%] lg:w-[calc(25%-0.75rem)]";

export type LiveRailEntry =
  | { kind: "pace"; id: string; slug: string | undefined; run: PaceManLiveRun }
  | { kind: "ranked"; id: string; slug: string; match: RankedLiveMatch }
  | { kind: "twitch"; id: string; slug: string | undefined; item: HomeTwitchStream };

/** ライブ欄の本体（件数見出しは HomeSection 側）。レール or 0件時の「いないよ」＋最近のペース */
export function LiveRail({
  entries,
  maps,
  splitBests,
  favoriteSlugs,
  streamingSlugs,
  loading,
  error,
  hasData,
  onRetry,
  recentPaces,
  recentLoading,
  recentError,
  onRetryRecent,
}: {
  entries: LiveRailEntry[];
  maps: McidMaps;
  splitBests: Record<string, Record<string, number>>;
  favoriteSlugs: Set<string>;
  streamingSlugs: Set<string>;
  loading: boolean;
  error: boolean;
  /** 一度でも取得に成功したか（失敗時に「直前の情報を表示」か「取得できません」かの判定用） */
  hasData: boolean;
  onRetry: () => void;
  recentPaces: CachedPace[];
  recentLoading: boolean;
  recentError: boolean;
  onRetryRecent: () => void;
}) {
  const t = useT();

  if (loading) {
    return (
      <div className="flex gap-4 overflow-hidden" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className={cn("h-40 rounded-xl", RAIL_ITEM)} />
        ))}
      </div>
    );
  }

  const notice = error && (
    <div
      role="alert"
      className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-2.5 text-sm text-destructive"
    >
      <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span className="min-w-0">{hasData ? t("home.liveStaleNote") : t("home.liveFetchFailed")}</span>
      <Button variant="outline" size="sm" className="ml-auto min-h-11 shrink-0 sm:min-h-8" onClick={onRetry}>
        <RefreshCw className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
        {t("home.feedRetry")}
      </Button>
    </div>
  );

  if (entries.length > 0) {
    return (
      <div className="space-y-3">
        {notice}
        <ul
          aria-label={t("home.liveTitle")}
          // overflow-x-auto は縦方向もクリップするため、ホバー時の -translate-y-0.5 と shadow-md が切れないよう
          // 上下左右に余白を取り、その分を負のマージンで打ち消す（snap の基準も余白の内側に合わせる）
          className="-mx-2 -mt-2 flex snap-x snap-mandatory scroll-px-2 gap-4 overflow-x-auto px-2 pt-2 pb-3"
        >
          {entries.map((e) => (
            e.kind === "pace" ? (
              <LiveRunCard
                key={e.id}
                className={RAIL_ITEM}
                run={e.run}
                maps={maps}
                bests={splitBests[e.run.nickname.toLowerCase()]}
                isFavorite={!!e.slug && favoriteSlugs.has(e.slug)}
                isStreaming={!!e.slug && streamingSlugs.has(e.slug)}
              />
            ) : e.kind === "twitch" ? (
              <TwitchLiveCard
                key={e.id}
                className={RAIL_ITEM}
                item={e.item}
                isFavorite={!!e.slug && favoriteSlugs.has(e.slug)}
              />
            ) : (
              <RankedMatchCard
                key={e.id}
                className={RAIL_ITEM}
                match={e.match}
                isFavorite={favoriteSlugs.has(e.slug)}
                isStreaming={streamingSlugs.has(e.slug)}
              />
            )
          ))}
        </ul>
      </div>
    );
  }

  // 0件: 「いまライブ中の走者はいません」1行＋最近のペース3件（同じ走者は2件まで）
  const counts = new Map<string, number>();
  const recent = recentPaces
    .filter((p) => {
      const c = counts.get(p.mcid) ?? 0;
      counts.set(p.mcid, c + 1);
      return c < 2;
    })
    .slice(0, 3);
  return (
    <div className="space-y-3">
      {notice}
      {!error && <p className="text-sm text-muted-foreground">{t("home.liveEmpty")}</p>}
      {recentLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-36 rounded-xl" />
          ))}
        </div>
      ) : recentError ? (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-2.5 text-sm text-destructive"
        >
          <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="min-w-0">{t("home.pacesFetchFailed")}</span>
          <Button variant="outline" size="sm" className="ml-auto min-h-11 shrink-0 sm:min-h-8" onClick={onRetryRecent}>
            <RefreshCw className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
            {t("home.feedRetry")}
          </Button>
        </div>
      ) : recent.length > 0 ? (
        <div className="space-y-2">
          {/* /paces への導線は欄見出しの「最近のペース →」に一本化 */}
          <h3 className="text-sm font-medium text-muted-foreground">{t("home.recentPacesTitle")}</h3>
          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {recent.map((run) => (
              <RecentPaceCard key={`${run.mcid}-${run.pacemanRunId}-${run.timeline}`} run={run} maps={maps} />
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
