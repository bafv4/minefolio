import { useEffect, useState, type ReactNode } from "react";
import { Gauge, Search, Timer, Trophy } from "lucide-react";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { useLocale, useT } from "@/hooks/use-locale";
import { fetchMCSRRankedStatsCached } from "@/lib/ranked-stats-cache";
import { fetchSpeedrunComStatsCached } from "@/lib/speedruncom-stats-cache";
import type { SpeedrunComPersonalBest } from "@/lib/external-stats";
import { calculateCm360, isValidSensitivity, toSensitivityPercent } from "@/lib/mouse-settings";
import { getGameLanguageName } from "@/lib/game-languages";
import { hidesSearchCraft, isCategoryKey } from "@/lib/playstyle";
import { pickHighlightPb, pickHighlightSpeedrunComPb, type HighlightPbRecord } from "@/lib/profile-highlights";
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

/** speedrun.com の PB 一覧（取得中は undefined、失敗・未設定は空配列） */
function useSpeedrunComPbs(username: string | null, enabled: boolean) {
  const [pbs, setPbs] = useState<SpeedrunComPersonalBest[] | undefined>(
    enabled && username ? undefined : [],
  );
  useEffect(() => {
    if (!enabled || !username) {
      setPbs([]);
      return;
    }
    let cancelled = false;
    setPbs(undefined);
    fetchSpeedrunComStatsCached(username)
      .then((r) => (r.error ? [] : r.personalBests))
      .catch(() => [] as SpeedrunComPersonalBest[])
      .then((value) => {
        if (!cancelled) setPbs(value);
      });
    return () => {
      cancelled = true;
    };
  }, [username, enabled]);
  return pbs;
}

/** 高さを固定してスケルトンと本体を揃える（読み込み完了で下のホットバーが跳ねない） */
const TILE_HEIGHT_CLASS = "h-[58px]";

function TileSkeleton() {
  return <Skeleton className={cn(TILE_HEIGHT_CLASS, "rounded-xl")} />;
}

/** 名前は見えているラベル＋値になる（aria-label で上書きしない） */
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
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        TILE_HEIGHT_CLASS,
        "flex min-w-0 items-center gap-3 rounded-xl border border-border/70 bg-background/80 px-3.5 py-2.5 text-left transition-colors hover:border-primary/40 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
      )}
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
  /** PB の選択に使う（メインカテゴリ自体はタイルにしない） */
  mainCategory: string | null | undefined;
  records: readonly (HighlightPbRecord & { id: string })[];
  config: {
    mouseDpi: number | null;
    gameSensitivity: number | null;
    rawInput: boolean | null;
    windowsSpeed: number | null;
    windowsSpeedMultiplier: number | null;
  } | null;
  /** speedrun.com のユーザー名。手入力の PB が無いときだけ PB を取得して代わりに出す */
  speedruncomUsername: string | null;
  /** サーチクラフト（playstyle.searchCraft の回答 / 登録済みサーチクラフト数 / ゲーム言語） */
  searchCraftLevel: string | null | undefined;
  searchCraftCount: number;
  gameLanguage: string | null | undefined;
  hiddenSpeedrunRecords: readonly string[];
  pinnedSpeedrunRecords: readonly string[];
  /** 該当タブへ切り替える（プロフィールページの handleTabChange） */
  onSelectTab: (tab: string) => void;
}

/** 身元帯の要点行（PB・Elo・感度・サーチクラフトの最大 4 タイル）。データがある項目だけ出し、全部無ければ行ごと出さない */
export function ProfileHighlights({
  mcid,
  showRankedStats,
  mainCategory,
  records,
  config,
  speedruncomUsername,
  searchCraftLevel,
  searchCraftCount,
  gameLanguage,
  hiddenSpeedrunRecords,
  pinnedSpeedrunRecords,
  onSelectTab,
}: ProfileHighlightsProps) {
  const t = useT();
  const locale = useLocale();
  const elo = useRankedElo(mcid, showRankedStats && !!mcid);

  const categoryKey = isCategoryKey(mainCategory) ? mainCategory : null;
  const pb = pickHighlightPb(categoryKey, records, true);
  const srcPbs = useSpeedrunComPbs(speedruncomUsername, !pb && !!speedruncomUsername);
  const srcPbLoading = !pb && !!speedruncomUsername && srcPbs === undefined;
  const srcPb = pb
    ? null
    : pickHighlightSpeedrunComPb(categoryKey, srcPbs ?? [], hiddenSpeedrunRecords, pinnedSpeedrunRecords);
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

  // 登録件数が 1 件以上で、サーチクラフトタブが表示される（does_not 以外）ときだけ出す
  const showSearchCraft = !hidesSearchCraft(searchCraftLevel) && searchCraftCount > 0;
  const searchCraftValue = gameLanguage
    ? t("playerProfile.highlightSearchCraftWithLanguage", {
        count: searchCraftCount,
        language: getGameLanguageName(t, locale, gameLanguage),
      })
    : t("playerProfile.highlightSearchCraftCountOnly", { count: searchCraftCount });

  const eloLoading = elo === undefined;
  const hidden =
    !pb && !srcPb && !srcPbLoading && sensitivityPercent == null && !showSearchCraft && !eloLoading && elo == null;
  if (hidden) return null;

  return (
    // 静止表示のグリッド（デスクトップ 1 行 4 列、モバイル 2 列）
    <div className="grid grid-cols-2 gap-2 sm:gap-3 md:grid-cols-4">
      {pb && (
        <HighlightTile
          icon={<Timer className="h-4 w-4" />}
          label={`${pb.record.categoryDisplayName} ${t("playerProfile.pb")}`}
          onClick={() => onSelectTab("stats")}
        >
          <span className="font-mono">{formatTime(pb.record.personalBest as number)}</span>
        </HighlightTile>
      )}
      {!pb &&
        (srcPbLoading ? (
          <TileSkeleton />
        ) : srcPb ? (
          <HighlightTile
            icon={<Timer className="h-4 w-4" />}
            label={`${srcPb.category?.data?.name ?? t("common.unknown")} ${t("playerProfile.pb")}`}
            onClick={() => onSelectTab("stats")}
          >
            {/* speedrun.com は秒、formatTime はミリ秒（player-stats-cards.tsx と同じ） */}
            <span className="font-mono">{formatTime(srcPb.run.times.primary_t * 1000)}</span>
          </HighlightTile>
        ) : null)}
      {eloLoading ? (
        <TileSkeleton />
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
              {/* calculateCm360 は名前に反して半回転（180°）の距離を返す（計算式の末尾で /2） */}
              {cm360.toFixed(1)} cm/180°
            </span>
          )}
        </HighlightTile>
      )}
      {showSearchCraft && (
        <HighlightTile
          icon={<Search className="h-4 w-4" />}
          label={t("playerProfile.searchCraftTab")}
          onClick={() => onSelectTab("searchcraft")}
        >
          {searchCraftValue}
        </HighlightTile>
      )}
    </div>
  );
}
