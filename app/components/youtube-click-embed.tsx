import { useEffect, useId, useRef, useState } from "react";
import { Play } from "lucide-react";
import { cn } from "@/lib/utils";
import { getYouTubeThumbnailUrl } from "@/lib/youtube-url";
import { useT } from "@/hooks/use-locale";

/**
 * 押してから読み込む YouTube 埋め込み。最初はサムネイルと再生ボタンだけを出し、押したら
 * youtube-nocookie.com の iframe（autoplay=1）に差し替える（一覧のように動画が複数並ぶ面で、
 * 表示した瞬間に動画ごとの iframe を読み込まないため）。
 * サムネイルは feed-video-card.tsx と同じ i.ytimg.com（youtube-url.ts の getYouTubeThumbnailUrl）。
 * embedUrl は youtube-url.ts の getYouTubeEmbedUrl() で変換した埋め込み URL を渡す。
 * title は iframe の title、playLabel は再生ボタンの読み上げ名（同じ面に複数並ぶので一意にする）
 */
export function YouTubeClickEmbed({
  embedUrl,
  title,
  playLabel,
  className,
}: {
  embedUrl: string;
  title: string;
  playLabel: string;
  className?: string;
}) {
  const t = useT();
  const noteId = useId();
  const [playing, setPlaying] = useState(false);
  const [thumbFailed, setThumbFailed] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const thumbnailUrl = thumbFailed ? null : getYouTubeThumbnailUrl(embedUrl);
  // サムネイルが取れない（削除・非公開など）ときも押せる状態は保ち、再生できない可能性を先に伝える
  const noThumbnail = !thumbnailUrl;

  // 押したボタンが iframe に置き換わって消えるので、フォーカスを iframe へ移す（キーボード操作で迷子にしない）
  useEffect(() => {
    if (playing) iframeRef.current?.focus();
  }, [playing]);

  return (
    <div className={cn("relative aspect-video overflow-hidden rounded-lg bg-secondary", className)}>
      {playing ? (
        <iframe
          ref={iframeRef}
          className="h-full w-full"
          src={`${embedUrl}${embedUrl.includes("?") ? "&" : "?"}autoplay=1`}
          title={title}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
        />
      ) : (
        <button
          type="button"
          onClick={() => setPlaying(true)}
          aria-label={playLabel}
          aria-describedby={noThumbnail ? noteId : undefined}
          className="group relative block h-full w-full cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        >
          {thumbnailUrl && (
            <img
              src={thumbnailUrl}
              alt=""
              loading="lazy"
              className="h-full w-full object-cover"
              onError={() => setThumbFailed(true)}
              // 削除・非公開の動画でも i.ytimg.com は 120×90 の灰色画像を 200 で返し onError が発火しない。
              // 実サムネイル（hqdefault は 480×360）より小さければ、サムネイルなしの表示にする
              onLoad={(e) => {
                if (e.currentTarget.naturalWidth <= 120) setThumbFailed(true);
              }}
            />
          )}
          {noThumbnail && (
            <span id={noteId} className="absolute inset-x-0 bottom-2 px-2 text-center text-xs text-muted-foreground">
              {t("playerStatsCards.thumbnailUnavailable")}
            </span>
          )}
          <span className="absolute inset-0 flex items-center justify-center bg-black/0 transition-colors group-hover:bg-black/25">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-black/60 shadow-md">
              <Play className="ml-0.5 h-6 w-6 fill-white text-white" aria-hidden="true" />
            </span>
          </span>
        </button>
      )}
    </div>
  );
}
