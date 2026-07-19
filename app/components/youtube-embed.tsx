import { cn } from "@/lib/utils";

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
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
      />
    </div>
  );
}
