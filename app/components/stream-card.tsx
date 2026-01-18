import { Link } from "react-router";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { type TwitchStream, getThumbnailUrl } from "@/lib/twitch";
import { Radio, Users, ExternalLink } from "lucide-react";

interface StreamCardProps {
  stream: TwitchStream;
  /** MinefolioのMCID（登録ユーザーの場合） */
  mcid?: string;
}

export function StreamCard({ stream, mcid }: StreamCardProps) {
  const thumbnailUrl = getThumbnailUrl(stream.thumbnail_url, 320, 180);
  const startedAt = new Date(stream.started_at);
  const now = Date.now();
  const durationMinutes = Math.floor((now - startedAt.getTime()) / 1000 / 60);
  const durationHours = Math.floor(durationMinutes / 60);
  const durationMins = durationMinutes % 60;

  return (
    <Card className="overflow-hidden hover:bg-accent/50 transition-colors">
      <a
        href={`https://twitch.tv/${stream.user_login}`}
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
          <Badge
            variant="destructive"
            className="absolute top-2 left-2 flex items-center gap-1"
          >
            <Radio className="h-3 w-3 animate-pulse" />
            LIVE
          </Badge>
          {/* 視聴者数 */}
          <Badge
            variant="secondary"
            className="absolute bottom-2 right-2 flex items-center gap-1"
          >
            <Users className="h-3 w-3" />
            {stream.viewer_count.toLocaleString()}
          </Badge>
        </div>
      </a>

      <CardContent className="p-3">
        {/* タイトル */}
        <a
          href={`https://twitch.tv/${stream.user_login}`}
          target="_blank"
          rel="noopener noreferrer"
          className="block"
        >
          <h3 className="font-medium text-sm line-clamp-2 hover:text-primary transition-colors">
            {stream.title}
          </h3>
        </a>

        {/* ユーザー名 */}
        <div className="mt-2 flex items-center justify-between">
          <div className="flex items-center gap-2">
            {mcid ? (
              <Link
                to={`/player/${mcid}`}
                className="text-sm text-primary hover:underline"
              >
                {stream.user_name}
              </Link>
            ) : (
              <span className="text-sm text-muted-foreground">
                {stream.user_name}
              </span>
            )}
          </div>
          <span className="text-xs text-muted-foreground">
            {durationHours > 0 ? `${durationHours}時間` : ""}
            {durationMins}分配信中
          </span>
        </div>

        {/* ゲーム名 */}
        {stream.game_name && (
          <Badge variant="outline" className="mt-2 text-xs font-normal">
            {stream.game_name}
          </Badge>
        )}
      </CardContent>
    </Card>
  );
}
