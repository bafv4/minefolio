import { Link } from "react-router";
import { useT, useLocale } from "@/hooks/use-locale";
import { getLocalizedDisplayName } from "@/lib/slug";
import { MapPin, Clock } from "lucide-react";
import { memo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { MinecraftAvatar } from "@/components/minecraft-avatar";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { formatRelativeDate } from "@/lib/relative-time";

interface PlayerCardProps {
  player: {
    mcid: string | null;
    uuid: string | null;
    slug: string;
    displayName: string | null;
    displayNameAlphabet?: string | null;
    customSkinUrl?: string | null;
    discordAvatar?: string | null;
    location: string | null;
    updatedAt: Date;
    shortBio: string | null;
  };
}

// 相対時間を計算するヘルパー関数
function PlayerCardComponent({ player }: PlayerCardProps) {
  const t = useT();
  const locale = useLocale();
  const displayName = getLocalizedDisplayName(player, locale);

  return (
    <Link to={`/player/${player.slug}`} prefetch="intent">
      <Card className="group transition-all hover:shadow-sm hover:border-primary/40 hover:-translate-y-0.5 cursor-pointer h-full">
        <CardContent className="p-3 h-[88px] flex items-center">
          <div className="flex items-center gap-3 w-full">
            <div className="w-12 h-12 rounded-lg overflow-hidden shrink-0">
              {player.uuid ? (
                <MinecraftAvatar uuid={player.uuid} skinUrl={player.customSkinUrl} size={48} />
              ) : player.discordAvatar ? (
                <img
                  src={player.discordAvatar}
                  alt={displayName}
                  className="w-12 h-12 object-cover"
                />
              ) : (
                <div className="w-12 h-12 bg-muted" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <h3 className="font-bold truncate">
                      {displayName}
                    </h3>
                  </TooltipTrigger>
                  {displayName.length > 20 && (
                    <TooltipContent>
                      <p>{displayName}</p>
                    </TooltipContent>
                  )}
                </Tooltip>
              </TooltipProvider>
              {player.mcid && <p className="text-muted-foreground text-sm">@{player.mcid}</p>}
              {player.shortBio && (
                <p className="text-muted-foreground text-xs mt-0.5 line-clamp-1">
                  {player.shortBio}
                </p>
              )}
              <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground">
                {player.location && (
                  <span className="flex items-center gap-1">
                    <MapPin className="w-3 h-3" />
                    {player.location}
                  </span>
                )}
                <span className="flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {formatRelativeDate(t, player.updatedAt)}
                </span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

export const PlayerCard = memo(PlayerCardComponent);
