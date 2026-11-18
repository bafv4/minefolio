import { Link } from "react-router";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { useT } from "@/hooks/use-locale";
import { formatRelativeTimeInMinutes } from "@/lib/relative-time";
import { Badge } from "@/components/ui/badge";
import { MinecraftAvatar } from "@/components/minecraft-avatar";
import { PaceManSplitMark } from "@/components/paceman-split-mark";
import { StageBar } from "@/components/pace-stage-bar";
import { formatClock } from "@/lib/home-format";
import { splitStage } from "@/lib/home-live";
// type-only import はトランスパイル時に消去されるため、サーバー専用モジュールでも安全
import type { CachedPace } from "@/lib/paceman-cache";
import { PaceTimelineModal } from "@/components/pace-timeline-modal";
import { Clock3 } from "lucide-react";

// フィード表示に必要な最小限のペース情報（CachedPaceのサブセット）
export type PaceFeedRun = Pick<
  CachedPace,
  "mcid" | "nickname" | "timeline" | "rta" | "time" | "pacemanRunId"
>;

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
  const [isModalOpen, setIsModalOpen] = useState(false);

  return (
    <div
      className={cn(
        "group relative block rounded-xl border border-border/70 bg-background/80 p-4 transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md"
      )}
    >
      {/* カード全体のクリックでタイムラインモーダルを開く。
          アバター/名前リンク（z-10）が同じ位置にある部分はそちらが優先される。
          タブ停止はこのボタンと名前リンクの2つだけ（アバターは名前リンクと同じ遷移先のため除外） */}
      <button
        type="button"
        onClick={() => setIsModalOpen(true)}
        className="absolute inset-0 z-0 rounded-xl cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={`${displayName || run.nickname || run.mcid}: ${t("home.viewTimeline")}`}
      />
      <div className="flex items-center gap-3">
        <Link
          to={`/player/${run.mcid}`}
          prefetch="intent"
          tabIndex={-1}
          aria-hidden="true"
          className="relative z-10 shrink-0"
        >
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

      {/* 区間進行バー（ライブ欄カードと同じ。区間名は下のバッジのテキストで出る） */}
      <div className="mt-3">
        <StageBar stage={splitStage(run.timeline)} finished={run.timeline === "Finish"} />
      </div>

      <div className="mt-3">
        {/* 狭幅でも折り返しで崩れないよう flex-wrap + gap-x/gap-y に。バッジは
            ml-auto shrink-0 で折り返し後も行内右端に揃える */}
        <div className="flex flex-wrap items-end gap-x-3 gap-y-1.5">
          <div className="min-w-0">
            <p className="text-[11px] text-muted-foreground">{t("home.igtTime")}</p>
            <p className="font-mono text-2xl font-semibold">{formatClock(run.rta)}</p>
          </div>
          <Badge variant="secondary" className="ml-auto shrink-0 rounded-full px-2.5 py-0.5 text-xs">
            <PaceManSplitMark timeline={run.timeline} size={13} />
          </Badge>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-border/60 pt-3 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <Clock3 className="h-3 w-3" />
            {/* SSR時とhydration時で相対時刻の境界をまたいでも警告にならないようにする */}
            <span suppressHydrationWarning>{formatRelativeTimeInMinutes(t, new Date(run.time * 1000))}</span>
          </span>
        </div>
      </div>

      <PaceTimelineModal
        open={isModalOpen}
        onOpenChange={setIsModalOpen}
        mcid={run.mcid}
        runId={run.pacemanRunId}
        title={displayName || run.nickname || run.mcid}
      />
    </div>
  );
}
