import { Link } from "react-router";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { type TwitchStream, getThumbnailUrl } from "@/lib/twitch";
import { MinecraftAvatar } from "@/components/minecraft-avatar";
import { Radio, Users, Twitch } from "lucide-react";

interface StreamCardProps {
  stream: TwitchStream;
  mcid: string | null;
  uuid: string | null;
  slug: string;
  displayName: string | null;
  discordAvatar: string | null;
}

export function StreamCard({ stream, mcid, uuid, slug, displayName, discordAvatar }: StreamCardProps) {
  const thumbnailUrl = getThumbnailUrl(stream.thumbnail_url, 320, 180);
  const startedAt = new Date(stream.started_at);
  const now = Date.now();
  const durationMinutes = Math.floor((now - startedAt.getTime()) / 1000 / 60);
  const durationHours = Math.floor(durationMinutes / 60);
  const durationMins = durationMinutes % 60;
  const durationText = durationHours > 0 ? `${durationHours}:${String(durationMins).padStart(2, "0")}` : `${durationMins}分`;

  // 表示名: displayName > stream.user_name
  const showName = displayName || stream.user_name;

  // アバター: MCIDがある場合はMinecraftアバター、ない場合はDiscordアバター
  const hasMinecraftAvatar = !!uuid;

  return (
    <Card className="overflow-hidden hover:bg-accent/50 transition-colors">
      <div className="flex gap-3 p-3">
        {/* 左: サムネイル */}
        <a
          href={`https://twitch.tv/${stream.user_login}`}
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
          <Badge
            variant="destructive"
            className="absolute top-1 left-1 flex items-center gap-0.5 text-[10px] px-1 py-0"
          >
            <Radio className="h-2.5 w-2.5 animate-pulse" />
            LIVE
          </Badge>
          {/* Twitchアイコン */}
          <Badge
            variant="secondary"
            className="absolute top-1 right-1 p-0.5 bg-purple-600 text-white"
          >
            <Twitch className="h-2.5 w-2.5" />
          </Badge>
        </a>

        {/* 右: 情報 */}
        <div className="flex-1 min-w-0 flex flex-col">
          {/* タイトル */}
          <a
            href={`https://twitch.tv/${stream.user_login}`}
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
            {hasMinecraftAvatar ? (
              <Link to={`/player/${slug}`} className="flex-shrink-0">
                <MinecraftAvatar uuid={uuid} size={24} className="rounded" />
              </Link>
            ) : discordAvatar ? (
              <Link to={`/player/${slug}`} className="flex-shrink-0">
                <img
                  src={discordAvatar}
                  alt={showName}
                  className="w-6 h-6 rounded"
                />
              </Link>
            ) : null}

            {/* 名前 */}
            {slug ? (
              <Link
                to={`/player/${slug}`}
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

          {/* タグ・視聴者数・配信時間 */}
          <div className="mt-1 flex items-center gap-2 flex-wrap">
            {stream.game_name && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 font-normal">
                {stream.game_name}
              </Badge>
            )}
            <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
              <Users className="h-3 w-3" />
              {stream.viewer_count.toLocaleString()}
            </span>
            <span className="text-[10px] text-muted-foreground">
              {durationText}
            </span>
          </div>
        </div>
      </div>
    </Card>
  );
}
