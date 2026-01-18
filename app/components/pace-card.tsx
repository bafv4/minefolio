import { Link } from "react-router";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  type PaceManLiveRun,
  getSplitLabel,
  getLatestSplit,
} from "@/lib/paceman";
import { formatTime } from "@/lib/time-utils";
import { Timer, ExternalLink } from "lucide-react";

interface PaceCardProps {
  run: PaceManLiveRun;
  /** Minefolioに登録されているユーザーかどうか */
  isRegistered: boolean;
}

export function PaceCard({ run, isRegistered }: PaceCardProps) {
  const latestSplit = getLatestSplit(run);
  const now = Date.now();
  const updatedAgo = Math.floor((now - run.lastUpdated) / 1000 / 60); // 分

  return (
    <Card className="overflow-hidden hover:bg-accent/50 transition-colors">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            {/* プレイヤー名 */}
            <div className="flex items-center gap-2">
              {isRegistered ? (
                <Link
                  to={`/player/${run.nickname}`}
                  className="font-medium text-primary hover:underline truncate"
                >
                  {run.nickname}
                </Link>
              ) : (
                <span className="font-medium truncate">{run.nickname}</span>
              )}
              <Badge variant="outline" className="shrink-0 text-xs">
                {run.gameVersion}
              </Badge>
            </div>

            {/* 現在のスプリット */}
            {latestSplit && (
              <div className="mt-2 flex items-center gap-2">
                <Badge variant="secondary" className="font-normal">
                  {getSplitLabel(latestSplit.eventId)}
                </Badge>
                <span className="font-mono text-lg font-bold">
                  {formatTime(latestSplit.igt)}
                </span>
              </div>
            )}

            {/* スプリット一覧（コンパクト） */}
            {run.eventList.length > 1 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {run.eventList
                  .slice(0, -1)
                  .map((event) => (
                    <span
                      key={event.eventId}
                      className="text-xs text-muted-foreground"
                    >
                      {getSplitLabel(event.eventId)}: {formatTime(event.igt)}
                    </span>
                  ))}
              </div>
            )}
          </div>

          {/* 右側: タイムスタンプ・リンク */}
          <div className="flex flex-col items-end gap-1 shrink-0">
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <Timer className="h-3 w-3" />
              {updatedAgo < 1 ? "今" : `${updatedAgo}分前`}
            </span>
            {run.user.liveAccount && (
              <a
                href={`https://twitch.tv/${run.user.liveAccount}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-primary hover:underline flex items-center gap-1"
              >
                <ExternalLink className="h-3 w-3" />
                配信を見る
              </a>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
