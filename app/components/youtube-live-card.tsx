import { Link } from "react-router";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { MinecraftAvatar } from "@/components/minecraft-avatar";
import { Radio, Users, Youtube } from "lucide-react";
import type { CachedYouTubeLive } from "@/lib/youtube-cache";

interface YouTubeLiveCardProps {
  stream: CachedYouTubeLive;
}

export function YouTubeLiveCard({ stream }: YouTubeLiveCardProps) {
  // サムネイルURL（mqdefault = 320x180）
  const thumbnailUrl = stream.thumbnailUrl || `https://i.ytimg.com/vi/${stream.videoId}/mqdefault.jpg`;

  // 配信開始からの経過時間
  const startedAt = stream.actualStartTime;
  let durationText = "";
  if (startedAt) {
    const now = Date.now();
    const durationMinutes = Math.floor((now - startedAt.getTime()) / 1000 / 60);
    const durationHours = Math.floor(durationMinutes / 60);
    const durationMins = durationMinutes % 60;
    durationText = durationHours > 0 ? `${durationHours}:${String(durationMins).padStart(2, "0")}` : `${durationMins}分`;
  }

  const isLive = stream.liveBroadcastContent === "live";
  const isUpcoming = stream.liveBroadcastContent === "upcoming";

  // 表示名: displayName > channelTitle
  const showName = stream.displayName || stream.channelTitle || "Unknown";

  // アバター: MCIDがある場合はMinecraftアバター、ない場合はDiscordアバター
  const hasMinecraftAvatar = !!stream.uuid;

  return (
    <Card className="overflow-hidden hover:bg-accent/50 transition-colors">
      <div className="flex gap-3 p-3">
        {/* 左: サムネイル */}
        <a
          href={`https://www.youtube.com/watch?v=${stream.videoId}`}
          target="_blank"
          rel="noopener noreferrer"
          className="relative flex-shrink-0 w-32 aspect-video rounded overflow-hidden bg-muted"
        >
          <img
            src={thumbnailUrl}
            alt={stream.title}
            className="w-full h-full object-cover"
            loading="lazy"
          />
          {/* ライブバッジ */}
          {isLive && (
            <Badge
              variant="destructive"
              className="absolute top-1 left-1 flex items-center gap-0.5 text-[10px] px-1 py-0"
            >
              <Radio className="h-2.5 w-2.5 animate-pulse" />
              LIVE
            </Badge>
          )}
          {isUpcoming && (
            <Badge
              variant="secondary"
              className="absolute top-1 left-1 text-[10px] px-1 py-0"
            >
              予定
            </Badge>
          )}
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
            href={`https://www.youtube.com/watch?v=${stream.videoId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="block"
          >
            <h3 className="font-medium text-sm line-clamp-2 hover:text-primary transition-colors leading-tight">
              {stream.title}
            </h3>
          </a>

          {/* ユーザー情報 */}
          <div className="mt-auto pt-1 flex items-center gap-2">
            {/* アバター */}
            {hasMinecraftAvatar && stream.slug ? (
              <Link to={`/player/${stream.slug}`} className="flex-shrink-0">
                <MinecraftAvatar uuid={stream.uuid!} size={24} className="rounded" />
              </Link>
            ) : stream.discordAvatar && stream.slug ? (
              <Link to={`/player/${stream.slug}`} className="flex-shrink-0">
                <img
                  src={stream.discordAvatar}
                  alt={showName}
                  className="w-6 h-6 rounded"
                />
              </Link>
            ) : null}

            {/* 名前 */}
            {stream.slug ? (
              <Link
                to={`/player/${stream.slug}`}
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

          {/* 視聴者数・配信時間 */}
          <div className="mt-1 flex items-center gap-2 flex-wrap">
            {isLive && stream.concurrentViewers !== null && (
              <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                <Users className="h-3 w-3" />
                {stream.concurrentViewers.toLocaleString()}
              </span>
            )}
            {durationText && (
              <span className="text-[10px] text-muted-foreground">
                {durationText}
              </span>
            )}
            {/* 配信予定時刻（予定の場合） */}
            {isUpcoming && stream.scheduledStartTime && (
              <span className="text-[10px] text-muted-foreground">
                {stream.scheduledStartTime.toLocaleString("ja-JP", {
                  month: "short",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}
