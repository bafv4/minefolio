import { useMemo } from "react";
import { MinecraftAvatar } from "@/components/minecraft-avatar";
import { useT, useLocale } from "@/hooks/use-locale";
import { formatClock, formatClockSeconds } from "@/lib/home-format";
import { formatRelativeTimeInHours } from "@/lib/relative-time";
import { pickDisplayName } from "@/lib/slug";
import type { FeedVideo } from "@/lib/feed-video";
import { ExternalLink } from "lucide-react";

/** /api/home-feed?type=twitch-streams の1件（配信中の Minefolio 登録者） */
export interface HomeTwitchStream {
  stream: {
    id: string;
    user_login: string;
    user_name: string;
    game_id?: string;
    game_name: string;
    title: string;
    started_at: string;
    viewer_count?: number;
  };
  mcid: string | null;
  uuid: string | null;
  slug: string;
  displayName: string | null;
  customSkinUrl: string | null;
}

/** 「最近配信した人」の表示行数 */
export const TWITCH_RECENT_ROWS = 6;

interface Row {
  key: string;
  live: boolean;
  slug: string;
  uuid: string | null;
  skinUrl: string | null;
  mcid: string | null;
  name: string;
  title: string;
  game: string | null;
  href: string;
  /** 配信中: 開始日時 / アーカイブ: 公開日時 */
  at: string | Date;
  durationSeconds: number | null;
}

/**
 * Twitch「最近配信した人」: 1人1行（最新のアーカイブ）、配信中の人を先頭に「配信中」の印付きで出す。
 * 行全体が Twitch への外部リンク。サムネイル・埋め込みは使わない。
 * 行の構成: 左にアバターと名前、その右にタイトル → ゲーム名 → 時間（相対時刻＋アーカイブの長さ）
 */
export function TwitchRecentList({ streams, vods }: { streams: HomeTwitchStream[]; vods: FeedVideo[] }) {
  const t = useT();
  const locale = useLocale();

  const rows = useMemo<Row[]>(() => {
    const result: Row[] = [];
    const seen = new Set<string>();
    for (const s of streams) {
      const id = s.slug || s.stream.user_login.toLowerCase();
      if (seen.has(id)) continue;
      seen.add(id);
      result.push({
        key: `live:${s.stream.id}`,
        live: true,
        slug: s.slug,
        uuid: s.uuid,
        skinUrl: s.customSkinUrl,
        mcid: s.mcid,
        name: s.displayName || s.stream.user_name,
        title: s.stream.title,
        game: s.stream.game_name || null,
        href: `https://www.twitch.tv/${encodeURIComponent(s.stream.user_login)}`,
        at: s.stream.started_at,
        durationSeconds: null,
      });
    }
    for (const v of vods) {
      const id = v.slug || v.videoId;
      if (seen.has(id)) continue;
      seen.add(id);
      result.push({
        key: `vod:${v.videoId}`,
        live: false,
        slug: v.slug ?? "",
        uuid: v.uuid,
        skinUrl: v.customSkinUrl,
        mcid: v.minefolioMcid,
        name: pickDisplayName(v, locale) || v.channelTitle || "Unknown",
        title: v.title,
        game: v.gameName || null,
        href: `https://www.twitch.tv/videos/${encodeURIComponent(v.videoId)}`,
        at: v.publishedAt,
        durationSeconds: v.durationSeconds ?? null,
      });
    }
    return result.slice(0, TWITCH_RECENT_ROWS);
  }, [streams, vods, locale]);

  return (
    <ul className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border/70 bg-background/80">
      {rows.map((r) => (
        <li key={r.key}>
          <a
            href={r.href}
            target="_blank"
            rel="noopener noreferrer"
            className="grid min-h-14 grid-cols-[auto_1fr_auto] items-center gap-x-3 gap-y-1 px-3 py-2 transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:grid-cols-[12rem_1fr_auto]"
          >
            <span className="flex min-w-0 items-center gap-2.5">
              <MinecraftAvatar uuid={r.uuid} skinUrl={r.skinUrl} mcid={r.mcid} size={32} className="shrink-0 rounded-lg" />
              <span className="hidden min-w-0 sm:block">
                <span className="block truncate text-sm font-medium">{r.name}</span>
                {r.live && (
                  <span className="inline-flex items-center gap-1 text-[11px] font-medium text-destructive">
                    <span className="h-1.5 w-1.5 rounded-full bg-destructive" aria-hidden="true" />
                    {t("home.liveStreaming")}
                  </span>
                )}
              </span>
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm sm:hidden font-medium">{r.name}</span>
              <span className="block truncate text-sm">{r.title}</span>
              <span className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                {r.live && (
                  <span className="inline-flex items-center gap-1 font-medium text-destructive sm:hidden">
                    <span className="h-1.5 w-1.5 rounded-full bg-destructive" aria-hidden="true" />
                    {t("home.liveStreaming")}
                  </span>
                )}
                {r.game && <span className="truncate">{r.game}</span>}
              </span>
            </span>
            <span className="flex shrink-0 items-center gap-2 text-xs tabular-nums text-muted-foreground">
              <span className="text-right" suppressHydrationWarning>
                <span className="block">
                  {r.live
                    ? formatClock(Math.max(0, Date.now() - new Date(r.at).getTime()))
                    : formatRelativeTimeInHours(t, r.at)}
                </span>
                {!r.live && r.durationSeconds ? (
                  <span className="block font-mono">{formatClockSeconds(r.durationSeconds)}</span>
                ) : null}
              </span>
              <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            </span>
          </a>
        </li>
      ))}
    </ul>
  );
}
