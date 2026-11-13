import { useRef, useState } from "react";
import { Link } from "react-router";
import {
  type PaceManLiveRun,
  getSplitTimeline,
  getSplitOrder,
  getLatestSplit,
} from "@/lib/paceman";
import { formatTime } from "@/lib/time-utils";
import { pickMcidDisplayName } from "@/lib/mcid-display-name";
import { useT, useLocale } from "@/hooks/use-locale";
import { ExternalLink } from "lucide-react";
import { MinecraftAvatar } from "@/components/minecraft-avatar";
import { Badge } from "@/components/ui/badge";
import { PaceManSplitMark } from "@/components/paceman-split-mark";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";

/**
 * 区間タイムの内訳。トリガーは実 button（キーボード/タッチで到達可能）。
 * マウス: ホバーで表示 / キーボード: フォーカスで表示 / タッチ: タップでトグル。
 * 区間名は同じ行のバッジ（PaceManSplitMark）・タイムラインモーダルと同じ英語の PaceMan 正規名を使う
 */
function SplitBreakdown({ run, igt }: { run: PaceManLiveRun; igt: number }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const hoverRef = useRef(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`${formatTime(igt)}: ${t("home.splitBreakdown")}`}
          className="cursor-pointer rounded font-mono font-semibold underline decoration-dotted underline-offset-4 decoration-muted-foreground/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onPointerEnter={(e) => {
            if (e.pointerType === "mouse") {
              hoverRef.current = true;
              setOpen(true);
            }
          }}
          onPointerLeave={(e) => {
            if (e.pointerType === "mouse") {
              hoverRef.current = false;
              setOpen(false);
            }
          }}
          onFocus={(e) => {
            if (e.currentTarget.matches(":focus-visible")) setOpen(true);
          }}
          onBlur={() => setOpen(false)}
          onClick={(e) => {
            // マウスはホバーで既に開いているため、クリックで閉じない（キーボードの click は detail=0）
            if (hoverRef.current && e.detail > 0) e.preventDefault();
          }}
        >
          {formatTime(igt)}
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="left"
        className="w-auto p-0"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <div className="px-3 py-2 space-y-1">
          {[...run.eventList]
            .sort((a, b) => getSplitOrder(a.eventId) - getSplitOrder(b.eventId))
            .map((event) => (
              <div key={event.eventId} className="flex items-center justify-between gap-4 text-xs">
                <span className="opacity-80">{getSplitTimeline(event.eventId)}</span>
                <span className="font-mono font-semibold">{formatTime(event.igt)}</span>
              </div>
            ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

interface LivePaceListProps {
  /** 登録（公開プロフィール）ユーザーのライブランのみ。mcidToSlug に無い走者はリンクなしの名前表示 */
  runs: PaceManLiveRun[];
  mcidToSlug: Record<string, string>;
  mcidToUuid: Record<string, string | null>;
  mcidToDisplayName: Record<string, string>;
  /** アルファベット表記の表示名（入力済みのユーザーのみ） */
  mcidToDisplayNameAlphabet?: Record<string, string>;
  mcidToSkinUrl?: Record<string, string>;
}

export function LivePaceList({ runs, mcidToSlug, mcidToUuid, mcidToDisplayName, mcidToDisplayNameAlphabet, mcidToSkinUrl }: LivePaceListProps) {
  const t = useT();
  const locale = useLocale();
  if (runs.length === 0) {
    return null;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <caption className="sr-only">{t("home.paceListCaption")}</caption>
        <thead>
          <tr className="border-b">
            <th className="text-left py-2 px-2 sm:px-3 font-medium">{t("home.paceListRunner")}</th>
            <th className="hidden sm:table-cell text-left py-2 px-3 font-medium">{t("home.paceListVersion")}</th>
            <th className="hidden sm:table-cell text-left py-2 px-3 font-medium">{t("home.paceListSplit")}</th>
            <th className="text-right py-2 px-2 sm:px-3 font-medium">{t("home.paceListTime")}</th>
            <th className="text-center py-2 px-2 sm:px-3 font-medium whitespace-nowrap">{t("home.paceListStream")}</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => {
            const latestSplit = getLatestSplit(run);
            const mcidLower = run.nickname.toLowerCase();
            const slug = mcidToSlug[mcidLower];
            const uuid = mcidToUuid[mcidLower];
            const skinUrl = mcidToSkinUrl?.[mcidLower];
            // 英語表示ではアルファベット表記を優先する
            const displayName = pickMcidDisplayName(
              { mcidToDisplayName, mcidToDisplayNameAlphabet },
              mcidLower,
              locale,
            );

            const splitBadge = latestSplit && (
              <Badge variant="secondary" className="rounded-full px-2.5 py-0.5 text-xs">
                <PaceManSplitMark timeline={getSplitTimeline(latestSplit.eventId)} size={13} />
              </Badge>
            );

            return (
              <tr key={run.worldId} className="border-b hover:bg-accent/50 transition-colors">
                <td className="py-2 px-2 sm:px-3 max-w-0 w-full sm:max-w-none sm:w-auto">
                  {slug ? (
                    <Link
                      to={`/player/${slug}`}
                      className="flex items-center gap-2 hover:opacity-80 transition-opacity"
                    >
                      {uuid && (
                        <MinecraftAvatar uuid={uuid} skinUrl={skinUrl} size={24} className="rounded shrink-0" />
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
                    <span className="font-medium block truncate">{run.nickname}</span>
                  )}
                  {splitBadge && <div className="mt-1 sm:hidden">{splitBadge}</div>}
                </td>
                <td className="hidden sm:table-cell py-2 px-3">
                  <Badge variant="outline" className="text-xs">
                    {run.gameVersion}
                  </Badge>
                </td>
                <td className="hidden sm:table-cell py-2 px-3">{splitBadge}</td>
                <td className="py-2 px-2 sm:px-3 text-right font-mono font-semibold">
                  {latestSplit ? (
                    run.eventList.length > 1 ? (
                      <SplitBreakdown run={run} igt={latestSplit.igt} />
                    ) : (
                      formatTime(latestSplit.igt)
                    )
                  ) : "-"}
                </td>
                <td className="py-2 px-2 sm:px-3 text-center">
                  {run.user.liveAccount ? (
                    <a
                      href={`https://twitch.tv/${run.user.liveAccount}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex min-h-8 min-w-8 items-center justify-center gap-1 rounded text-primary hover:underline text-xs sm:min-h-0 sm:min-w-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <ExternalLink className="h-3 w-3" />
                      <span className="sr-only sm:not-sr-only">{t("home.paceListStream")}</span>
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
