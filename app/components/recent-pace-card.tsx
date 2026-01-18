import { Link } from "react-router";
import { Card, CardContent } from "@/components/ui/card";
import { MinecraftAvatar } from "@/components/minecraft-avatar";
import { Badge } from "@/components/ui/badge";
import { Trophy, Clock } from "lucide-react";
import type { PaceManRecentRun } from "@/lib/paceman";
import { getRecentRunFinalSplit } from "@/lib/paceman";

interface RecentPaceCardProps {
  run: PaceManRecentRun;
  isRegistered: boolean;
  uuid?: string;
}

// ミリ秒を "m:ss.xxx" 形式に変換
function formatTime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const milliseconds = ms % 1000;
  return `${minutes}:${seconds.toString().padStart(2, "0")}.${milliseconds.toString().padStart(3, "0")}`;
}

// 相対時間を計算
function getRelativeTime(unixSeconds: number): string {
  const now = Date.now();
  const diffMs = now - unixSeconds * 1000;
  const diffMinutes = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMinutes / 60);

  if (diffMinutes < 1) return "たった今";
  if (diffMinutes < 60) return `${diffMinutes}分前`;
  if (diffHours < 24) return `${diffHours}時間前`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}日前`;
}

export function RecentPaceCard({ run, isRegistered, uuid }: RecentPaceCardProps) {
  const finalSplit = getRecentRunFinalSplit(run);
  const isFinished = run.finish !== null && run.finish > 0;

  const content = (
    <Card
      className={`group transition-all duration-200 hover:shadow-lg hover:-translate-y-0.5 h-full ${
        isFinished
          ? "border-yellow-500/50 bg-yellow-500/5"
          : "hover:border-primary/30"
      } ${isRegistered ? "cursor-pointer active:scale-[0.98]" : ""}`}
    >
      <CardContent className="p-3">
        <div className="flex items-center gap-3">
          {uuid && (
            <div className="w-10 h-10 rounded-lg overflow-hidden shrink-0">
              <MinecraftAvatar uuid={uuid} size={40} />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="font-bold truncate text-sm">{run.nickname}</h3>
              {isFinished && (
                <Trophy className="h-4 w-4 text-yellow-500 shrink-0" />
              )}
            </div>
            {finalSplit && (
              <div className="flex items-center gap-2 mt-1">
                <Badge
                  variant={isFinished ? "default" : "secondary"}
                  className={`text-xs ${isFinished ? "bg-yellow-500 hover:bg-yellow-600" : ""}`}
                >
                  {finalSplit.label}
                </Badge>
                <span className="text-sm font-mono text-muted-foreground">
                  {formatTime(finalSplit.igt)}
                </span>
              </div>
            )}
            <div className="flex items-center gap-1 mt-1 text-xs text-muted-foreground">
              <Clock className="h-3 w-3" />
              <span>{getRelativeTime(run.time)}</span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );

  if (isRegistered) {
    return <Link to={`/player/${run.nickname}`}>{content}</Link>;
  }

  return content;
}
