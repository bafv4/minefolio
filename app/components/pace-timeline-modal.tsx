import { useEffect, useState } from "react";
import { Link } from "react-router";
import { cn } from "@/lib/utils";
import { useT } from "@/hooks/use-locale";
import { formatClock } from "@/lib/home-format";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { PaceManSplitMark } from "@/components/paceman-split-mark";
// type-only import はトランスパイル時に消去されるため、サーバー専用モジュールでも安全
import type { PaceTimelineEntry } from "@/lib/paceman-cache";
import { ArrowRight, ExternalLink, Loader2 } from "lucide-react";

interface PaceTimelineResponse {
  timeline: PaceTimelineEntry[];
}

/** PaceMan ランの全スプリット一覧モーダル（ペースカード・お気に入りの動きで共用） */
export function PaceTimelineModal({
  open,
  onOpenChange,
  mcid,
  runId,
  title,
  profileHref,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mcid: string;
  /** PaceMan のラン ID */
  runId: number;
  title: string;
  /** 走者のプロフィールの URL。渡されたときだけモーダル内にリンクを出す */
  profileHref?: string;
}) {
  const t = useT();
  const paceManUrl = `https://paceman.gg/stats/run/${runId}`;
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
    fetch(`/api/home-feed?type=pace-timeline&mcid=${encodeURIComponent(mcid)}&runId=${runId}`)
      .then((res) => {
        // HTTP エラーを「タイムラインなし」と取り違えない（catch でエラー表示にする）
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<PaceTimelineResponse>;
      })
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
  }, [open, mcid, runId]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
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
                      <span className="font-mono text-sm font-semibold">{formatClock(entry.rta)}</span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}

        {profileHref && (
          <Link
            to={profileHref}
            prefetch="intent"
            className="flex items-center justify-center gap-1.5 rounded-lg border border-border/70 py-2 text-sm text-primary hover:bg-secondary/50 transition-colors"
          >
            {t("playerProfile.viewProfile")}
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        )}
        <a
          href={paceManUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center gap-1.5 rounded-lg border border-border/70 py-2 text-sm text-primary hover:bg-secondary/50 transition-colors"
        >
          {t("home.viewOnPaceMan", { site: "PaceMan.gg" })}
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      </DialogContent>
    </Dialog>
  );
}
