import { Link } from "react-router";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { type YouTubeVideo, getVideoUrl } from "@/lib/youtube";
import { Play, ExternalLink } from "lucide-react";

interface VideoCardProps {
  video: YouTubeVideo;
}

export function VideoCard({ video }: VideoCardProps) {
  const publishedAt = new Date(video.snippet.publishedAt);
  const now = Date.now();
  const hoursAgo = Math.floor((now - publishedAt.getTime()) / 1000 / 60 / 60);

  const timeAgo =
    hoursAgo < 1
      ? "1時間以内"
      : hoursAgo < 24
        ? `${hoursAgo}時間前`
        : `${Math.floor(hoursAgo / 24)}日前`;

  const videoUrl = video.id.videoId ? getVideoUrl(video.id.videoId) : "#";

  return (
    <Card className="overflow-hidden hover:bg-accent/50 transition-colors">
      <a
        href={videoUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="block"
      >
        {/* サムネイル */}
        <div className="relative aspect-video bg-muted">
          <img
            src={video.snippet.thumbnails.medium.url}
            alt={video.snippet.title}
            className="w-full h-full object-cover"
            loading="lazy"
          />
          {/* 再生アイコン */}
          <div className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 hover:opacity-100 transition-opacity">
            <Play className="h-12 w-12 text-white" fill="white" />
          </div>
          {/* ライブ配信中の場合 */}
          {video.snippet.liveBroadcastContent === "live" && (
            <Badge
              variant="destructive"
              className="absolute top-2 left-2"
            >
              LIVE
            </Badge>
          )}
        </div>
      </a>

      <CardContent className="p-3">
        {/* タイトル */}
        <a
          href={videoUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="block"
        >
          <h3 className="font-medium text-sm line-clamp-2 hover:text-primary transition-colors">
            {video.snippet.title}
          </h3>
        </a>

        {/* チャンネル名・投稿時間 */}
        <div className="mt-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            {video.minefolioMcid ? (
              <Link
                to={`/player/${video.minefolioMcid}`}
                className="text-sm text-primary hover:underline truncate"
              >
                {video.snippet.channelTitle}
              </Link>
            ) : (
              <span className="text-sm text-muted-foreground truncate">
                {video.snippet.channelTitle}
              </span>
            )}
          </div>
          <span className="text-xs text-muted-foreground shrink-0">
            {timeAgo}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
