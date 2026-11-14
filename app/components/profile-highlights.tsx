import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { BookOpen, Gamepad2, Gauge, Search, Timer, Trophy } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useLocale, useT } from "@/hooks/use-locale";
import { fetchMCSRRankedStatsCached } from "@/lib/ranked-stats-cache";
import { fetchSpeedrunComStatsCached } from "@/lib/speedruncom-stats-cache";
import type { SpeedrunComPersonalBest } from "@/lib/external-stats";
import { calculateCm360, isValidSensitivity, toSensitivityPercent } from "@/lib/mouse-settings";
import { getGameLanguageName } from "@/lib/game-languages";
import { categoryLabel, hidesSearchCraft, isCategoryKey, playstyleOptionLabel, SEARCH_CRAFT_OPTIONS } from "@/lib/playstyle";
import { nextTileOffset, normalizeLoopScroll, pickHighlightPb, pickHighlightSpeedrunComPb, type HighlightPbRecord } from "@/lib/profile-highlights";
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

const AUTO_SCROLL_INTERVAL_MS = 5000;
/** 手動操作の後、自動送りを再開するまでの待ち時間 */
const MANUAL_PAUSE_MS = 8000;

/**
 * 1 行の横スクロール領域を一定間隔でタイル 1 枚分ずつ自動送りし、同じ方向に途切れなくループさせる。
 * 元セットが収まらないときだけ loop=true になり、呼び出し側が元セットの複製（data-clone）を後ろに描画する。
 * 複製側へ入ったら、スクロールが止まった時点で snap を外して元セットの対応位置へ瞬時に戻す。
 * 収まっているとき・ホバー中・フォーカス中・手動操作の直後・タブ非表示・reduced-motion のときは自動送りしない
 * （reduced-motion では複製もループも無し）。
 */
function useAutoScrollRow(ref: React.RefObject<HTMLDivElement | null>, active: boolean) {
  const [loop, setLoop] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!active || !el) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    let hovering = false;
    let focused = false;
    let pausedUntil = 0;

    const originals = () => Array.from(el.querySelectorAll<HTMLElement>(":scope > :not([data-clone])"));
    const clones = () => Array.from(el.querySelectorAll<HTMLElement>(":scope > [data-clone]"));
    /** 元セット先頭から複製セット先頭までの距離。複製が無ければ 0 */
    const period = () => {
      const first = originals()[0];
      const firstClone = clones()[0];
      return first && firstClone ? firstClone.offsetLeft - first.offsetLeft : 0;
    };

    const update = () => {
      const orig = originals();
      const last = orig[orig.length - 1];
      const overflow = !!last && last.offsetLeft + last.offsetWidth - orig[0].offsetLeft > el.clientWidth + 1;
      const nextLoop = overflow && !reduced.matches;
      setLoop((prev) => (prev === nextLoop ? prev : nextLoop));
      // 端のフェードは出さない。タイル幅は「見える枚数」でちょうど割り切れ、snap で両端が常にタイル境界に揃うため、
      // フェードは完全に見えているタイルの枠を隠すだけになる（続きがある手がかりは自動送りの動きが担う）
    };

    // 複製側に入っていたら元セットの対応位置へ戻す（snap を一時的に外してちらつき・がたつきを防ぐ）
    const wrap = () => {
      const p = period();
      if (p <= 0 || el.scrollLeft < p) return;
      const target = normalizeLoopScroll(el.scrollLeft, p);
      el.style.scrollSnapType = "none";
      el.scrollTo({ left: target, behavior: "instant" });
      requestAnimationFrame(() => {
        el.style.scrollSnapType = "";
      });
    };

    const hasScrollEnd = "onscrollend" in window;
    let settleTimer: number | undefined;
    const onScroll = () => {
      update();
      if (!hasScrollEnd) {
        window.clearTimeout(settleTimer);
        settleTimer = window.setTimeout(wrap, 150);
      }
    };
    const onScrollEnd = () => wrap();

    const pauseManual = () => {
      pausedUntil = Date.now() + MANUAL_PAUSE_MS;
    };
    const onEnter = () => (hovering = true);
    const onLeave = () => (hovering = false);
    const onFocusIn = () => (focused = true);
    const onFocusOut = (e: FocusEvent) => {
      if (!el.contains(e.relatedTarget as Node | null)) focused = false;
    };

    const tick = () => {
      if (reduced.matches || hovering || focused || document.hidden) return;
      if (Date.now() < pausedUntil) return;
      if (period() <= 0) return; // 複製が描画される（＝ループ有効）までは進めない
      const first = originals()[0];
      const offsets = Array.from(el.children).map((c) => (c as HTMLElement).offsetLeft - first.offsetLeft);
      const next = nextTileOffset(el.scrollLeft, offsets);
      if (next != null) el.scrollTo({ left: next, behavior: "smooth" });
    };

    update();
    const observeChildren = () => {
      ro.disconnect();
      ro.observe(el);
      for (const child of Array.from(el.children)) ro.observe(child);
    };
    const ro = new ResizeObserver(update);
    observeChildren();
    // タイル数の変化（スケルトン → 本体、複製の増減）にも追従する
    const mo = new MutationObserver(() => {
      observeChildren();
      update();
    });
    mo.observe(el, { childList: true });
    reduced.addEventListener("change", update);

    el.addEventListener("scroll", onScroll, { passive: true });
    if (hasScrollEnd) el.addEventListener("scrollend", onScrollEnd);
    el.addEventListener("pointerenter", onEnter);
    el.addEventListener("pointerleave", onLeave);
    el.addEventListener("focusin", onFocusIn);
    el.addEventListener("focusout", onFocusOut);
    el.addEventListener("wheel", pauseManual, { passive: true });
    el.addEventListener("touchstart", pauseManual, { passive: true });
    el.addEventListener("pointerdown", pauseManual);
    el.addEventListener("keydown", pauseManual);
    const timer = window.setInterval(tick, AUTO_SCROLL_INTERVAL_MS);

    return () => {
      window.clearInterval(timer);
      window.clearTimeout(settleTimer);
      ro.disconnect();
      mo.disconnect();
      reduced.removeEventListener("change", update);
      el.removeEventListener("scroll", onScroll);
      if (hasScrollEnd) el.removeEventListener("scrollend", onScrollEnd);
      el.removeEventListener("pointerenter", onEnter);
      el.removeEventListener("pointerleave", onLeave);
      el.removeEventListener("focusin", onFocusIn);
      el.removeEventListener("focusout", onFocusOut);
      el.removeEventListener("wheel", pauseManual);
      el.removeEventListener("touchstart", pauseManual);
      el.removeEventListener("pointerdown", pauseManual);
      el.removeEventListener("keydown", pauseManual);
    };
  }, [ref, active]);

  return { loop };
}

/** 複製セット（ループ用）の中かどうか。複製は支援技術・キーボードから隠し、見た目は本物と同じにする */
const CloneContext = createContext(false);

const TILE_SIZE_CLASS =
  "min-w-0 shrink-0 grow-0 basis-[calc((100%-var(--hl-gap)*(var(--hl-n)-1))/var(--hl-n))] snap-start";

function TileSkeleton() {
  const clone = useContext(CloneContext);
  return (
    <Skeleton
      className={cn("h-[58px] rounded-xl", TILE_SIZE_CLASS)}
      {...(clone ? { "data-clone": "", "aria-hidden": true, inert: true } : {})}
    />
  );
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
  const clone = useContext(CloneContext);
  return (
    <button
      type="button"
      onClick={onClick}
      {...(clone ? { "data-clone": "", "aria-hidden": true, tabIndex: -1, inert: true } : {})}
      aria-label={t("playerProfile.highlightGoToTab", { label })}
      className={cn(TILE_SIZE_CLASS, "flex items-center gap-3 rounded-xl border border-border/70 bg-background/80 px-3.5 py-2.5 text-left transition-colors hover:border-primary/40 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring")}
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
  /** speedrun.com のユーザー名。手入力の PB が無いときだけ PB を取得して代わりに出す */
  speedruncomUsername: string | null;
  /** サーチクラフト（playstyle.searchCraft の回答 / 登録済みサーチクラフト数 / ゲーム言語） */
  searchCraftLevel: string | null | undefined;
  searchCraftCount: number;
  gameLanguage: string | null | undefined;
  /** 閲覧者に見えるガイドの件数 */
  guideCount: number;
  hiddenSpeedrunRecords: readonly string[];
  pinnedSpeedrunRecords: readonly string[];
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
  speedruncomUsername,
  searchCraftLevel,
  searchCraftCount,
  gameLanguage,
  guideCount,
  hiddenSpeedrunRecords,
  pinnedSpeedrunRecords,
  onSelectTab,
}: ProfileHighlightsProps) {
  const t = useT();
  const locale = useLocale();
  const rowRef = useRef<HTMLDivElement>(null);
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

  // サーチクラフトタブが表示され（does_not 以外）、登録があるか「している」系の回答があるときだけ出す
  const showSearchCraft =
    !hidesSearchCraft(searchCraftLevel) && (searchCraftCount > 0 || !!searchCraftLevel);
  const searchCraftValue = gameLanguage
    ? getGameLanguageName(t, locale, gameLanguage)
    : searchCraftLevel
      ? playstyleOptionLabel(t, SEARCH_CRAFT_OPTIONS, searchCraftLevel)
      : t("playerProfile.searchCraftTab");

  const eloLoading = elo === undefined;
  const hidden = !categoryKey && !pb && !srcPb && !srcPbLoading && sensitivityPercent == null && !showSearchCraft && guideCount === 0 && !eloLoading && elo == null;
  // 行が出ているときだけ自動送り・はみ出し検出を有効にする（ref は行の描画後に付く）
  const { loop } = useAutoScrollRow(rowRef, !hidden);
  if (hidden) return null;

  const tiles = (
    <>
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
        // 取得中は高さを確保（取得後に項目ごと消えてもレイアウトが跳ねないよう、タイル同寸）
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
      {guideCount > 0 && (
        <HighlightTile
          icon={<BookOpen className="h-4 w-4" />}
          label={t("playerProfile.guidesTab")}
          onClick={() => onSelectTab("guides")}
        >
          {t("guides.guidesCount", { count: guideCount })}
        </HighlightTile>
      )}
    </>
  );

  return (
    // 常に 1 行。タイル幅は画面幅ごとの「見える枚数」(--hl-n) で決め、総数には依存しない（少ないときは左詰め）。超えたときだけ横スクロール（自動送り）にする
    <div
      ref={rowRef}
      className="flex snap-x snap-mandatory gap-[var(--hl-gap)] overflow-x-auto [--hl-gap:0.5rem] [--hl-n:2] sm:[--hl-gap:0.75rem] sm:[--hl-n:3] xl:[--hl-n:4] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {tiles}
      {loop && <CloneContext.Provider value>{tiles}</CloneContext.Provider>}
    </div>
  );
}
