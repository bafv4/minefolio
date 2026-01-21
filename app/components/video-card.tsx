import { Link } from "react-router";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { MinecraftAvatar } from "@/components/minecraft-avatar";
import { Youtube, Clock } from "lucide-react";
import type { CachedYouTubeVideo } from "@/lib/youtube-cache";

interface VideoCardProps {
  video: CachedYouTubeVideo;
}

export function VideoCard({ video }: VideoCardProps) {
  // サムネイルURL（mqdefault = 320x180）
  const thumbnailUrl = video.thumbnailUrl || `https://i.ytimg.com/vi/${video.videoId}/mqdefault.jpg`;

  // 投稿からの経過時間
  const publishedAt = video.publishedAt;
  const now = Date.now();
  const hoursAgo = Math.floor((now - new Date(publishedAt).getTime()) / 1000 / 60 / 60);

  const timeAgo =
    hoursAgo < 1
      ? "1時間以内"
      : hoursAgo < 24
        ? `${hoursAgo}時間前`
        : `${Math.floor(hoursAgo / 24)}日前`;

  // 表示名: displayName > channelTitle
  const showName = video.displayName || video.channelTitle || "Unknown";

  // アバター: MCIDがある場合はMinecraftアバター、ない場合はDiscordアバター
  const hasMinecraftAvatar = !!video.uuid;

  const videoUrl = `https://www.youtube.com/watch?v=${video.videoId}`;

  return (
    <Card className="overflow-hidden hover:bg-accent/50 transition-colors">
      <div className="flex gap-3 p-3">
        {/* 左: サムネイル */}
        <a
          href={videoUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="relative flex-shrink-0 w-32 aspect-video rounded overflow-hidden bg-muted"
        >
          <img
            src={thumbnailUrl}
            alt={video.title}
            className="w-full h-full object-cover"
            loading="lazy"
          />
          {/* YouTubeアイコン */}
          <Badge
            variant="secondary"
            className="absolute top-1 right-1 p-0.5 bg-red-600 text-white"
          >
            <Youtube className="h-2.5 w-2.5" />
          </Badge>
        </a>

        {/* 右: 情報 */}
        <div className="flex-1 min-w-0 flex flex-col">
          {/* タイトル */}
          <a
            href={videoUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="block"
          >
            <h3 className="font-medium text-sm line-clamp-2 hover:text-primary transition-colors leading-tight">
              {video.title}
            </h3>
          </a>

          {/* ユーザー情報 */}
          <div className="mt-auto pt-1 flex items-center gap-2">
            {/* アバター */}
            {hasMinecraftAvatar && video.slug ? (
              <Link to={`/player/${video.slug}`} className="flex-shrink-0">
                <MinecraftAvatar uuid={video.uuid!} size={24} className="rounded" />
              </Link>
            ) : video.discordAvatar && video.slug ? (
              <Link to={`/player/${video.slug}`} className="flex-shrink-0">
                <img
                  src={video.discordAvatar}
                  alt={showName}
                  className="w-6 h-6 rounded"
                />
              </Link>
            ) : null}

            {/* 名前 */}
            {video.slug ? (
              <Link
                to={`/player/${video.slug}`}
                className="text-xs text-primary hover:underline truncate"
              >
                {showName}
              </Link>
            ) : (
              <span className="text-xs text-muted-foreground truncate">
                {showName}
              </span>
            )}
          </div>

          {/* 投稿時間 */}
          <div className="mt-1 flex items-center gap-2 flex-wrap">
            <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
              <Clock className="h-3 w-3" />
              {timeAgo}
            </span>
          </div>
        </div>
      </div>
    </Card>
  );
}
