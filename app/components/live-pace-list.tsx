import { Link } from "react-router";
import {
  type PaceManLiveRun,
  getSplitLabelEnglish,
  getLatestSplit,
} from "@/lib/paceman";
import { formatTime } from "@/lib/time-utils";
import { ExternalLink } from "lucide-react";

interface LivePaceListProps {
  runs: PaceManLiveRun[];
  registeredMcidSet: Set<string>;
  mcidToSlug: Record<string, string>;
}

export function LivePaceList({ runs, registeredMcidSet, mcidToSlug }: LivePaceListProps) {
  if (runs.length === 0) {
    return null;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b">
            <th className="text-left py-2 px-3 font-medium">プレイヤー</th>
            <th className="text-left py-2 px-3 font-medium">バージョン</th>
            <th className="text-left py-2 px-3 font-medium">最新区間</th>
            <th className="text-right py-2 px-3 font-medium">タイム</th>
            <th className="text-left py-2 px-3 font-medium">スプリット</th>
            <th className="text-center py-2 px-3 font-medium">配信</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => {
            const latestSplit = getLatestSplit(run);
            const isRegistered = registeredMcidSet.has(run.nickname.toLowerCase());
            const slug = mcidToSlug[run.nickname.toLowerCase()];

            return (
              <tr key={run.worldId} className="border-b hover:bg-accent/50 transition-colors">
                <td className="py-2 px-3">
                  {isRegistered && slug ? (
                    <Link
                      to={`/player/${slug}`}
                      className="text-primary hover:underline font-medium"
                    >
                      {run.nickname}
                    </Link>
                  ) : (
                    <span className="font-medium">{run.nickname}</span>
                  )}
                </td>
                <td className="py-2 px-3">
                  <span className="text-xs bg-secondary px-2 py-0.5 rounded">
                    {run.gameVersion}
                  </span>
                </td>
                <td className="py-2 px-3">
                  {latestSplit && (
                    <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded">
                      {getSplitLabelEnglish(latestSplit.eventId)}
                    </span>
                  )}
                </td>
                <td className="py-2 px-3 text-right font-mono font-semibold">
                  {latestSplit ? formatTime(latestSplit.igt) : "-"}
                </td>
                <td className="py-2 px-3">
                  <div className="flex flex-wrap gap-1 text-xs text-muted-foreground">
                    {run.eventList.slice(0, -1).map((event) => (
                      <span key={event.eventId}>
                        {getSplitLabelEnglish(event.eventId)}: {formatTime(event.igt)}
                      </span>
                    ))}
                  </div>
                </td>
                <td className="py-2 px-3 text-center">
                  {run.user.liveAccount ? (
                    <a
                      href={`https://twitch.tv/${run.user.liveAccount}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-primary hover:underline text-xs"
                    >
                      <ExternalLink className="h-3 w-3" />
                      配信
                    </a>
                  ) : (
                    <span className="text-muted-foreground text-xs">-</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
