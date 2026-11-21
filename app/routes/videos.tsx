import { createTranslator } from "@/lib/messages";
import { localeFromMatches } from "@/lib/locale";
import { Link, useLoaderData, useNavigation, useSearchParams } from "react-router";
import { useEffect, useMemo, useState } from "react";
import type { Route } from "./+types/videos";
import { createDb } from "@/lib/db";
import { createAuth } from "@/lib/auth";
import { getEnv } from "@/lib/env.server";
import { getOptionalSession } from "@/lib/session";
import { toJstDateString } from "@/lib/paces-feed.server";
import {
  getPublicVideoFeed,
  getViewerVideoPrefs,
  parseVideoSearchParams,
} from "@/lib/videos-feed.server";
import { useT } from "@/hooks/use-locale";
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
import { FeedVideoCard } from "@/components/feed-video-card";
import { FeedErrorNotice } from "@/components/home/feed-error-notice";
import {
  feedVideoKey,
  filterOwnVideos,
  videoRetentionCutoff,
  type FeedVideo,
  type OwnVideoPrefs,
} from "@/lib/feed-video";
import { useInfiniteScroll } from "@/hooks/use-infinite-scroll";
import { VIDEOS_PAGE_SIZE } from "./api/videos";
import { cn } from "@/lib/utils";
import { StatusPill } from "@/components/status-pill";
import { normalizeDateParam } from "@/lib/date-param";
import { Play, Film, ChevronDown, Loader2, Search, X } from "lucide-react";

// 検索条件として使用するURLクエリパラメータ
const FILTER_PARAM_KEYS = ["q", "platform", "from", "to"] as const;

// URL の platform を youtube / twitch / all に正規化する（それ以外の値は「すべて」扱い。サーバーも同じ値だけを使う）
function normalizePlatform(value: string | null): "all" | "youtube" | "twitch" {
  return value === "youtube" || value === "twitch" ? value : "all";
}

export const meta: Route.MetaFunction = ({ matches, loaderData }) => {
  const t = createTranslator(localeFromMatches(matches));
  const title = t("videos.metaTitle");
  const description = t("videos.description");
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
  const filters = parseVideoSearchParams(url.searchParams);
  const [items, viewerPrefs, session] = await Promise.all([
    getPublicVideoFeed(db, filters),
    getViewerVideoPrefs(db, auth, request),
    getOptionalSession(request, auth),
  ]);

  // 見出しの件数バッジは実際に表示されるカード数と一致させる。
  // 一方 total は /api/videos（ユーザー非依存・CDNキャッシュ）のページングの基準なので、
  // 除外前の件数のまま保つ
  const visibleTotal = filterOwnVideos(items, viewerPrefs).length;

  return {
    appUrl,
    videos: items.slice(0, VIDEOS_PAGE_SIZE),
    total: items.length,
    visibleTotal,
    viewerPrefs,
    // 空状態の案内（ログイン中の人にだけ設定画面への導線を出す）
    signedIn: Boolean(session),
    // 日付入力の範囲: 取得できる期間（保持期間の開始日）〜今日（JST）
    dateRange: {
      min: toJstDateString(videoRetentionCutoff()),
      max: toJstDateString(new Date()),
    },
  };
}

// 無限スクロール付きの動画一覧（/browse と同じ use-infinite-scroll フックを使用。
// 検索条件の変化は resetDeps でフック側がリセットする）
function VideosList({
  initialVideos,
  initialTotal,
  filterKey,
  viewerPrefs,
}: {
  initialVideos: FeedVideo[];
  initialTotal: number;
  filterKey: string;
  viewerPrefs: OwnVideoPrefs;
}) {
  const t = useT();
  const infinite = useInfiniteScroll<FeedVideo>({
    initialItems: initialVideos,
    initialPage: 1,
    initialHasMore: initialVideos.length < initialTotal,
    endpoint: "/api/videos",
    resetDeps: [filterKey],
  });

  // 「ホームに自分の動画を表示しない」設定時、自分の動画/VODを除外（ホームと共通の filterOwnVideos）
  // 追加読み込みでページ間に同じ動画が重なりうる（CDN の s-maxage と offset の組み合わせ）ので、key で重複を除く
  const visibleVideos = useMemo(() => {
    const seen = new Set<string>();
    return filterOwnVideos(infinite.items, viewerPrefs).filter((video) => {
      const key = feedVideoKey(video);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [infinite.items, viewerPrefs]);

  return (
    <>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {visibleVideos.map((video) => (
          <FeedVideoCard key={feedVideoKey(video)} video={video} />
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
              <FeedErrorNotice message={t("videos.loadMoreFailed")} onRetry={infinite.retry} />
            </div>
          ) : (
            <Button
              variant="outline"
              onClick={infinite.loadMore}
              disabled={infinite.isLoadingMore}
            >
              {infinite.isLoadingMore && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t("videos.loadMore")}
            </Button>
          )}
        </div>
      )}
    </>
  );
}

export default function VideosPage() {
  const t = useT();
  const { videos, total, visibleTotal, viewerPrefs, signedIn, dateRange } = useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigation = useNavigation();
  // /videos 内の絞り込みの再取得中だけ、中身を薄くして残す（別ページへ移るときは薄くしない）
  const isLoading = navigation.state === "loading" && navigation.location?.pathname === "/videos";

  // 検索フォームの入力状態（URLクエリと同期）
  const [player, setPlayer] = useState(searchParams.get("q") ?? "");
  const [platform, setPlatform] = useState(normalizePlatform(searchParams.get("platform")));
  const [from, setFrom] = useState(normalizeDateParam(searchParams.get("from")) ?? "");
  const [to, setTo] = useState(normalizeDateParam(searchParams.get("to")) ?? "");

  useEffect(() => {
    setPlayer(searchParams.get("q") ?? "");
    setPlatform(normalizePlatform(searchParams.get("platform")));
    setFrom(normalizeDateParam(searchParams.get("from")) ?? "");
    setTo(normalizeDateParam(searchParams.get("to")) ?? "");
  }, [searchParams]);

  const appliedFrom = normalizeDateParam(searchParams.get("from"));
  const appliedTo = normalizeDateParam(searchParams.get("to"));
  const hasActiveFilters =
    Boolean(searchParams.get("q")) ||
    normalizePlatform(searchParams.get("platform")) !== "all" ||
    Boolean(appliedFrom) ||
    Boolean(appliedTo);
  // モバイル（sm 未満）のみ折りたたみ。結果を1画面目に出すため適用中でも既定は閉じ、件数バッジとチップで状態を示す（/paces と同じ）
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [periodInvalid, setPeriodInvalid] = useState(false);

  // 畳んだ状態でも適用中の条件を見せるためのチップ（URL＝適用済みの値から作る。入力中の下書きは含めない）
  const appliedChips: { key: string; label: string }[] = [];
  const appliedQ = searchParams.get("q");
  if (appliedQ) appliedChips.push({ key: "q", label: `${t("videos.filterPlayer")}: ${appliedQ}` });
  const appliedPlatform = normalizePlatform(searchParams.get("platform"));
  if (appliedPlatform !== "all") {
    appliedChips.push({
      key: "platform",
      label: `${t("videos.filterPlatform")}: ${appliedPlatform === "youtube" ? "YouTube" : "Twitch"}`,
    });
  }
  if (appliedFrom || appliedTo) {
    appliedChips.push({
      key: "period",
      label: `${t("videos.filterPeriod")}: ${appliedFrom ?? ""}${t("common.rangeSeparator")}${appliedTo ?? ""}`,
    });
  }

  // 折りたたみバッジの件数は上のチップの数と同じ（/paces と同じ。開始日・終了日は「時期」の1件）
  const activeFilterCount = appliedChips.length;

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    // 開始日が終了日より後なら送らずに知らせる（YYYY-MM-DD なので文字列の比較で前後が分かる）
    if (from && to && from > to) {
      setPeriodInvalid(true);
      setFiltersOpen(true);
      return;
    }
    const params = new URLSearchParams();
    if (player.trim()) params.set("q", player.trim());
    if (platform !== "all") params.set("platform", platform);
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    setSearchParams(params, { preventScrollReset: true });
  };

  const handleClear = () => {
    setPeriodInvalid(false);
    setSearchParams(new URLSearchParams(), { preventScrollReset: true });
  };

  // 検索条件が変わったら一覧を作り直すためのキー
  const filterKey = FILTER_PARAM_KEYS.map((key) => searchParams.get(key) ?? "").join("|");

  return (
    <div className="flex-1 space-y-6">
      <div className="flex items-center gap-3">
        <div className="rounded-xl bg-primary/10 p-2">
          <Play className="h-5 w-5 text-primary" />
        </div>
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
            {t("home.videoFeedLabel")}
          </p>
          <h1 className="text-2xl font-bold">{t("videos.title")}</h1>
        </div>
        {visibleTotal > 0 && (
          <StatusPill icon={Film} className="ml-auto">
            {t("videos.count", { count: visibleTotal })}
          </StatusPill>
        )}
      </div>
      <p className="text-sm text-muted-foreground">{t("videos.description")}</p>

      <form
        onSubmit={handleSearch}
        className="rounded-xl border border-border/70 bg-card p-4 sm:p-5"
      >
        <button
          type="button"
          onClick={() => setFiltersOpen((v) => !v)}
          aria-expanded={filtersOpen}
          aria-controls="video-filter-panel"
          className="-my-3 flex min-h-11 w-full items-center gap-2 rounded text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:hidden"
        >
          <Search className="h-4 w-4" />
          {t("videos.filterToggle")}
          {activeFilterCount > 0 && (
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">
              {t("videos.filterActiveCount", { count: activeFilterCount })}
            </span>
          )}
          <ChevronDown className={cn("ml-auto h-4 w-4 transition-transform", filtersOpen && "rotate-180")} />
        </button>
        {!filtersOpen && appliedChips.length > 0 && (
          <ul className="mt-2 flex flex-wrap gap-1.5 sm:hidden" aria-label={t("videos.filterToggle")}>
            {appliedChips.map((chip) => (
              <li key={chip.key} className="max-w-full">
                <StatusPill className="max-w-full">
                  <span className="truncate">{chip.label}</span>
                </StatusPill>
              </li>
            ))}
          </ul>
        )}
        <div id="video-filter-panel" className={cn("mt-3 sm:mt-0 sm:block", filtersOpen ? "block" : "hidden")}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_2fr]">
            <div className="space-y-1.5">
              <Label htmlFor="video-filter-player">{t("videos.filterPlayer")}</Label>
              <Input
                id="video-filter-player"
                value={player}
                onChange={(e) => setPlayer(e.target.value)}
                placeholder={t("videos.filterPlayerPlaceholder")}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="video-filter-platform">{t("videos.filterPlatform")}</Label>
              <Select value={platform} onValueChange={(v) => setPlatform(normalizePlatform(v))}>
                <SelectTrigger id="video-filter-platform" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("videos.platformAll")}</SelectItem>
                  <SelectItem value="youtube">YouTube</SelectItem>
                  <SelectItem value="twitch">Twitch</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {/* 期間: /paces と同じ作り（見出し「時期」の下に開始日・終了日。sm 以上は欄名を sr-only にして横に並べる） */}
            <div className="space-y-1.5 sm:col-span-2 lg:col-span-1">
              <span className="flex text-sm font-medium leading-none">{t("videos.filterPeriod")}</span>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
                <div className="space-y-1">
                  <Label htmlFor="video-filter-from" className="text-xs text-muted-foreground sm:sr-only">
                    {t("videos.filterPeriodFrom")}
                  </Label>
                  <Input
                    id="video-filter-from"
                    type="date"
                    className="min-w-40"
                    value={from}
                    min={dateRange.min}
                    max={dateRange.max}
                    onChange={(e) => {
                      setFrom(e.target.value);
                      setPeriodInvalid(false);
                    }}
                    aria-invalid={periodInvalid || undefined}
                    aria-describedby={periodInvalid ? "video-filter-period-error" : undefined}
                  />
                </div>
                <span aria-hidden className="hidden text-muted-foreground sm:block">{t("common.rangeSeparator")}</span>
                <div className="space-y-1">
                  <Label htmlFor="video-filter-to" className="text-xs text-muted-foreground sm:sr-only">
                    {t("videos.filterPeriodTo")}
                  </Label>
                  <Input
                    id="video-filter-to"
                    type="date"
                    className="min-w-40"
                    value={to}
                    min={dateRange.min}
                    max={dateRange.max}
                    onChange={(e) => {
                      setTo(e.target.value);
                      setPeriodInvalid(false);
                    }}
                    aria-invalid={periodInvalid || undefined}
                    aria-describedby={periodInvalid ? "video-filter-period-error" : undefined}
                  />
                </div>
              </div>
              {periodInvalid && (
                <p id="video-filter-period-error" role="alert" className="text-xs text-destructive">
                  {t("videos.filterPeriodError")}
                </p>
              )}
            </div>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <Button type="submit" size="sm" className="min-h-11 sm:min-h-8">
              <Search className="mr-1 h-4 w-4" />
              {t("common.search")}
            </Button>
            {hasActiveFilters && (
              <Button type="button" variant="ghost" size="sm" className="min-h-11 sm:min-h-8" onClick={handleClear}>
                <X className="mr-1 h-4 w-4" />
                {t("common.resetFilters")}
              </Button>
            )}
          </div>
        </div>
      </form>

      {/* 絞り込みの再取得中は、一覧（または空状態）を差し替えず薄くして残す */}
      <div
        aria-busy={isLoading || undefined}
        className={cn("transition-opacity motion-reduce:transition-none", isLoading && "opacity-50")}
      >
        {visibleTotal > 0 ? (
          <VideosList
            initialVideos={videos}
            initialTotal={total}
            filterKey={filterKey}
            viewerPrefs={viewerPrefs}
          />
        ) : (
          <EmptyState
            icon={<Film className="h-12 w-12" />}
            title={hasActiveFilters ? t("videos.emptyFiltered") : t("videos.empty")}
            description={hasActiveFilters ? t("videos.emptyFilteredHint") : t("videos.emptyHint")}
            action={
              hasActiveFilters ? (
                <Button asChild variant="outline" size="sm">
                  <Link to="/videos">{t("common.resetFilters")}</Link>
                </Button>
              ) : signedIn ? (
                <Button asChild variant="outline" size="sm">
                  <Link to="/me/edit">{t("videos.emptyAction")}</Link>
                </Button>
              ) : undefined
            }
          />
        )}
      </div>
    </div>
  );
}
