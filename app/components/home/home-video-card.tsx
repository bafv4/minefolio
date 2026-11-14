import { useState } from "react";
import { Link } from "react-router";
import { MinecraftAvatar } from "@/components/minecraft-avatar";
import { getEmbedUrl, getFeedVideoThumbnailUrl, getFeedVideoUrl } from "@/components/feed-video-card";
import { Youtube } from "@/components/brand-icons";
import { useT, useLocale } from "@/hooks/use-locale";
import { formatRelativeTimeInHours } from "@/lib/relative-time";
import { pickDisplayName } from "@/lib/slug";
import type { FeedVideo } from "@/lib/feed-video";
import { ExternalLink, Play } from "lucide-react";

/**
 * ホームの YouTube 動画カード（メディアグリッド用）。カード全体がその場で再生（埋め込み）。
 * 外部リンクは右上の 44px アイコンボタン。Tab 停止点は「再生」「外部リンク」（＋走者リンク）。
 * `/videos` 共用の FeedVideoCard とは挙動が違うため別コンポーネントにしている（共有の見た目は据え置き）。
 */
export function HomeVideoCard({ video }: { video: FeedVideo }) {
  const t = useT();
  const locale = useLocale();
  const [isPlaying, setIsPlaying] = useState(false);
  const [thumbFailed, setThumbFailed] = useState(false);
  const watchUrl = getFeedVideoUrl(video);
  const showName = pickDisplayName(video, locale) || video.channelTitle || "Unknown";
  const thumb = thumbFailed ? null : getFeedVideoThumbnailUrl(video);

  return (
    // h-full: グリッド／横レールの枠いっぱいに伸ばし、タイトル1行・2行のカードでもフッター（走者・相対時刻）を下端にそろえる
    <div className="group relative flex h-full flex-col overflow-hidden rounded-xl border border-border/70 bg-card transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md motion-reduce:transition-none motion-reduce:hover:translate-y-0">
      {!isPlaying && (
        <button
          type="button"
          onClick={() => setIsPlaying(true)}
          aria-label={t("home.playEmbedded", { title: video.title })}
          className="absolute inset-0 z-0 cursor-pointer rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      )}
      <div className="relative aspect-video overflow-hidden bg-muted">
        {isPlaying ? (
          <iframe
            className="relative z-10 h-full w-full"
            src={getEmbedUrl(video)}
            title={video.title}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
        ) : (
          <>
            {thumb ? (
              <img src={thumb} alt="" className="h-full w-full object-cover" loading="lazy" onError={() => setThumbFailed(true)} />
            ) : (
              <div className="flex h-full w-full items-center justify-center">
                <Youtube className="h-10 w-10 text-muted-foreground/50" />
              </div>
            )}
            <span className="absolute inset-0 flex items-center justify-center bg-black/0 transition-colors group-hover:bg-black/25">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-black/60 opacity-0 shadow-md transition-opacity group-hover:opacity-100">
                <Play className="ml-0.5 h-6 w-6 fill-white text-white" />
              </span>
            </span>
            <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-black/70 px-2 py-0.5 text-[11px] font-medium text-white">
              <Youtube className="h-3 w-3 text-youtube" />
              YouTube
            </span>
          </>
        )}
        {/* 外部リンク: 右上の 44px アイコンボタン（再生中も押せる） */}
        <a
          href={watchUrl}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={t("home.openOnPlatform", { platform: "YouTube" })}
          className="absolute right-1 top-1 z-20 inline-flex size-11 items-center justify-center rounded-full bg-black/70 text-white transition-colors hover:bg-black/85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ExternalLink className="h-4 w-4" aria-hidden="true" />
        </a>
      </div>
      <div className="flex flex-1 flex-col p-4">
        <h3 className="line-clamp-2 text-sm font-semibold leading-snug">{video.title}</h3>
        <div className="flex-1" />
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-border/60 pt-3 text-xs text-muted-foreground">
          {video.slug ? (
            <Link
              to={`/player/${video.slug}`}
              prefetch="intent"
              className="relative z-10 inline-flex min-h-11 min-w-0 items-center gap-2 transition-colors hover:text-primary sm:min-h-5"
            >
              <MinecraftAvatar uuid={video.uuid} skinUrl={video.customSkinUrl} size={20} className="rounded-md" />
              <span className="truncate">{showName}</span>
            </Link>
          ) : (
            // 走者リンクが無い動画も、リンクあり（モバイル 44px・sm 以上はアバター 20px）と同じ行の高さにしてフッター位置をそろえる
            <span className="inline-flex min-h-11 min-w-0 items-center sm:min-h-5">
              <span className="truncate">{showName}</span>
            </span>
          )}
          <span className="ml-auto shrink-0" suppressHydrationWarning>
            {formatRelativeTimeInHours(t, video.publishedAt)}
          </span>
        </div>
      </div>
    </div>
  );
}
