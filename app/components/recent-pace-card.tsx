import { Link } from "react-router";
import { MinecraftAvatar } from "@/components/minecraft-avatar";
import { Badge } from "@/components/ui/badge";
import { Trophy, Clock, ExternalLink } from "lucide-react";
import type { PaceManRecentRun } from "@/lib/paceman";
import { cn } from "@/lib/utils";

interface RecentPaceCardProps {
  run: PaceManRecentRun;
  isRegistered: boolean;
  uuid?: string;
  displayName?: string;
}

// ミリ秒を "m:ss" 形式に変換
function formatTime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
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

// ネザーイン以外の最も進んだペースを取得
function getLatestSplit(run: PaceManRecentRun): { label: string; igt: number } | null {
  // 進行順に最後の到達スプリットを探す（ネザーイン以外）
  const splits = [
    { key: "finish" as const, label: "Finish" },
    { key: "end" as const, label: "Enter End" },
    { key: "stronghold" as const, label: "Enter Stronghold" },
    { key: "first_portal" as const, label: "Blind" },
    { key: "fortress" as const, label: "Fortress" },
    { key: "bastion" as const, label: "Bastion" },
  ];

  for (const split of splits) {
    const time = run[split.key];
    if (time !== null && time > 0) {
      return {
        label: split.label,
        igt: time,
      };
    }
  }

  return null;
}

export function RecentPaceCard({ run, isRegistered, uuid, displayName }: RecentPaceCardProps) {
  const latestSplit = getLatestSplit(run);
  const isFinished = run.finish !== null && run.finish > 0;
  const paceManUrl = `https://paceman.gg/stats/timeline/${run.nickname}/${run.id}`;

  // ネザーイン以外のペースがない場合は何も表示しない
  if (!latestSplit) {
    return null;
  }

  const handleClick = () => {
    window.open(paceManUrl, "_blank", "noopener,noreferrer");
  };

  return (
    <div
      className={cn(
        "group flex items-center gap-3 p-3 rounded-lg transition-all duration-200 cursor-pointer",
        "hover:bg-secondary/50 active:scale-[0.99]",
        isFinished && "bg-yellow-500/5 hover:bg-yellow-500/10"
      )}
      onClick={handleClick}
    >
      {uuid && (
        <div className="w-10 h-10 rounded-lg overflow-hidden shrink-0">
          <MinecraftAvatar uuid={uuid} size={40} />
        </div>
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <h3 className="font-bold truncate text-sm">
            {displayName || run.nickname} <span className="text-muted-foreground font-normal">@{run.nickname}</span>
          </h3>
          {isFinished && (
            <Trophy className="h-4 w-4 text-yellow-500 shrink-0" />
          )}
        </div>
        <div className="flex items-center gap-2 mt-1">
          <Badge variant="secondary" className="text-xs">
            {latestSplit.label}
          </Badge>
          <span className="text-sm font-mono text-muted-foreground">
            {formatTime(latestSplit.igt)}
          </span>
        </div>
        <div className="flex items-center gap-1 mt-1 text-xs text-muted-foreground">
          <Clock className="h-3 w-3" />
          <span>{getRelativeTime(run.time)}</span>
        </div>
      </div>
      <ExternalLink className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
    </div>
  );
}
