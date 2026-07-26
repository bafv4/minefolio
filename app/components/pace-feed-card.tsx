import { Link } from "react-router";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { useT } from "@/hooks/use-locale";
import type { Translator } from "@/lib/messages";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { MinecraftAvatar } from "@/components/minecraft-avatar";
import { PaceManSplitMark } from "@/components/paceman-split-mark";
import { type CachedPace } from "@/components/recent-pace-card";
// type-only import はトランスパイル時に消去されるため、サーバー専用モジュールでも安全
import type { PaceTimelineEntry } from "@/lib/paceman-cache";
import { Clock3, ExternalLink, Loader2 } from "lucide-react";

// フィード表示に必要な最小限のペース情報（CachedPaceのサブセット）
export type PaceFeedRun = Pick<
  CachedPace,
  "mcid" | "nickname" | "timeline" | "rta" | "time" | "pacemanRunId"
>;

interface PaceTimelineResponse {
  timeline: PaceTimelineEntry[];
}

// ミリ秒を "m:ss" 形式に変換
function formatRunTime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

// Unix秒からの相対時間を表示（モジュール関数のためフックを使えず、t を受け取る）
function formatRelativeUnixTime(t: Translator, unixSeconds: number): string {
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
  const t = useT();
  const isFinished = run.timeline === "Finish";
  const paceManUrl = `https://paceman.gg/stats/run/${run.pacemanRunId}`;
  const [isModalOpen, setIsModalOpen] = useState(false);

  return (
    <div
      className={cn(
        "group relative block rounded-2xl border border-border/70 bg-background/80 p-4 transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-sm",
        isFinished && "border-cyan-400/60 bg-cyan-500/5"
      )}
    >
      {/* カード全体のクリックでタイムラインモーダルを開く。
          アバター/名前リンク（z-10）が同じ位置にある部分はそちらが優先される */}
      <button
        type="button"
        onClick={() => setIsModalOpen(true)}
        className="absolute inset-0 z-0 rounded-2xl cursor-pointer"
        aria-label={`${displayName || run.nickname || run.mcid}: ${t("home.viewTimeline")}`}
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

        <div className="mt-3 flex items-center border-t border-border/60 pt-3 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <Clock3 className="h-3 w-3" />
            {/* SSR時とhydration時で相対時刻の境界をまたいでも警告にならないようにする */}
            <span suppressHydrationWarning>{formatRelativeUnixTime(t, run.time)}</span>
          </span>
        </div>
      </div>

      <PaceTimelineModal
        open={isModalOpen}
        onOpenChange={setIsModalOpen}
        run={run}
        displayName={displayName}
        paceManUrl={paceManUrl}
      />
    </div>
  );
}

function PaceTimelineModal({
  open,
  onOpenChange,
  run,
  displayName,
  paceManUrl,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  run: PaceFeedRun;
  displayName?: string;
  paceManUrl: string;
}) {
  const t = useT();
  const [state, setState] = useState<{
    status: "idle" | "loading" | "done" | "error";
    entries: PaceTimelineEntry[];
  }>({ status: "idle", entries: [] });

  useEffect(() => {
    // state.status を依存に含めると、setState(loading) 自体が再実行の
    // トリガーとなり、直前のfetchを即キャンセルしてしまう（キャンセル判定が
    // 古いクロージャの cancelled を見るため、結果が反映されなくなる）。
    // open の立ち上がりだけをトリガーにする（idle判定は行わない）
    if (!open) return;

    let cancelled = false;
    setState({ status: "loading", entries: [] });
    fetch(`/api/home-feed?type=pace-timeline&mcid=${encodeURIComponent(run.mcid)}&runId=${run.pacemanRunId}`)
      .then((res) => res.json() as Promise<PaceTimelineResponse>)
      .then((data) => {
        if (cancelled) return;
        setState({ status: "done", entries: data.timeline || [] });
      })
      .catch((err) => {
        console.error("Failed to fetch pace timeline:", err);
        if (cancelled) return;
        setState({ status: "error", entries: [] });
      });

    return () => {
      cancelled = true;
    };
  }, [open, run.mcid, run.pacemanRunId]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{displayName || run.nickname || run.mcid}</DialogTitle>
          <DialogDescription>{t("home.timelineDescription")}</DialogDescription>
        </DialogHeader>

        {state.status === "loading" && (
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        )}

        {state.status === "error" && (
          <p className="py-4 text-center text-sm text-muted-foreground">{t("home.timelineError")}</p>
        )}

        {state.status === "done" && (
          <div>
            {state.entries.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">{t("home.timelineEmpty")}</p>
            ) : (
              state.entries.map((entry, index) => {
                const isLast = index === state.entries.length - 1;
                return (
                  <div key={entry.timeline} className="flex gap-3">
                    {/* アイコン列: 丸アイコンを縦線でつなぐ */}
                    <div className="flex flex-col items-center">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border/70 bg-secondary">
                        <PaceManSplitMark timeline={entry.timeline} withLabel={false} size={16} />
                      </div>
                      {!isLast && <div className="w-px flex-1 bg-border" />}
                    </div>
                    {/* 区間名 + タイム */}
                    <div
                      className={cn(
                        "flex flex-1 items-center justify-between",
                        isLast ? "pb-1" : "pb-4"
                      )}
                    >
                      <span className="text-sm font-medium">{entry.timeline}</span>
                      <span className="font-mono text-sm font-semibold">{formatRunTime(entry.rta)}</span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}

        <a
          href={paceManUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center gap-1.5 rounded-lg border border-border/70 py-2 text-sm text-primary hover:bg-secondary/50 transition-colors"
        >
          PaceMan.gg {t("home.viewOnPaceMan")}
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      </DialogContent>
    </Dialog>
  );
}
