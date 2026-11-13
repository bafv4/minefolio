import { useEffect, useState, type ReactNode } from "react";
import { Gamepad2, Gauge, Timer, Trophy } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useT } from "@/hooks/use-locale";
import { fetchMCSRRankedStatsCached } from "@/lib/ranked-stats-cache";
import { calculateCm360, isValidSensitivity, toSensitivityPercent } from "@/lib/mouse-settings";
import { categoryLabel, isCategoryKey } from "@/lib/playstyle";
import { pickHighlightPb, type HighlightPbRecord } from "@/lib/profile-highlights";
import { formatTime } from "@/lib/time-utils";

function useRankedElo(mcid: string | null, enabled: boolean) {
  const [elo, setElo] = useState<number | null | undefined>(enabled && mcid ? undefined : null);
  useEffect(() => {
    if (!enabled || !mcid) {
      setElo(null);
      return;
    }
    let cancelled = false;
    setElo(undefined);
    fetchMCSRRankedStatsCached(mcid)
      .then((r) => (r.isRegistered ? (r.user?.eloRate ?? null) : null))
      .catch(() => null)
      .then((value) => {
        if (!cancelled) setElo(value);
      });
    return () => {
      cancelled = true;
    };
  }, [mcid, enabled]);
  // undefined = 取得中
  return elo;
}

function HighlightTile({
  icon,
  label,
  onClick,
  children,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  const t = useT();
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={t("playerProfile.highlightGoToTab", { label })}
      className="flex min-w-0 items-center gap-3 rounded-xl border border-border/70 bg-background/80 px-3.5 py-2.5 text-left transition-colors hover:border-primary/40 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="hidden shrink-0 rounded-lg bg-primary/10 p-1.5 text-primary sm:block" aria-hidden>
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-xs text-muted-foreground">{label}</span>
        <span className="block truncate font-semibold">{children}</span>
      </span>
    </button>
  );
}

export interface ProfileHighlightsProps {
  mcid: string | null;
  showRankedStats: boolean;
  mainCategory: string | null | undefined;
  records: readonly (HighlightPbRecord & { id: string })[];
  config: {
    mouseDpi: number | null;
    gameSensitivity: number | null;
    rawInput: boolean | null;
    windowsSpeed: number | null;
    windowsSpeedMultiplier: number | null;
  } | null;
  /** 該当タブへ切り替える（プロフィールページの handleTabChange） */
  onSelectTab: (tab: string) => void;
}

/** 既定タブ上部のハイライト行。データがある項目だけ出し、全部無ければ行ごと出さない */
export function ProfileHighlights({
  mcid,
  showRankedStats,
  mainCategory,
  records,
  config,
  onSelectTab,
}: ProfileHighlightsProps) {
  const t = useT();
  const elo = useRankedElo(mcid, showRankedStats && !!mcid);

  const categoryKey = isCategoryKey(mainCategory) ? mainCategory : null;
  const pb = pickHighlightPb(categoryKey, records, true);
  const sensitivityPercent =
    config && isValidSensitivity(config.gameSensitivity)
      ? toSensitivityPercent(config.gameSensitivity)
      : null;
  const cm360 = config
    ? calculateCm360(
        config.mouseDpi,
        config.gameSensitivity,
        config.rawInput,
        config.windowsSpeed,
        config.windowsSpeedMultiplier,
      )
    : null;

  const eloLoading = elo === undefined;
  if (!categoryKey && !pb && sensitivityPercent == null && !eloLoading && elo == null) return null;

  return (
    <div className="grid grid-cols-2 gap-2 sm:gap-3 xl:grid-cols-4">
      {categoryKey && (
        <HighlightTile
          icon={<Gamepad2 className="h-4 w-4" />}
          label={t("playerProfile.highlightMainCategory")}
          onClick={() => onSelectTab("playstyle")}
        >
          {categoryLabel(t, categoryKey)}
        </HighlightTile>
      )}
      {pb && (
        <HighlightTile
          icon={<Timer className="h-4 w-4" />}
          label={`${pb.record.categoryDisplayName} ${t("playerProfile.pb")}`}
          onClick={() => onSelectTab("stats")}
        >
          <span className="font-mono">{formatTime(pb.record.personalBest as number)}</span>
        </HighlightTile>
      )}
      {eloLoading ? (
        // 取得中は高さを確保（取得後に項目ごと消えてもレイアウトが跳ねないよう、タイル同寸）
        <Skeleton className="h-[58px] rounded-xl" />
      ) : elo != null ? (
        <HighlightTile
          icon={<Trophy className="h-4 w-4" />}
          label={t("playerProfile.highlightElo")}
          onClick={() => onSelectTab("stats")}
        >
          <span className="font-mono">{Math.round(elo)}</span>
        </HighlightTile>
      ) : null}
      {sensitivityPercent != null && (
        <HighlightTile
          icon={<Gauge className="h-4 w-4" />}
          label={t("playerProfile.highlightSensitivity")}
          onClick={() => onSelectTab("devices")}
        >
          <span className="font-mono">{sensitivityPercent}%</span>
          {cm360 != null && (
            <span className="ml-1.5 text-xs font-normal text-muted-foreground">
              {cm360.toFixed(1)} cm/360
            </span>
          )}
        </HighlightTile>
      )}
    </div>
  );
}
