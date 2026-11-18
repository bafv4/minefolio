import { createTranslator } from "@/lib/messages";
import { localeFromMatches } from "@/lib/locale";
import { Link, useLoaderData, useSearchParams } from "react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Route } from "./+types/paces";
import { createDb } from "@/lib/db";
import { createAuth } from "@/lib/auth";
import { getEnv } from "@/lib/env.server";
import { PACE_FEED_SPLITS } from "@/lib/pace-splits";
import { filterOwnPaces, type OwnPacePrefs } from "@/lib/pace-visibility";
import {
  getPublicPaceFeed,
  getViewerPacePrefs,
  parsePaceSearchParams,
  withPaceProfiles,
  type PaceFeedItemWithProfile,
} from "@/lib/paces-feed.server";
import { pickLocalizedName } from "@/lib/mcid-display-name";
import { useT, useLocale } from "@/hooks/use-locale";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmptyState } from "@/components/empty-state";
import { PaceFeedCard } from "@/components/pace-feed-card";
import { FeedErrorNotice } from "@/components/home/feed-error-notice";
import { useInfiniteScroll } from "@/hooks/use-infinite-scroll";
import { PACES_PAGE_SIZE } from "./api/paces";
import { cn } from "@/lib/utils";
import { History, Activity, ChevronDown, Loader2, Search, X } from "lucide-react";

// 検索条件として使用するURLクエリパラメータ
const FILTER_PARAM_KEYS = ["q", "split", "from", "to", "maxTime", "sort"] as const;

// タイム上限の入力形式（サーバー側 parseTimeParamToMs と同じ m:ss）
const MAX_TIME_PATTERN = /^\d{1,3}:[0-5]?\d$/;

export const meta: Route.MetaFunction = ({ matches, loaderData }) => {
  const t = createTranslator(localeFromMatches(matches));
  const title = t("paces.metaTitle");
  const description = t("paces.description");
  const appUrl = loaderData?.appUrl || "https://minefolio.app";
  const ogImage = `${appUrl}/icon.png`;
  return [
    { title },
    { name: "description", content: description },
    { property: "og:type", content: "website" },
    { property: "og:title", content: title },
    { property: "og:description", content: description },
    { property: "og:image", content: ogImage },
    { name: "twitter:card", content: "summary" },
    { name: "twitter:title", content: title },
    { name: "twitter:description", content: description },
    { name: "twitter:image", content: ogImage },
  ];
};

export async function loader({ request }: Route.LoaderArgs) {
  const env = getEnv();
  const appUrl = env.APP_URL || "https://minefolio.app";
  const db = createDb();
  const auth = createAuth(db, env);

  const url = new URL(request.url);
  const filters = parsePaceSearchParams(url.searchParams);
  const [{ items, userData }, viewerPrefs] =
    await Promise.all([
      getPublicPaceFeed(filters),
      getViewerPacePrefs(db, auth, request),
    ]);

  // 見出しの件数バッジは実際に表示されるカード数と一致させる。
  // 一方 total は /api/paces（ユーザー非依存・CDNキャッシュ）のページングの
  // 基準なので、除外前の件数のまま保つ
  const visibleTotal = filterOwnPaces(items, viewerPrefs).length;

  return {
    appUrl,
    // 走者情報（uuid・表示名・スキン）は1ページ目の分だけ各ペースに添える。
    // 2ページ目以降は /api/paces が同じ形（profile 付き）で返す
    paces: withPaceProfiles(items.slice(0, PACES_PAGE_SIZE), userData),
    total: items.length,
    visibleTotal,
    viewerPrefs,
  };
}

// 無限スクロール付きのペース一覧（/videos と共通の use-infinite-scroll フックを使用。
// 検索条件の変化は resetDeps でフック側がリセットする）
function PacesList({
  initialPaces,
  initialTotal,
  filterKey,
  viewerPrefs,
}: {
  initialPaces: PaceFeedItemWithProfile[];
  initialTotal: number;
  filterKey: string;
  viewerPrefs: OwnPacePrefs;
}) {
  const t = useT();
  const locale = useLocale();
  const infinite = useInfiniteScroll<PaceFeedItemWithProfile>({
    initialItems: initialPaces,
    initialPage: 1,
    initialHasMore: initialPaces.length < initialTotal,
    endpoint: "/api/paces",
    resetDeps: [filterKey],
  });

  // 「ホームに自分のペースを表示しない」設定時、自分のペースを除外（ホームと同じ挙動）
  // レスポンス自体はユーザー非依存（CDNキャッシュ対象）のため、フィルタはクライアント側で適用する
  const visiblePaces = useMemo(
    () => filterOwnPaces(infinite.items, viewerPrefs),
    [infinite.items, viewerPrefs]
  );

  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {visiblePaces.map((run) => (
          <PaceFeedCard
            key={run.pacemanRunId}
            run={run}
            uuid={run.profile?.uuid}
            displayName={pickLocalizedName(
              run.profile?.displayNameAlphabet,
              run.profile?.displayName,
              locale,
            )}
            skinUrl={run.profile?.skinUrl}
          />
        ))}
      </div>

      {/* スクリーンリーダー向け追加読み込み通知 */}
      <div role="status" aria-live="polite" className="sr-only">
        {infinite.liveMessage}
      </div>

      {/* 無限スクロール: センチネル + 「もっと読み込む」フォールバック。追加の取得に失敗したら、ボタンの代わりに失敗の帯と再試行を出す */}
      {infinite.items.length > 0 && infinite.hasMore && (
        <div className="flex flex-col items-center gap-3 py-6">
          <div ref={infinite.sentinelRef} aria-hidden className="h-px w-full" />
          {infinite.loadError ? (
            <div className="w-full">
              <FeedErrorNotice message={t("paces.loadMoreFailed")} onRetry={infinite.retry} />
            </div>
          ) : (
            <Button
              variant="outline"
              onClick={infinite.loadMore}
              disabled={infinite.isLoadingMore}
            >
              {infinite.isLoadingMore && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t("paces.loadMore")}
            </Button>
          )}
        </div>
      )}
    </>
  );
}

export default function PacesPage() {
  const t = useT();
  const { paces, total, visibleTotal, viewerPrefs } =
    useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();

  // 検索フォームの入力状態（URLクエリと同期）
  const [player, setPlayer] = useState(searchParams.get("q") ?? "");
  const [split, setSplit] = useState(searchParams.get("split") ?? "all");
  const [from, setFrom] = useState(searchParams.get("from") ?? "");
  const [to, setTo] = useState(searchParams.get("to") ?? "");
  const [maxTime, setMaxTime] = useState(searchParams.get("maxTime") ?? "");
  // 並び順（"recent"=新しい順 / "time"=タイム順。URLには "time" のみ載せる）
  const [sort, setSort] = useState(searchParams.get("sort") === "time" ? "time" : "recent");

  // sort 以外のパラメータの前回値（並び順だけの変更では他欄の下書きを巻き戻さないための比較用）
  const prevNonSortRef = useRef<string | null>(null);

  useEffect(() => {
    const nonSort = FILTER_PARAM_KEYS.filter((key) => key !== "sort")
      .map((key) => searchParams.get(key) ?? "")
      .join("|");
    const changed = prevNonSortRef.current !== nonSort;
    prevNonSortRef.current = nonSort;
    if (changed) {
      setPlayer(searchParams.get("q") ?? "");
      setSplit(searchParams.get("split") ?? "all");
      setFrom(searchParams.get("from") ?? "");
      setTo(searchParams.get("to") ?? "");
      setMaxTime(searchParams.get("maxTime") ?? "");
    }
    setSort(searchParams.get("sort") === "time" ? "time" : "recent");
  }, [searchParams]);

  const hasActiveFilters = FILTER_PARAM_KEYS.some((key) => searchParams.get(key));
  // 折りたたみバッジの件数は絞り込み条件のみ（並び順 sort は絞り込みではないので数えない）
  const activeFilterCount = FILTER_PARAM_KEYS.filter((key) => key !== "sort" && searchParams.get(key)).length;
  // モバイル（sm 未満）のみ折りたたみ。結果を1画面目に出すため適用中でも既定は閉じ、件数バッジで状態を示す
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [maxTimeInvalid, setMaxTimeInvalid] = useState(false);

  // 畳んだ状態でも適用中の条件を見せるためのチップ（URL＝適用済みの値から作る。入力中の下書きは含めない）
  const appliedChips: { key: string; label: string }[] = [];
  const appliedQ = searchParams.get("q");
  if (appliedQ) appliedChips.push({ key: "q", label: `${t("paces.filterPlayer")}: ${appliedQ}` });
  const appliedSplit = searchParams.get("split");
  if (appliedSplit) appliedChips.push({ key: "split", label: `${t("paces.filterSplit")}: ${appliedSplit}` });
  const appliedFrom = searchParams.get("from");
  const appliedTo = searchParams.get("to");
  if (appliedFrom || appliedTo) {
    appliedChips.push({
      key: "period",
      label: `${t("paces.filterPeriod")}: ${appliedFrom ?? ""}${t("common.rangeSeparator")}${appliedTo ?? ""}`,
    });
  }
  const appliedMaxTime = searchParams.get("maxTime");
  if (appliedMaxTime) {
    appliedChips.push({ key: "maxTime", label: `${t("paces.filterMaxTime")}: ${appliedMaxTime}` });
  }
  if (searchParams.get("sort") === "time") {
    appliedChips.push({ key: "sort", label: `${t("paces.filterSort")}: ${t("paces.sortTime")}` });
  }

  // 並び順は選んだ時点で反映（/browse と同じ即時反映）。他の入力中の下書きは送らず、URL上の適用済み条件に sort だけ足す
  const handleSortChange = (value: string) => {
    setSort(value);
    const params = new URLSearchParams(searchParams);
    if (value === "time") params.set("sort", "time");
    else params.delete("sort");
    setSearchParams(params, { preventScrollReset: true });
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (maxTime.trim() && !MAX_TIME_PATTERN.test(maxTime.trim())) {
      setMaxTimeInvalid(true);
      setFiltersOpen(true);
      return;
    }
    const params = new URLSearchParams();
    if (player.trim()) params.set("q", player.trim());
    if (split !== "all") params.set("split", split);
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    if (maxTime.trim()) params.set("maxTime", maxTime.trim());
    if (sort === "time") params.set("sort", "time");
    setSearchParams(params, { preventScrollReset: true });
  };

  const handleClear = () => {
    setSearchParams(new URLSearchParams(), { preventScrollReset: true });
  };

  // 検索条件が変わったら一覧を作り直すためのキー
  const filterKey = FILTER_PARAM_KEYS.map((key) => searchParams.get(key) ?? "").join("|");

  return (
    <div className="flex-1 space-y-6">
      <div className="flex items-center gap-3">
        <div className="rounded-xl bg-primary/10 p-2">
          <History className="h-5 w-5 text-primary" />
        </div>
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
            {t("home.paceFeedLabel")}
          </p>
          <h1 className="text-2xl font-bold">{t("paces.title")}</h1>
        </div>
        <span className="ml-auto inline-flex items-center gap-1 rounded-full border border-border/70 bg-background/75 px-2.5 py-1 text-xs text-muted-foreground">
          <Activity className="h-3.5 w-3.5" />
          {t("paces.count", { count: visibleTotal })}
        </span>
      </div>
      <p className="text-sm text-muted-foreground">{t("paces.description")}</p>

      <form
        onSubmit={handleSearch}
        className="rounded-xl border border-border/70 bg-card p-4 sm:p-5"
      >
        <button
          type="button"
          onClick={() => setFiltersOpen((v) => !v)}
          aria-expanded={filtersOpen}
          aria-controls="pace-filter-panel"
          className="-my-3 flex min-h-11 w-full items-center gap-2 rounded text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:hidden"
        >
          <Search className="h-4 w-4" />
          {t("paces.filterToggle")}
          {activeFilterCount > 0 && (
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">
              {t("paces.filterActiveCount", { count: activeFilterCount })}
            </span>
          )}
          <ChevronDown className={cn("ml-auto h-4 w-4 transition-transform", filtersOpen && "rotate-180")} />
        </button>
        {!filtersOpen && appliedChips.length > 0 && (
          <ul className="mt-2 flex flex-wrap gap-1.5 sm:hidden" aria-label={t("paces.filterToggle")}>
            {appliedChips.map((chip) => (
              <li
                key={chip.key}
                className="inline-flex max-w-full items-center rounded-full border border-border/70 bg-background/75 px-2.5 py-1 text-xs text-muted-foreground"
              >
                <span className="truncate">{chip.label}</span>
              </li>
            ))}
          </ul>
        )}
        <div id="pace-filter-panel" className={cn("mt-3 sm:mt-0 sm:block", filtersOpen ? "block" : "hidden")}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-[1fr_1fr_2fr_1fr_1fr]">
          <div className="space-y-1.5">
            <Label htmlFor="pace-filter-player">{t("paces.filterPlayer")}</Label>
            <Input
              id="pace-filter-player"
              value={player}
              onChange={(e) => setPlayer(e.target.value)}
              placeholder={t("paces.filterPlayerPlaceholder")}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pace-filter-split">{t("paces.filterSplit")}</Label>
            <Select value={split} onValueChange={setSplit}>
              <SelectTrigger id="pace-filter-split" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("paces.splitAll")}</SelectItem>
                {PACE_FEED_SPLITS.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5 sm:col-span-2 xl:col-span-1">
            <span className="flex text-sm font-medium leading-none">{t("paces.filterPeriod")}</span>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
              <div className="space-y-1">
                <Label htmlFor="pace-filter-from" className="text-xs text-muted-foreground sm:sr-only">
                  {t("paces.filterPeriodFrom")}
                </Label>
                <Input
                  id="pace-filter-from"
                  type="date"
                  className="min-w-40"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                />
              </div>
              <span aria-hidden className="hidden text-muted-foreground sm:block">{t("common.rangeSeparator")}</span>
              <div className="space-y-1">
                <Label htmlFor="pace-filter-to" className="text-xs text-muted-foreground sm:sr-only">
                  {t("paces.filterPeriodTo")}
                </Label>
                <Input
                  id="pace-filter-to"
                  type="date"
                  className="min-w-40"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                />
              </div>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pace-filter-max-time">{t("paces.filterMaxTime")}</Label>
            <Input
              id="pace-filter-max-time"
              value={maxTime}
              onChange={(e) => {
                setMaxTime(e.target.value);
                setMaxTimeInvalid(false);
              }}
              placeholder={t("paces.filterMaxTimePlaceholder")}
              aria-invalid={maxTimeInvalid || undefined}
              aria-describedby={maxTimeInvalid ? "pace-filter-max-time-error" : "pace-filter-max-time-hint"}
            />
            {maxTimeInvalid ? (
              <p id="pace-filter-max-time-error" role="alert" className="text-xs text-destructive">
                {t("paces.filterMaxTimeError")}
              </p>
            ) : (
              <p id="pace-filter-max-time-hint" className="text-xs text-muted-foreground">
                {t("paces.filterMaxTimeHint")}
              </p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pace-filter-sort">{t("paces.filterSort")}</Label>
            <Select value={sort} onValueChange={handleSortChange}>
              <SelectTrigger id="pace-filter-sort" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="recent">{t("paces.sortRecent")}</SelectItem>
                <SelectItem value="time">{t("paces.sortTime")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <Button type="submit" size="sm">
            <Search className="mr-1 h-4 w-4" />
            {t("common.search")}
          </Button>
          {hasActiveFilters && (
            <Button type="button" variant="ghost" size="sm" onClick={handleClear}>
              <X className="mr-1 h-4 w-4" />
              {t("common.resetFilters")}
            </Button>
          )}
        </div>
        </div>
      </form>

      {visibleTotal > 0 ? (
        <PacesList
          initialPaces={paces}
          initialTotal={total}
          filterKey={filterKey}
          viewerPrefs={viewerPrefs}
        />
      ) : (
        <EmptyState
          icon={<History className="h-12 w-12" />}
          title={hasActiveFilters ? t("paces.emptyFiltered") : t("paces.empty")}
          description={hasActiveFilters ? t("paces.emptyFilteredHint") : t("paces.emptyHint")}
          action={
            hasActiveFilters ? (
              <Button asChild variant="outline" size="sm">
                <Link to="/paces">{t("common.resetFilters")}</Link>
              </Button>
            ) : undefined
          }
        />
      )}
    </div>
  );
}
