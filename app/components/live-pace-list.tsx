import { Link } from "react-router";
import {
  type PaceManLiveRun,
  getSplitLabelEnglish,
  getSplitOrder,
  getLatestSplit,
} from "@/lib/paceman";
import { formatTime } from "@/lib/time-utils";
import { ExternalLink } from "lucide-react";
import { MinecraftAvatar } from "@/components/minecraft-avatar";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";

interface LivePaceListProps {
  runs: PaceManLiveRun[];
  registeredMcidSet: Set<string>;
  mcidToSlug: Record<string, string>;
  mcidToUuid: Record<string, string | null>;
  mcidToDisplayName: Record<string, string>;
}

export function LivePaceList({ runs, registeredMcidSet, mcidToSlug, mcidToUuid, mcidToDisplayName }: LivePaceListProps) {
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
            <th className="text-center py-2 px-3 font-medium">配信</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => {
            const latestSplit = getLatestSplit(run);
            const mcidLower = run.nickname.toLowerCase();
            const isRegistered = registeredMcidSet.has(mcidLower);
            const slug = mcidToSlug[mcidLower];
            const uuid = mcidToUuid[mcidLower];
            const displayName = mcidToDisplayName[mcidLower];

            return (
              <tr key={run.worldId} className="border-b hover:bg-accent/50 transition-colors">
                <td className="py-2 px-3">
                  {isRegistered && slug ? (
                    <Link
                      to={`/player/${slug}`}
                      className="flex items-center gap-2 hover:opacity-80 transition-opacity"
                    >
                      {uuid && (
                        <MinecraftAvatar uuid={uuid} size={24} className="rounded shrink-0" />
                      )}
                      <div className="min-w-0">
                        <span className="font-medium block truncate">
                          {displayName || run.nickname}
                        </span>
                        {displayName && displayName !== run.nickname && (
                          <span className="text-xs text-muted-foreground">@{run.nickname}</span>
                        )}
                      </div>
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
                  {latestSplit ? (
                    run.eventList.length > 1 ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="cursor-default underline decoration-dotted underline-offset-4 decoration-muted-foreground/50">
                            {formatTime(latestSplit.igt)}
                          </span>
                        </TooltipTrigger>
                        <TooltipContent side="left" className="p-0">
                          <div className="px-3 py-2 space-y-1">
                            {[...run.eventList]
                              .sort((a, b) => getSplitOrder(a.eventId) - getSplitOrder(b.eventId))
                              .map((event) => (
                                <div key={event.eventId} className="flex items-center justify-between gap-4 text-xs">
                                  <span className="opacity-80">{getSplitLabelEnglish(event.eventId)}</span>
                                  <span className="font-mono font-semibold">{formatTime(event.igt)}</span>
                                </div>
                              ))}
                          </div>
                        </TooltipContent>
                      </Tooltip>
                    ) : (
                      formatTime(latestSplit.igt)
                    )
                  ) : "-"}
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
