import { useState } from "react";
import { Link } from "react-router";
import { MinecraftAvatar } from "@/components/minecraft-avatar";
import { formatRelativeTimeInHours } from "@/lib/relative-time";
import type { FeedVideo } from "@/lib/feed-video";
import { Youtube, Twitch, Play, ExternalLink } from "lucide-react";
import { useT, useLocale } from "@/hooks/use-locale";
import { pickDisplayName } from "@/lib/slug";

/** プラットフォーム上の視聴ページURL */
function getFeedVideoUrl(video: FeedVideo): string {
  return video.platform === "youtube"
    ? `https://www.youtube.com/watch?v=${encodeURIComponent(video.videoId)}`
    : `https://www.twitch.tv/videos/${encodeURIComponent(video.videoId)}`;
}

/**
 * 埋め込みプレイヤーURL。Twitch は parent パラメータに現在のホスト名が必須のため、
 * クリック後（クライアント側）にのみ呼ぶこと
 */
function getEmbedUrl(video: FeedVideo): string {
  if (video.platform === "youtube") {
    return `https://www.youtube.com/embed/${encodeURIComponent(video.videoId)}?autoplay=1`;
  }
  const parent = encodeURIComponent(window.location.hostname);
  return `https://player.twitch.tv/?video=${encodeURIComponent(video.videoId)}&parent=${parent}&autoplay=true`;
}

/** 秒を "1:23:45" / "12:34" 形式に変換 */
function formatDuration(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const mm = hours > 0 ? String(minutes).padStart(2, "0") : String(minutes);
  const ss = String(seconds).padStart(2, "0");
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

/**
 * ホームの動画フィードカード。サムネイルクリックでその場に埋め込みプレイヤーを表示し、
 * タイトル・外部リンクアイコンからプラットフォームの視聴ページへ遷移できる
 */
export function FeedVideoCard({ video }: { video: FeedVideo }) {
  const t = useT();
  const locale = useLocale();
  const [isPlaying, setIsPlaying] = useState(false);

  const isYouTube = video.platform === "youtube";
  const watchUrl = getFeedVideoUrl(video);
  const showName = pickDisplayName(video, locale) || video.channelTitle || "Unknown";
  const platformName = isYouTube ? "YouTube" : "Twitch";
  const thumbnailUrl =
    video.thumbnailUrl ||
    (isYouTube ? `https://i.ytimg.com/vi/${encodeURIComponent(video.videoId)}/mqdefault.jpg` : null);

  return (
    <div className="group relative overflow-hidden rounded-2xl border border-border/70 bg-background/80 transition-all hover:border-primary/40 hover:shadow-sm">
      {/* サムネイル / 埋め込みプレイヤー */}
      <div className="relative aspect-video overflow-hidden bg-muted">
        {isPlaying ? (
          <iframe
            className="h-full w-full"
            src={getEmbedUrl(video)}
            title={video.title}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
        ) : (
          <button
            type="button"
            onClick={() => setIsPlaying(true)}
            aria-label={t("home.playEmbedded", { title: video.title })}
            className="block h-full w-full cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {thumbnailUrl ? (
              <img src={thumbnailUrl} alt={video.title} className="h-full w-full object-cover" loading="lazy" />
            ) : (
              <div className="flex h-full w-full items-center justify-center">
                <Twitch className="h-10 w-10 text-muted-foreground/50" />
              </div>
            )}
            {/* 再生オーバーレイ */}
            <span className="absolute inset-0 flex items-center justify-center bg-black/0 transition-colors group-hover:bg-black/25">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-black/60 opacity-0 shadow-md transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                <Play className="ml-0.5 h-6 w-6 fill-white text-white" />
              </span>
            </span>
            {/* プラットフォームバッジ */}
            <span
              className={`absolute left-2 top-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium text-white ${
                isYouTube ? "bg-red-600/90" : "bg-purple-600/90"
              }`}
            >
              {isYouTube ? <Youtube className="h-3 w-3" /> : <Twitch className="h-3 w-3" />}
              {platformName}
            </span>
            {/* 配信時間（Twitch VOD） */}
            {video.durationSeconds != null && video.durationSeconds > 0 && (
              <span className="absolute bottom-2 right-2 rounded bg-black/70 px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-white">
                {formatDuration(video.durationSeconds)}
              </span>
            )}
          </button>
        )}
      </div>

      <div className="space-y-3 p-4">
        {/* タイトル: プラットフォームの視聴ページへ */}
        <a
          href={watchUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
        >
          <h3 className="line-clamp-2 text-sm font-semibold leading-snug transition-colors hover:text-primary">
            {video.title}
          </h3>
        </a>
        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
          {video.slug ? (
            <Link
              to={`/player/${video.slug}`}
              prefetch="intent"
              className="inline-flex min-w-0 items-center gap-2 transition-colors hover:text-primary"
            >
              {video.uuid ? (
                <MinecraftAvatar uuid={video.uuid} skinUrl={video.customSkinUrl} size={20} className="rounded-md" />
              ) : video.discordAvatar ? (
                <img src={video.discordAvatar} alt={showName} className="h-5 w-5 rounded-md" />
              ) : (
                <div className="h-5 w-5 rounded-md bg-muted" />
              )}
              <span className="truncate">{showName}</span>
            </Link>
          ) : (
            <span className="truncate">{showName}</span>
          )}
          <span className="flex shrink-0 items-center gap-2">
            {formatRelativeTimeInHours(t, video.publishedAt)}
            <a
              href={watchUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={t("home.openOnPlatform", { platform: platformName })}
              className="transition-colors hover:text-primary"
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </span>
        </div>
      </div>
    </div>
  );
}
