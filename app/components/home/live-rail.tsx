import { useState, type ReactNode } from "react";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { MinecraftAvatar } from "@/components/minecraft-avatar";
import { PaceManSplitMark } from "@/components/paceman-split-mark";
import { StageBar } from "@/components/pace-stage-bar";
import { useT, useLocale } from "@/hooks/use-locale";
import type { Translator } from "@/lib/messages";
import { cn } from "@/lib/utils";
import { pickMcidDisplayName } from "@/lib/mcid-display-name";
import { pickDisplayName } from "@/lib/slug";
import { formatRelativeTimeInMinutes } from "@/lib/relative-time";
import { formatClock, splitMinutesSeconds } from "@/lib/home-format";
import { splitStage, twitchChannelUrl, type HomeTwitchStream, type RankedLiveMatch } from "@/lib/home-live";
import { getLatestSplit, getSplitTimeline, type PaceManLiveRun } from "@/lib/paceman";
import type { CachedPace } from "@/lib/paceman-cache";
import { ChevronDown, ChevronUp, ExternalLink, Heart, History, Swords } from "lucide-react";
import { Twitch } from "@/components/brand-icons";
import type { McidUserMaps } from "@/lib/home-user-data.server";
import { FeedErrorNotice } from "@/components/home/feed-error-notice";
import { StreamingBadge } from "@/components/home/streaming-badge";

export type McidMaps = McidUserMaps;

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
      {isStreaming && <StreamingBadge filled />}
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

/** PaceMan が追跡するカテゴリ（RSG Any% のみ）。カテゴリ名は英語固有名のため翻訳しない */
const PACEMAN_CATEGORY = "RSG Any%";

/** データ元の1行（Ranked カードの「Ranked 対戦中」と同じ段）。PaceMan ＋ カテゴリ（＋ バージョン） */
function PaceManSourceLine({ gameVersion }: { gameVersion?: string }) {
  return (
    <span className="inline-flex h-4 min-w-0 items-center gap-1.5 whitespace-nowrap text-[11px] leading-4 text-muted-foreground">
      <History className="h-3 w-3 shrink-0 text-primary" aria-hidden="true" />
      <span className="font-medium">PaceMan</span>
      <span className="truncate">
        {PACEMAN_CATEGORY}
        {gameVersion ? ` · ${gameVersion}` : ""}
      </span>
    </span>
  );
}

/** 時間ブロック。ラベル行（h-5）＋隙間＋時刻（leading-8）の固定高。右側の補足は下端に揃える */
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
      <div className="flex shrink-0 flex-col gap-1">
        <div className="flex h-5 items-center whitespace-nowrap text-xs leading-5 text-muted-foreground">{label}</div>
        <p
          className="font-mono text-2xl font-semibold leading-8 tabular-nums"
          aria-label={aria}
          suppressHydrationWarning={hydrationSafe}
        >
          {time}
        </p>
      </div>
      {aside && <div className="min-w-0 text-right">{aside}</div>}
    </div>
  );
}

/** 時間の読み上げ用ラベル（「◯分◯秒」） */
function igtAria(t: Translator, ms: number): string {
  const { minutes, seconds } = splitMinutesSeconds(ms);
  return t("home.igtAria", { minutes, seconds });
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
  const stage = timeline ? splitStage(timeline) : 0;
  const name = pickMcidDisplayName(maps, key, locale) || run.nickname;
  // ネザーイン・バスティオン入場の段階は差が運（シード）に大きく左右され比較の意味が薄いため、ベスト比を出さない
  const best = timeline && stage > 2 ? bests?.[timeline] : undefined;
  const diff = latest && best != null ? latest.igt - best : null;
  const twitchUrl = run.user.liveAccount ? twitchChannelUrl(run.user.liveAccount) : null;

  return (
    <li className={cn(CARD_CLASS, className)}>
      <CardHead
        slug={maps.mcidToSlug[key]}
        uuid={maps.mcidToUuid[key]}
        skinUrl={maps.mcidToSkinUrl[key]}
        name={name}
        mcid={run.nickname}
        isFavorite={isFavorite}
        // PaceMan 上で配信中（liveAccount あり。Twitch 非表示の人はサーバーで null 済み）、または Minefolio 登録の Twitch で配信中
        isStreaming={isStreaming || !!run.user.liveAccount}
        sub={`@${run.nickname}`}
      />
      <StateBand className="gap-1.5">
        <PaceManSourceLine gameVersion={run.gameVersion} />
        <StageBar stage={stage} />
      </StateBand>
      <TimeBlock
        label={timeline ? <PaceManSplitMark timeline={timeline} size={16} /> : null}
        time={latest ? formatClock(latest.igt) : "-"}
        aria={latest ? igtAria(t, latest.igt) : undefined}
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
  const progress = match.progress;
  return (
    <li className={cn(CARD_CLASS, className)}>
      <CardHead
        slug={match.slug}
        uuid={match.uuid}
        skinUrl={match.skinUrl}
        name={name}
        mcid={match.mcid}
        isFavorite={isFavorite}
        // 配信URLがある（Twitch 非表示の人はサーバーで null 済み）、または Minefolio 登録の Twitch で配信中
        isStreaming={isStreaming || !!match.liveUrl}
        sub={`@${match.mcid}`}
      />
      <StateBand className="gap-1.5">
        {/* 「Ranked 対戦中」は小さな1行ピルにして、同じ段（h-10）の下に登録走者の進行バーを置く */}
        <span className="inline-flex h-4 w-fit items-center gap-1 text-[11px] leading-4 font-medium text-muted-foreground">
          <Swords className="h-3 w-3 text-primary" aria-hidden="true" />
          {t("home.rankedLiveBadge")}
        </span>
        <StageBar stage={progress?.stage ?? 0} />
      </StateBand>
      <TimeBlock
        label={
          progress ? (
            <span className="inline-flex min-w-0 items-center gap-1.5">
              <PaceManSplitMark timeline={progress.split} size={16} />
              <span className="font-mono tabular-nums">{formatClock(progress.timeMs)}</span>
            </span>
          ) : (
            t("home.rankedElapsed")
          )
        }
        time={formatClock(match.currentTimeMs)}
        aria={igtAria(t, match.currentTimeMs)}
        aside={
          <div className="flex min-w-0 flex-col items-end text-xs leading-4 text-muted-foreground">
            <p className="max-w-full truncate">
              <span className="font-mono tabular-nums">{match.eloRate ?? "-"}</span>
              {" vs "}
              <span className="font-medium">{match.opponent.nickname || "?"}</span>{" "}
              <span className="font-mono tabular-nums">({match.opponent.eloRate ?? "-"})</span>
            </p>
            {match.opponent.progress && (
              <p className="flex max-w-full items-center gap-1 whitespace-nowrap">
                <span className="shrink-0">{t("home.rankedOpponentStage")}:</span>
                <PaceManSplitMark
                  timeline={match.opponent.progress.split}
                  size={11}
                  className="min-w-0"
                  labelClassName="truncate"
                />
              </p>
            )}
          </div>
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
  const name = pickDisplayName(item, locale) || stream.user_name;
  const elapsedMs = Math.max(0, Date.now() - new Date(stream.started_at).getTime());
  const href = twitchChannelUrl(stream.user_login);
  return (
    <li className={cn(CARD_CLASS, className)}>
      <CardHead
        slug={item.slug || undefined}
        uuid={item.uuid ?? undefined}
        skinUrl={item.customSkinUrl}
        name={name}
        mcid={item.mcid ?? stream.user_login}
        isFavorite={isFavorite}
        isStreaming
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
      <StateBand className="gap-1.5">
        <PaceManSourceLine />
        <StageBar stage={splitStage(run.timeline)} />
      </StateBand>
      <TimeBlock
        label={<PaceManSplitMark timeline={run.timeline} size={16} />}
        time={formatClock(run.rta)}
        aria={igtAria(t, run.rta)}
        aside={
          <p className="shrink-0 text-xs text-muted-foreground" suppressHydrationWarning>
            {formatRelativeTimeInMinutes(t, new Date(run.time * 1000))}
          </p>
        }
      />
    </li>
  );
}

// md 未満は横レール（モバイル 1.2 枚 / sm 2.5 枚見え）、md 以上は折り返すグリッド（幅はグリッド任せ）
const RAIL_ITEM = "w-[83%] shrink-0 snap-start sm:w-[40%] md:w-auto";

/** md 以上のグリッド列数（md=2 / lg=3 / xl=4）と、折りたたみ時に出す件数（2行分） */
const GRID_COLS = "md:grid md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4";
const MD_VISIBLE = 4;
const LG_VISIBLE = 6;
const XL_VISIBLE = 8;

/** 折りたたみ時、各ブレークポイントで2行分を超える項目を隠す CSS（md 未満のレールでは常に全件表示） */
function collapsedItemClass(index: number): string | undefined {
  if (index >= XL_VISIBLE) return "md:hidden";
  if (index >= LG_VISIBLE) return "md:max-xl:hidden";
  if (index >= MD_VISIBLE) return "md:max-lg:hidden";
  return undefined;
}

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
  const [expanded, setExpanded] = useState(false);

  if (loading) {
    return (
      <div className={cn("flex gap-4 overflow-hidden md:overflow-visible", GRID_COLS)} aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className={cn("h-40 rounded-xl", RAIL_ITEM)} />
        ))}
      </div>
    );
  }

  const notice = error && (
    <FeedErrorNotice message={hasData ? t("home.liveStaleNote") : t("home.liveFetchFailed")} onRetry={onRetry} />
  );

  if (entries.length > 0) {
    return (
      <div className="space-y-3">
        {notice}
        <ul
          aria-label={t("home.liveTitle")}
          // md 未満: 横レール。overflow-x-auto は縦方向もクリップするため、ホバー時の -translate-y-0.5 と
          // shadow-md が切れないよう上下左右に余白を取り、その分を負のマージンで打ち消す（snap の基準も余白の内側）。
          // md 以上: 折り返すグリッド（overflow なし・余白打ち消しも解除）
          className={cn(
            "-mx-2 -mt-2 flex snap-x snap-mandatory scroll-px-2 gap-4 overflow-x-auto px-2 pt-2 pb-3",
            "md:mx-0 md:mt-0 md:snap-none md:overflow-visible md:p-0",
            GRID_COLS,
          )}
        >
          {entries.map((e, i) => {
            const itemClass = cn(RAIL_ITEM, !expanded && collapsedItemClass(i));
            const isFavorite = !!e.slug && favoriteSlugs.has(e.slug);
            const isStreaming = !!e.slug && streamingSlugs.has(e.slug);
            return e.kind === "pace" ? (
              <LiveRunCard
                key={e.id}
                className={itemClass}
                run={e.run}
                maps={maps}
                bests={splitBests[e.run.nickname.toLowerCase()]}
                isFavorite={isFavorite}
                isStreaming={isStreaming}
              />
            ) : e.kind === "twitch" ? (
              <TwitchLiveCard key={e.id} className={itemClass} item={e.item} isFavorite={isFavorite} />
            ) : (
              <RankedMatchCard
                key={e.id}
                className={itemClass}
                match={e.match}
                isFavorite={isFavorite}
                isStreaming={isStreaming}
              />
            );
          })}
        </ul>
        {entries.length > MD_VISIBLE && (
          // md 以上のみ。そのブレークポイントで隠れる項目が無ければボタンも出さない（モバイルはレールで全件見られる）
          <div
            className={cn(
              "hidden justify-center md:flex",
              entries.length <= LG_VISIBLE && "lg:hidden",
              entries.length <= XL_VISIBLE && "xl:hidden",
            )}
          >
            <Button
              variant="outline"
              size="sm"
              className="min-h-8"
              aria-expanded={expanded}
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded ? (
                <>
                  <ChevronUp className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                  {t("home.liveCollapse")}
                </>
              ) : (
                <>
                  <ChevronDown className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                  <span className="md:max-lg:inline lg:hidden">
                    {t("home.liveShowMore", { count: entries.length - MD_VISIBLE })}
                  </span>
                  <span className="hidden lg:max-xl:inline">
                    {t("home.liveShowMore", { count: Math.max(0, entries.length - LG_VISIBLE) })}
                  </span>
                  <span className="hidden xl:inline">
                    {t("home.liveShowMore", { count: Math.max(0, entries.length - XL_VISIBLE) })}
                  </span>
                </>
              )}
            </Button>
          </div>
        )}
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
        <FeedErrorNotice message={t("home.pacesFetchFailed")} onRetry={onRetryRecent} />
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
