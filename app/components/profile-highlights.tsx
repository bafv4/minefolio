import { useEffect, useState, type ReactNode } from "react";
import { Gauge, Search, Timer, Trophy } from "lucide-react";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { HorizontalScrollArea } from "@/components/horizontal-scroll-area";
import { useLocale, useT } from "@/hooks/use-locale";
import { fetchMCSRRankedStatsCached, subscribeMCSRRankedStats } from "@/lib/ranked-stats-cache";
import { fetchSpeedrunComStatsCached, subscribeSpeedrunComStats } from "@/lib/speedruncom-stats-cache";
import type { MCSRRankedStats, SpeedrunComPersonalBest } from "@/lib/external-stats";
import { calculateCm360, isValidSensitivity, toSensitivityPercent } from "@/lib/mouse-settings";
import { getGameLanguageName } from "@/lib/game-languages";
import { hidesSearchCraft, isCategoryKey } from "@/lib/playstyle";
import {
  pickRepresentativePb,
  rankedBestTimeMs,
  speedrunComPbDisplayName,
  statsSrcCardId,
  visibleSpeedrunComPbs,
  type HighlightPbRecord,
} from "@/lib/profile-highlights";
import { formatTime } from "@/lib/time-utils";

type RankedHighlight = { elo: number | null; bestMs: number | null; failed: boolean };
const RANKED_NONE: RankedHighlight = { elo: null, bestMs: null, failed: false };

/**
 * 記録タブの該当カードへ移る（タブ切替の直後は欄がまだ描かれていない・外部統計の取得待ちなことがあるので、
 * 現れるまで少し待つ）。スクロール位置は :root の scroll-padding（追従ホットバーの分）が決める。
 * フォーカスもカードへ移す（タブを切り替えて元のタイルが画面から外れるため、キーボード操作で迷子にしない）
 */
function goToStatsCard(id: string) {
  const startedAt = Date.now();
  const tick = () => {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ block: "start" });
      el.focus({ preventScroll: true });
      return;
    }
    if (Date.now() - startedAt < 5000) window.setTimeout(tick, 100);
  };
  tick();
}

/** MCSR Ranked の Elo と代表記録（ms）。取得中は undefined、未登録・非表示は両方 null（failed=false）、取得失敗は failed=true */
function useRankedHighlight(mcid: string | null, enabled: boolean) {
  const [ranked, setRanked] = useState<RankedHighlight | undefined>(
    enabled && mcid ? undefined : RANKED_NONE,
  );
  useEffect(() => {
    if (!enabled || !mcid) {
      setRanked(RANKED_NONE);
      return;
    }
    let cancelled = false;
    setRanked(undefined);
    const toHighlight = (r: MCSRRankedStats): RankedHighlight => ({
      elo: r.isRegistered ? (r.user?.eloRate ?? null) : null,
      bestMs: rankedBestTimeMs(r),
      failed: !!r.error,
    });
    // 記録タブの「再試行」で取り直した成功結果も受け取る（初回の失敗のまま残さない）
    const unsubscribe = subscribeMCSRRankedStats(mcid, (r) => {
      if (!cancelled) setRanked(toHighlight(r));
    });
    fetchMCSRRankedStatsCached(mcid)
      .then(toHighlight)
      .catch((): RankedHighlight => ({ elo: null, bestMs: null, failed: true }))
      .then((value) => {
        if (!cancelled) setRanked(value);
      });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [mcid, enabled]);
  return ranked;
}

/** speedrun.com の PB 一覧（取得中は undefined、未設定・未登録は空配列、取得失敗は failed=true で空配列） */
type SrcHighlight = { pbs: SpeedrunComPersonalBest[]; failed: boolean };
const SRC_NONE: SrcHighlight = { pbs: [], failed: false };

function useSpeedrunComPbs(username: string | null) {
  const [pbs, setPbs] = useState<SrcHighlight | undefined>(username ? undefined : SRC_NONE);
  useEffect(() => {
    if (!username) {
      setPbs(SRC_NONE);
      return;
    }
    let cancelled = false;
    setPbs(undefined);
    // 記録タブの「再試行」で取り直した成功結果も受け取る（初回の失敗のまま残さない）
    const unsubscribe = subscribeSpeedrunComStats(username, (r) => {
      if (!cancelled) setPbs({ pbs: r.personalBests, failed: false });
    });
    fetchSpeedrunComStatsCached(username)
      .then((r): SrcHighlight => (r.error ? { pbs: [], failed: true } : { pbs: r.personalBests, failed: false }))
      .catch((): SrcHighlight => ({ pbs: [], failed: true }))
      .then((value) => {
        if (!cancelled) setPbs(value);
      });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [username]);
  return pbs;
}

/** 高さを固定してスケルトンと本体を揃える（読み込み完了で下のホットバーが跳ねない） */
const TILE_HEIGHT_CLASS = "h-[58px]";
/** タイル（読み込み中・本体）の外枠。md 未満で縮めない指定（max-md:shrink-0 / w-40）は各側に足す */
const TILE_SHELL_CLASS =
  "flex min-w-0 items-center gap-3 rounded-xl border border-border/70 bg-background/80 px-3.5 py-2.5";

function TileSkeleton() {
  return <Skeleton className={cn(TILE_HEIGHT_CLASS, "rounded-xl max-md:w-40 max-md:shrink-0")} />;
}

/** ラベルが取得前から決まっているタイルの読み込み中表示（ラベルとアイコンは出し、値だけスケルトンにする。SSR でも同じ） */
function LoadingHighlightTile({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <div
      aria-busy="true"
      className={cn(TILE_HEIGHT_CLASS, TILE_SHELL_CLASS, "max-md:w-40 max-md:shrink-0")}
    >
      <span className="hidden shrink-0 rounded-lg bg-primary/10 p-1.5 text-primary sm:block" aria-hidden>
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-xs text-muted-foreground">{label}</span>
        <Skeleton className="mt-1 h-4 w-16" />
      </span>
    </div>
  );
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
        TILE_SHELL_CLASS,
        "max-md:shrink-0 text-left transition-colors hover:border-primary/40 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
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
  const ranked = useRankedHighlight(mcid, showRankedStats && !!mcid);
  const elo = ranked?.elo;

  const categoryKey = isCategoryKey(mainCategory) ? mainCategory : null;
  // 代表 PB の優先順は pickRepresentativePb（ピン留め → メインカテゴリ → 公式カテゴリ → カスタム記録）。
  // speedrun.com（と、メインカテゴリが Ranked のときは Ranked）が手入力記録より優先されるので、取得が終わるまで決められない
  const src = useSpeedrunComPbs(speedruncomUsername);
  const pbLoading = (!!speedruncomUsername && src === undefined) || (categoryKey === "ranked" && ranked === undefined);
  const representative = pbLoading
    ? null
    : pickRepresentativePb({
        mainCategory: categoryKey,
        records,
        speedrunComPbs: src?.pbs ?? [],
        hiddenRunIds: hiddenSpeedrunRecords,
        pinnedRunIds: pinnedSpeedrunRecords,
        rankedTimeMs: ranked?.bestMs ?? null,
      });
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

  // 取得に失敗した（error あり）ときは、タイルを消さずに値の位置で失敗を示す（押すと記録タブの再試行カードへ）。
  // 未登録・データなし（error なし）は従来どおりタイルを出さない。
  // 代表 PB が見つからず、本来の候補（speedrun.com／メインカテゴリが ranked のときは Ranked）が失敗しているときだけ PB タイルを失敗にする
  const rankedPbFailed = categoryKey === "ranked" && showRankedStats && !!ranked?.failed;
  const pbFailed = !pbLoading && !representative && (!!src?.failed || rankedPbFailed);
  const eloFailed = !!ranked?.failed && elo == null;
  const eloLoading = elo === undefined;
  const hidden =
    !representative &&
    !pbLoading &&
    !pbFailed &&
    sensitivityPercent == null &&
    !showSearchCraft &&
    !eloLoading &&
    elo == null &&
    !eloFailed;
  if (hidden) return null;

  const failedValue = <span className="text-sm font-normal text-muted-foreground">{t("playerProfile.highlightFetchFailed")}</span>;
  // 代表 PB が speedrun.com の記録のとき、同名カテゴリがあれば版を添える（非表示の記録は数えない）。
  // 押すと記録タブへ移り、そのカードへスクロール・フォーカスする
  const representativeName =
    representative?.kind === "custom"
      ? representative.record.categoryDisplayName
      : representative?.kind === "ranked"
        ? "MCSR Ranked"
        : representative
          ? speedrunComPbDisplayName(
              representative.pb,
              visibleSpeedrunComPbs(src?.pbs ?? [], hiddenSpeedrunRecords),
              t("common.unknown"),
            )
          : "";
  const selectPb = () => {
    onSelectTab("stats");
    if (representative?.kind === "speedruncom") goToStatsCard(statsSrcCardId(representative.pb.run.id));
  };

  return (
    // md 以上は静止表示のグリッド（1 行 4 列）。md 未満は縦を使わないよう 1 行の横スクロールに畳む
    // （タイルは縮めず横に並べる。身元帯の面は bg-card/70 なのでフェードは既定の card）
    <HorizontalScrollArea className="pb-1 md:pb-0">
    <div className="flex gap-2 sm:gap-3 md:grid md:grid-cols-4">
      {pbLoading ? (
        <TileSkeleton />
      ) : representative ? (
        <HighlightTile
          icon={<Timer className="h-4 w-4" />}
          label={`${representativeName} ${t("playerProfile.pb")}`}
          onClick={selectPb}
        >
          {/* 手入力・Ranked はミリ秒、speedrun.com は秒（formatTime はミリ秒。player-stats-cards.tsx と同じ） */}
          <span className="font-mono">
            {formatTime(
              representative.kind === "custom"
                ? (representative.record.personalBest as number)
                : representative.kind === "ranked"
                  ? representative.timeMs
                  : representative.pb.run.times.primary_t * 1000,
            )}
          </span>
        </HighlightTile>
      ) : pbFailed ? (
        <HighlightTile
          icon={<Timer className="h-4 w-4" />}
          label={`${rankedPbFailed && !src?.failed ? "MCSR Ranked " : ""}${t("playerProfile.pb")}`}
          onClick={() => onSelectTab("stats")}
        >
          {failedValue}
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
      {/* Elo は最後に置く。読み込み中の枠が「未登録」と分かって消えても、値の分かったほかのタイルが横にずれないようにするため */}
      {eloLoading ? (
        <LoadingHighlightTile icon={<Trophy className="h-4 w-4" />} label={t("playerProfile.highlightElo")} />
      ) : eloFailed ? (
        <HighlightTile
          icon={<Trophy className="h-4 w-4" />}
          label={t("playerProfile.highlightElo")}
          onClick={() => onSelectTab("stats")}
        >
          {failedValue}
        </HighlightTile>
      ) : elo != null ? (
        <HighlightTile
          icon={<Trophy className="h-4 w-4" />}
          label={t("playerProfile.highlightElo")}
          onClick={() => onSelectTab("stats")}
        >
          <span className="font-mono">{Math.round(elo)}</span>
        </HighlightTile>
      ) : null}
    </div>
    </HorizontalScrollArea>
  );
}
