import { useRef, useState, type ReactNode, type Ref } from "react";
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
import { RelativeTime } from "@/components/relative-time";
import { formatClock, formatStreamDuration, splitMinutesSeconds } from "@/lib/home-format";
import {
  isFinishedRun,
  LIVE_STAGES,
  liveSortKey,
  paceBestKey,
  paceElapsedRtaMs,
  splitStage,
  twitchChannelUrl,
  type HomeTwitchStream,
  type RankedLiveMatch,
  type RankedLiveResult,
} from "@/lib/home-live";
import { getLatestSplit, getSplitTimeline } from "@/lib/pace-splits";
import type { PaceManLiveRun } from "@/lib/paceman";
import type { CachedPace } from "@/lib/paceman-cache";
import { ArrowRight, ChevronDown, ChevronUp, ExternalLink, History, Swords } from "lucide-react";
import { FavoriteMark } from "@/components/favorite-mark";
import { Twitch } from "@/components/brand-icons";
import type { McidUserMaps } from "@/lib/home-user-data.server";
import { FeedErrorNotice } from "@/components/home/feed-error-notice";
import { StreamingBadge } from "@/components/home/streaming-badge";
import { useLiveFlip, useStageReachPulse } from "@/components/home/use-live-motion";

export type McidMaps = McidUserMaps;

const CARD_CLASS =
  "group relative flex flex-col gap-3 rounded-xl border bg-card p-4 transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md motion-reduce:transition-none motion-reduce:hover:translate-y-0";

/** カード枠。終了カード（一覧から消えて少しの間だけ残しているもの）は枠を一段弱める（本文テキストの濃さは変えない） */
const cardClass = (ended?: boolean) => cn(CARD_CLASS, ended ? "border-border/40" : "border-border/70");

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
          {isFavorite && <FavoriteMark />}
        </div>
        <p className="truncate text-xs text-muted-foreground">{sub}</p>
      </div>
      {isStreaming && <StreamingBadge filled />}
    </div>
  );
}

/** 時間ブロックのラベル行の右肩に添える小さな「現在 m:ss」（ランの現在のタイム。大きな数字は区間に着いたタイムなので、それより新しい今のタイムとして右肩に離して置く。PaceMan・Ranked 共通） */
function ElapsedShort({ ms }: { ms: number }) {
  const t = useT();
  return (
    <span className="whitespace-nowrap">
      {t("home.liveElapsedShort")} <span className="font-mono tabular-nums">{formatClock(ms)}</span>
    </span>
  );
}

function WatchLink({ href, label, name }: { href: string; label: string; name?: string }) {
  const t = useT();
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="relative z-10 inline-flex min-h-11 items-center gap-1.5 rounded-md text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-8"
    >
      <Twitch className="h-3.5 w-3.5" />
      {label}
      {name && <span className="sr-only">{t("home.liveWatchOf", { name })}</span>}
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
function PaceManSourceLine({ gameVersion, status }: { gameVersion?: string; status?: ReactNode }) {
  return (
    <span className="inline-flex h-4 min-w-0 items-center gap-1.5 whitespace-nowrap text-[11px] leading-4 text-muted-foreground">
      <History className="h-3 w-3 shrink-0 text-primary" aria-hidden="true" />
      {status}
      <span className="font-medium">PaceMan</span>
      <span className="truncate">
        {PACEMAN_CATEGORY}
        {gameVersion ? ` · ${gameVersion}` : ""}
      </span>
    </span>
  );
}

/** 時間ブロックの高さ（ラベル行 h-5 + gap-1 + 時刻 leading-8 = 56px）。Twitch カードの同じ段の枠と共有して揃える */
const TIME_SLOT_CLASS = "h-14";

/** 時間ブロック。ラベル行（h-5）＋隙間＋時刻（leading-8）の固定高。右側の補足は下端に揃える */
function TimeBlock({
  label,
  now,
  time,
  aria,
  aside,
  labelRef,
}: {
  label: ReactNode;
  /** 区間到達の合図（淡い面）を出す対象。区間名の行に付ける */
  labelRef?: Ref<HTMLDivElement>;
  /** ラベル行の右肩に出す「現在 m:ss」（任意。出す・出さないでも行の高さは変わらない） */
  now?: ReactNode;
  time: string;
  aria?: string;
  aside?: ReactNode;
}) {
  // 区間マーク＋区間名のすぐ下に大きな数字（区間に着いたタイム）が来て「Enter End 12:51」と読める並び。
  // 「現在 m:ss」はラベル行の右端（shrink-0）に寄せる。右の補足（ベスト比・相手の情報・相対時刻）は大きな数字と
  // 同じ行に置き、ラベルが長いときに補足が押しつぶされて1文字ずつ折れないようにする
  return (
    <div className={cn("flex flex-col gap-1", TIME_SLOT_CLASS)}>
      <div className="flex h-5 min-w-0 items-center justify-between gap-2 whitespace-nowrap text-xs leading-5 text-muted-foreground">
        <div ref={labelRef} className="-mx-1 min-w-0 overflow-hidden rounded px-1">
          {label}
        </div>
        {now && <div className="shrink-0">{now}</div>}
      </div>
      <div className="flex items-end justify-between gap-2">
        <p
          className="shrink-0 font-mono text-2xl font-semibold leading-8 tabular-nums"
          aria-label={aria}
        >
          {time}
        </p>
        {aside && <div className="min-w-0 text-right">{aside}</div>}
      </div>
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
  /** 一覧から消えて少しの間だけ残している終了カード */
  ended?: boolean;
  className?: string;
}

/** PaceMan のライブラン（ネザー入り以降）。進行バー・最新区間の IGT・同区間ベストとの差 */
function LiveRunCard({ run, maps, bests, isFavorite, isStreaming, ended, className }: LiveRunCardProps) {
  const t = useT();
  const locale = useLocale();
  const key = run.nickname.toLowerCase();
  const latest = getLatestSplit(run);
  const timeline = latest ? getSplitTimeline(latest.eventId) : null;
  // 進行バーの段は並び順と同じ深さ（構造物は種類ではなく着いた順で 1つ目=2・2つ目=3。
  // Fortress → Bastion と進んだランが Bastion に着いてバーが戻らないように）
  const stage = liveSortKey({ kind: "pace", run })?.depth ?? 0;
  // 完走の判定は isFinishedRun（credits）。liveSortKey の深さでも credits は最後の段になるので、帯・合図とも同じ事実を見る
  const finished = isFinishedRun(run);
  const pulseRef = useStageReachPulse<HTMLDivElement>(stage, ended, finished);
  const name = pickMcidDisplayName(maps, key, locale) || run.nickname;
  // ベスト比は 2つ目の構造物（Second Structure）以降だけ（構造物は到達順で数える）
  // （2つ目の構造物は種類別のベストではなく、2つ目の構造物どうしのベストと比べる）
  const bestKey = timeline ? paceBestKey(run, timeline, stage) : null;
  const best = bestKey ? bests?.[bestKey] : undefined;
  const diff = latest && best != null ? latest.igt - best : null;
  // 完走（credits あり）は一覧に残っている間から「完走」。credits の無いまま消えたものは「リセット」
  // （PaceMan のライブ一覧から credits 無しで消えるのは実際上ほぼリセットのため、その名前で出す）
  // 経過時間（RTA）は Ranked のカードと同じく区間名の右に小さく添える。完走・終了したランは
  // lastUpdated からの経過がランの時間ではなくなるので出さない
  const elapsedMs = !ended && !finished ? paceElapsedRtaMs(run, Date.now()) : null;
  // 終了カードの liveAccount は消える直前の記録なので、今も配信中（streamingSlugs）のときだけリンクを出す
  const twitchUrl = run.user.liveAccount && (!ended || isStreaming) ? twitchChannelUrl(run.user.liveAccount) : null;
  const status = finished ? (
    <span className="shrink-0 font-semibold text-gold">{t("home.liveFinished")}</span>
  ) : ended ? (
    <span className="shrink-0 font-semibold">{t("home.liveRunReset")}</span>
  ) : undefined;

  return (
    <li className={cn(cardClass(ended), className)}>
      <CardHead
        slug={maps.mcidToSlug[key]}
        uuid={maps.mcidToUuid[key]}
        skinUrl={maps.mcidToSkinUrl[key]}
        name={name}
        mcid={run.nickname}
        isFavorite={isFavorite}
        // PaceMan 上で配信中（liveAccount あり。Twitch 非表示の人はサーバーで null 済み）、または Minefolio 登録の Twitch で配信中
        isStreaming={isStreaming || (!ended && !!run.user.liveAccount)}
        sub={`@${run.nickname}`}
      />
      <StateBand className="gap-1.5">
        <PaceManSourceLine gameVersion={run.gameVersion} status={status} />
        <StageBar stage={stage} muted={ended} finished={finished} />
      </StateBand>
      <TimeBlock
        labelRef={pulseRef}
        label={timeline ? <PaceManSplitMark timeline={timeline} size={16} /> : null}
        now={elapsedMs != null ? <ElapsedShort ms={elapsedMs} /> : undefined}
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
      <LinkRow>{twitchUrl && <WatchLink href={twitchUrl} label={t("home.liveWatchTwitch")} name={name} />}</LinkRow>
    </li>
  );
}

/** Ranked 対戦中のカード。相手・両者のレート・試合の経過時間 */
function RankedMatchCard({
  match,
  isFavorite,
  isStreaming,
  ended,
  result,
  className,
}: {
  match: RankedLiveMatch;
  isFavorite: boolean;
  isStreaming: boolean;
  /** 一覧から消えて少しの間だけ残している終了カード */
  ended?: boolean;
  /** 終了カードの結果。取得前・取れなかったときは null */
  result?: RankedLiveResult | null;
  className?: string;
}) {
  const t = useT();
  const locale = useLocale();
  const name = pickDisplayName(match, locale) || match.mcid;
  const progress = match.progress;
  // 勝利（降参でない）のときは大きな数字を完走タイムにする。それ以外は最後に確認できた状態のまま
  const finishTimeMs = ended && result?.outcome === "win" && !result.forfeited ? result.timeMs : null;
  const shownTimeMs = finishTimeMs ?? (progress ? progress.timeMs : match.currentTimeMs);
  const liveUrl = match.liveUrl && (!ended || isStreaming) ? match.liveUrl : null;
  const stage = finishTimeMs != null ? LIVE_STAGES.length : (progress?.stage ?? 0);
  const pulseRef = useStageReachPulse<HTMLDivElement>(stage, ended);
  const resultLabel = !ended
    ? null
    : !result
      ? { text: t("home.rankedResultChecking"), className: "font-normal" }
      : result.outcome === "win"
        ? { text: t(result.forfeited ? "home.rankedWonByForfeit" : "home.rankedWon"), className: "font-semibold text-success" }
        : result.outcome === "lose"
          ? { text: t(result.forfeited ? "home.rankedForfeited" : "home.rankedLost"), className: "font-semibold text-destructive" }
          : { text: t("home.rankedDraw"), className: "font-semibold" };
  return (
    <li className={cn(cardClass(ended), className)}>
      <CardHead
        slug={match.slug}
        uuid={match.uuid}
        skinUrl={match.skinUrl}
        name={name}
        mcid={match.mcid}
        isFavorite={isFavorite}
        // 配信URLがある（Twitch 非表示の人はサーバーで null 済み）、または Minefolio 登録の Twitch で配信中
        isStreaming={isStreaming || (!ended && !!match.liveUrl)}
        sub={`@${match.mcid}`}
      />
      <StateBand className="gap-1.5">
        {/* 「Ranked 対戦中」は小さな1行ピルにして、同じ段（h-10）の下に登録走者の進行バーを置く。
            本人のレートはこの行の右端に大きめに出し、右下の「vs 相手（レート）・相手の区間」と混ざらないようにする */}
        <div className="flex h-5 items-center justify-between gap-2">
          <span className="inline-flex min-w-0 items-center gap-1 text-[11px] leading-4 font-medium text-muted-foreground">
            <Swords className="h-3 w-3 shrink-0 text-primary" aria-hidden="true" />
            <span className="truncate">
              {ended ? t("home.rankedEnded") : t("home.rankedLiveBadge")}
              {resultLabel && (
                <>
                  {" · "}
                  <span className={resultLabel.className}>{resultLabel.text}</span>
                </>
              )}
            </span>
          </span>
          {match.eloRate != null && (
            <span className="inline-flex shrink-0 items-baseline gap-1">
              <span className="text-[11px] text-muted-foreground">{t("home.rankedOwnRate")}</span>
              <span className="font-mono text-sm font-semibold tabular-nums leading-5">{match.eloRate}</span>
              {ended && result?.eloChange != null && result.eloChange !== 0 && (
                <span
                  className={cn(
                    "font-mono text-[11px] font-semibold tabular-nums",
                    result.eloChange > 0 ? "text-success" : "text-destructive",
                  )}
                >
                  {result.eloChange > 0 ? "+" : ""}
                  {result.eloChange}
                </span>
              )}
            </span>
          )}
        </div>
        {/* 完走で勝った（大きな数字が完走タイム）ときは、バーも Finish まで埋めて数字と食い違わないようにする */}
        <StageBar stage={stage} muted={ended} finished={finishTimeMs != null} />
      </StateBand>
      {/* 大きな数字は PaceMan のカードと同じく「最新区間に着いたタイム」に揃える（横に並ぶカードを同じ物差しで比べられるように）。
          試合の経過時間は右肩に小さく添える。まだ区間に着いていないときだけ経過時間を大きく出す */}
      <TimeBlock
        labelRef={pulseRef}
        label={
          finishTimeMs != null ? (
            <PaceManSplitMark timeline="Finish" size={16} />
          ) : progress ? (
            <PaceManSplitMark timeline={progress.split} size={16} />
          ) : (
            t("home.liveElapsedShort")
          )
        }
        now={finishTimeMs == null && progress ? <ElapsedShort ms={match.currentTimeMs} /> : undefined}
        time={formatClock(shownTimeMs)}
        aria={igtAria(t, shownTimeMs)}
        aside={
          <div className="flex min-w-0 flex-col items-end text-xs leading-4 text-muted-foreground">
            {/* ここは相手の情報だけ（本人のレートは上の「Ranked 対戦中」の行の右） */}
            <p className="max-w-full truncate">
              {"vs "}
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
      <LinkRow>{liveUrl && <WatchLink href={liveUrl} label={t("home.liveWatchTwitch")} name={name} />}</LinkRow>
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
    <li className={cn(cardClass(), className)}>
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
      {/* 大きな等幅の数字は「走りのタイム」に限るため、配信だけのカードでは使わない。
          上段（他カードの「PaceMan / Ranked 対戦中」の段）に配信時間・視聴者数を小さく、下段（タイムの段と同じ高さ）に配信タイトル */}
      <StateBand>
        <p className="flex items-center gap-2 text-[11px] leading-4 text-muted-foreground">
          <span className="inline-flex items-center gap-1 font-medium">
            <Twitch className="h-3 w-3 text-twitch" aria-hidden="true" />
            <span suppressHydrationWarning>{formatStreamDuration(t, elapsedMs)}</span>
          </span>
          {typeof stream.viewer_count === "number" && (
            <span className="tabular-nums">
              {t("home.twitchViewers", { count: stream.viewer_count.toLocaleString(locale) })}
            </span>
          )}
        </p>
      </StateBand>
      <div className={cn("flex items-start", TIME_SLOT_CLASS)}>
        <p className="line-clamp-2 text-sm leading-6 font-medium" title={stream.title}>
          {stream.title}
        </p>
      </div>
      <LinkRow>
        <WatchLink href={href} label={t("home.liveWatchTwitch")} name={name} />
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
    <li className={cn(cardClass(), className)}>
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
          <p className="shrink-0 text-xs text-muted-foreground">
            <RelativeTime date={run.time * 1000} />
          </p>
        }
      />
    </li>
  );
}

// md 未満は横レール（モバイル 1.2 枚 / sm 2.5 枚見え）、md 以上は折り返すグリッド（幅はグリッド任せ）
const RAIL_ITEM = "w-[calc(100%-4rem)] shrink-0 snap-start sm:w-[40%] md:w-auto";

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

/** ended: 一覧から消えて少しの間だけ残している終了カード（見出しの件数・区間の分布には数えない） */
export type LiveRailEntry =
  | { kind: "pace"; id: string; slug: string | undefined; run: PaceManLiveRun; ended?: boolean }
  | { kind: "ranked"; id: string; slug: string; match: RankedLiveMatch; ended?: boolean; result?: RankedLiveResult | null }
  | { kind: "twitch"; id: string; slug: string | undefined; item: HomeTwitchStream; ended?: undefined };

/** ライブ欄の本体（件数見出しは PageSection 側）。レール or 0件時の「いないよ」＋最近のペース */
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
  emptyStrip,
  emptyUpdatedAt,
}: {
  /** 0人のときだけ、0件の1文と導線の下に置く区間分布の帯（文言と導線を帯の上にするため） */
  emptyStrip?: ReactNode;
  /** 0人のときの「N秒前に更新」。0件の文と同じ行の右端へ収める（独立した行にしない） */
  emptyUpdatedAt?: ReactNode;
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
  // 並べ替え（区間到達でカードの順が入れ替わる）を滑らせる。対象は entries の変化だけ
  const listRef = useRef<HTMLUListElement>(null);
  useLiveFlip(
    listRef,
    entries.map((e) => e.id),
  );

  if (loading) {
    return (
      <div className={cn("flex gap-4 overflow-hidden md:overflow-visible", GRID_COLS)} aria-hidden="true">
        {/* 1枚の高さは LiveRunCard（CARD_CLASS の border 2 + p-4 の 32 + gap-3 の 3つ分 36 + 顔 36 + StateBand 40 + TIME_SLOT 56 + LinkRow）に合わせる。
            LinkRow は min-h-11（44）で sm 以上は min-h-8（32）なので 246px / sm 以上 234px。Ranked・Twitch のカードも同じ段の固定高で同寸 */}
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className={cn("h-[15.375rem] rounded-xl sm:h-[14.625rem]", RAIL_ITEM)} />
        ))}
      </div>
    );
  }

  // ライブ欄の帯は最大1本。ライブと過去のペースが両方失敗（ライブは0件＝直前の情報なし）のときは1本にまとめて両方を再試行する
  const bothFailed = error && recentError && entries.length === 0;
  const notice = error && (
    <FeedErrorNotice
      message={
        bothFailed ? t("home.liveAllFetchFailed") : hasData ? t("home.liveStaleNote") : t("home.liveFetchFailed")
      }
      note={t("home.liveRetryNote")}
      onRetry={
        bothFailed
          ? () => {
              onRetry();
              onRetryRecent();
            }
          : onRetry
      }
    />
  );

  if (entries.length > 0) {
    return (
      <div className="space-y-3">
        {notice}
        <ul
          ref={listRef}
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
                ended={e.ended}
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
                ended={e.ended}
                result={e.result}
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
      {/* 0件の1文の隣に次の行き先（最近のペース /paces）を置く。見出し右の「ペース一覧」と同じ行き先だが、
          ライブも注目の走者も空のときに上半分が空振りで終わらないよう、目に入る位置にも出す */}
      {!error && (
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
          <span>{t("home.liveEmpty")}</span>
          <Link
            to="/paces"
            prefetch="intent"
            className="-my-3 inline-flex items-center gap-0.5 rounded-sm py-3 font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {t("home.liveEmptyPacesLink")}
            <ArrowRight className="h-3 w-3" aria-hidden="true" />
          </Link>
        </p>
        {emptyUpdatedAt}
        </div>
      )}
      {/* ライブ0人で最近のペースも0件（読み込み済み）の日は、人数の無い空の7段の帯を出さない。読み込み中・失敗中は高さを保つため出す */}
      {(recentLoading || recentError || recent.length > 0) && emptyStrip}
      {recentLoading ? (
        // 件数は読み込むまで分からないので少なめに描く（モバイルは縦積みなので1枚、md 以上は1段ぶんの3枚）。
        // 多めに描くと、少なかったときに下の欄が大きく上へ動く。
        // 1枚の高さは RecentPaceCard（border 2 + p-4 の 32 + gap-3 の 2つ分 24 + 顔 36 + StateBand 40 + TIME_SLOT 56 = 190px。LinkRow は無い）に合わせる
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className={cn("h-[11.875rem] rounded-xl", i > 0 && "max-md:hidden")} />
          ))}
        </div>
      ) : recentError ? (
        // 両方失敗のときは上のライブの帯1本にまとめているので出さない
        bothFailed ? null : <FeedErrorNotice message={t("home.pacesFetchFailed")} onRetry={onRetryRecent} />
      ) : recent.length > 0 ? (
        <div className="space-y-2">
          {/* /paces への導線は欄見出しの「ペース一覧」と、上の0件の1文の隣のリンク */}
          <h3 className="text-sm font-medium text-muted-foreground">{t("home.recentPacesTitle")}</h3>
          <ul className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {recent.map((run) => (
              <RecentPaceCard key={`${run.mcid}-${run.pacemanRunId}-${run.timeline}`} run={run} maps={maps} />
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
