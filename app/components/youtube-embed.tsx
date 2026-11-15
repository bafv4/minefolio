import { cn } from "@/lib/utils";

/** YouTube 埋め込み iframe の `allow`（押してから読み込む埋め込み youtube-click-embed.tsx と共有） */
export const YOUTUBE_IFRAME_ALLOW =
  "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture";

/**
 * aspect-video の YouTube 埋め込み iframe。
 * iframe の属性（allow / loading 等）をここに集約し、埋め込み面ごとのコピペを防ぐ。
 * src には必ず youtube-url.ts の getYouTubeEmbedUrl() で変換した埋め込みURLを渡すこと
 * （視聴ページURLを渡すと X-Frame-Options でブロックされる）。
 */
export function YouTubeEmbed({
  embedUrl,
  title,
  className,
}: {
  embedUrl: string;
  title: string;
  className?: string;
}) {
  return (
    <div className={cn("aspect-video rounded-lg overflow-hidden bg-secondary", className)}>
      <iframe
        className="w-full h-full"
        src={embedUrl}
        title={title}
        loading="lazy"
        allow={YOUTUBE_IFRAME_ALLOW}
        allowFullScreen
      />
    </div>
  );
}
