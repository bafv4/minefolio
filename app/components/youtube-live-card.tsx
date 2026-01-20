import { Link } from "react-router";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
    durationText = durationHours > 0 ? `${durationHours}時間${durationMins}分配信中` : `${durationMins}分配信中`;
  }

  const isLive = stream.liveBroadcastContent === "live";
  const isUpcoming = stream.liveBroadcastContent === "upcoming";

  return (
    <Card className="overflow-hidden hover:bg-accent/50 transition-colors">
      <a
        href={`https://www.youtube.com/watch?v=${stream.videoId}`}
        target="_blank"
        rel="noopener noreferrer"
        className="block"
      >
        {/* サムネイル */}
        <div className="relative aspect-video bg-muted">
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
              className="absolute top-2 left-2 flex items-center gap-1"
            >
              <Radio className="h-3 w-3 animate-pulse" />
              LIVE
            </Badge>
          )}
          {isUpcoming && (
            <Badge
              variant="secondary"
              className="absolute top-2 left-2 flex items-center gap-1"
            >
              配信予定
            </Badge>
          )}
          {/* YouTubeアイコン */}
          <Badge
            variant="secondary"
            className="absolute top-2 right-2 flex items-center gap-1 bg-red-600 text-white"
          >
            <Youtube className="h-3 w-3" />
          </Badge>
          {/* 視聴者数（ライブ中のみ） */}
          {isLive && stream.concurrentViewers !== null && (
            <Badge
              variant="secondary"
              className="absolute bottom-2 right-2 flex items-center gap-1"
            >
              <Users className="h-3 w-3" />
              {stream.concurrentViewers.toLocaleString()}
            </Badge>
          )}
        </div>
      </a>

      <CardContent className="p-3">
        {/* タイトル */}
        <a
          href={`https://www.youtube.com/watch?v=${stream.videoId}`}
          target="_blank"
          rel="noopener noreferrer"
          className="block"
        >
          <h3 className="font-medium text-sm line-clamp-2 hover:text-primary transition-colors">
            {stream.title}
          </h3>
        </a>

        {/* チャンネル名 */}
        <div className="mt-2 flex items-center justify-between">
          <div className="flex items-center gap-2">
            {stream.minefolioMcid ? (
              <Link
                to={`/player/${stream.minefolioMcid}`}
                className="text-sm text-primary hover:underline"
              >
                {stream.channelTitle}
              </Link>
            ) : (
              <span className="text-sm text-muted-foreground">
                {stream.channelTitle}
              </span>
            )}
          </div>
          {durationText && (
            <span className="text-xs text-muted-foreground">
              {durationText}
            </span>
          )}
        </div>

        {/* 配信予定時刻（予定の場合） */}
        {isUpcoming && stream.scheduledStartTime && (
          <p className="mt-1 text-xs text-muted-foreground">
            {stream.scheduledStartTime.toLocaleString("ja-JP", {
              month: "short",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })}
            開始予定
          </p>
        )}
      </CardContent>
    </Card>
  );
}
