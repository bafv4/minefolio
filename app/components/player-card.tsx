import { Link } from "react-router";
import { MapPin, Clock } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { MinecraftAvatar } from "@/components/minecraft-avatar";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface PlayerCardProps {
  player: {
    mcid: string;
    uuid: string;
    displayName: string | null;
    location: string | null;
    updatedAt: Date;
    shortBio: string | null;
  };
}

// 相対時間を計算するヘルパー関数
function getRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - new Date(date).getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return "今日";
  if (diffDays === 1) return "昨日";
  if (diffDays < 7) return `${diffDays}日前`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}週間前`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)}ヶ月前`;
  return `${Math.floor(diffDays / 365)}年前`;
}

export function PlayerCard({ player }: PlayerCardProps) {
  return (
    <Link to={`/player/${player.mcid}`}>
      <Card className="group transition-all duration-200 hover:shadow-lg hover:border-primary/30 hover:-translate-y-0.5 cursor-pointer h-full active:scale-[0.98]">
        <CardContent className="p-3">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-lg overflow-hidden shrink-0">
              <MinecraftAvatar uuid={player.uuid} size={48} />
            </div>
            <div className="flex-1 min-w-0">
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <h3 className="font-bold truncate">
                      {player.displayName ?? player.mcid}
                    </h3>
                  </TooltipTrigger>
                  {(player.displayName ?? player.mcid).length > 20 && (
                    <TooltipContent>
                      <p>{player.displayName ?? player.mcid}</p>
                    </TooltipContent>
                  )}
                </Tooltip>
              </TooltipProvider>
              <p className="text-muted-foreground text-sm">@{player.mcid}</p>
              {player.shortBio && (
                <p className="text-muted-foreground text-xs mt-0.5 line-clamp-2">
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
                  {getRelativeTime(player.updatedAt)}
                </span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
