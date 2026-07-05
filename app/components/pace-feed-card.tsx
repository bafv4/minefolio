import { Link } from "react-router";
import { cn } from "@/lib/utils";
import { t } from "@/lib/messages";
import { Badge } from "@/components/ui/badge";
import { MinecraftAvatar } from "@/components/minecraft-avatar";
import { PaceManSplitMark } from "@/components/paceman-split-mark";
import { type CachedPace } from "@/components/recent-pace-card";
import { Clock3, ExternalLink } from "lucide-react";

// フィード表示に必要な最小限のペース情報（CachedPaceのサブセット）
export type PaceFeedRun = Pick<
  CachedPace,
  "mcid" | "nickname" | "timeline" | "rta" | "time" | "pacemanRunId"
>;

// ミリ秒を "m:ss" 形式に変換
function formatRunTime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

// Unix秒からの相対時間を表示
function formatRelativeUnixTime(unixSeconds: number): string {
  const now = Date.now();
  const diffMs = now - unixSeconds * 1000;
  const diffMinutes = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMinutes / 60);

  if (diffMinutes < 1) return t("playerStats.justNow");
  if (diffMinutes < 60) return t("playerStats.minutesAgo", { count: diffMinutes });
  if (diffHours < 24) return t("playerStats.hoursAgo", { count: diffHours });
  return t("playerStats.daysAgo", { count: Math.floor(diffHours / 24) });
}

export function PaceFeedCard({
  run,
  uuid,
  displayName,
  skinUrl,
}: {
  run: PaceFeedRun;
  uuid?: string;
  displayName?: string;
  skinUrl?: string;
}) {
  const isFinished = run.timeline === "Finish";
  const paceManUrl = `https://paceman.gg/stats/run/${run.pacemanRunId}`;

  return (
    <div
      className={cn(
        "group relative block rounded-2xl border border-border/70 bg-background/80 p-4 transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-sm",
        isFinished && "border-cyan-400/60 bg-cyan-500/5"
      )}
    >
      <a
        href={paceManUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="absolute inset-0 z-0 rounded-2xl"
        aria-label={`PaceMan: ${run.nickname || run.mcid}`}
      />
      <div className="flex items-center gap-3">
        <Link to={`/player/${run.mcid}`} prefetch="intent" className="relative z-10 shrink-0">
          {uuid ? (
            <div className="h-11 w-11 rounded-xl transition-opacity hover:opacity-80">
              <MinecraftAvatar uuid={uuid} skinUrl={skinUrl} size={44} />
            </div>
          ) : (
            <div className="h-11 w-11 rounded-xl bg-muted transition-opacity hover:opacity-80" />
          )}
        </Link>
        <Link to={`/player/${run.mcid}`} prefetch="intent" className="relative z-10 min-w-0 flex-1">
          <p className="truncate text-sm font-semibold hover:text-primary transition-colors">
            {displayName || run.nickname || run.mcid}
          </p>
          <p className="truncate text-xs text-muted-foreground hover:text-primary transition-colors">
            @{run.mcid}
          </p>
        </Link>
      </div>

      <div className="mt-3">
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="text-[11px] text-muted-foreground">{t("home.rtaTime")}</p>
            <p className="font-mono text-2xl font-semibold">{formatRunTime(run.rta)}</p>
          </div>
          <Badge variant="secondary" className="rounded-full px-2.5 py-0.5 text-xs">
            <PaceManSplitMark timeline={run.timeline} size={13} />
          </Badge>
        </div>

        <div className="mt-3 flex items-center justify-between border-t border-border/60 pt-3 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <Clock3 className="h-3 w-3" />
            {/* SSR時とhydration時で相対時刻の境界をまたいでも警告にならないようにする */}
            <span suppressHydrationWarning>{formatRelativeUnixTime(run.time)}</span>
          </span>
          <span className="inline-flex items-center gap-1">
            PaceMan
            <ExternalLink className="h-3 w-3" />
          </span>
        </div>
      </div>
    </div>
  );
}
