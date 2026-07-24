import { useLoaderData, useSearchParams } from "react-router";
import { useEffect, useMemo, useState } from "react";
import type { Route } from "./+types/videos";
import { createDb } from "@/lib/db";
import { createAuth } from "@/lib/auth";
import { getEnv } from "@/lib/env.server";
import {
  getPublicVideoFeed,
  getViewerVideoPrefs,
  parseVideoSearchParams,
} from "@/lib/videos-feed.server";
import { t } from "@/lib/messages";
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
import { FeedVideoCard } from "@/components/feed-video-card";
import { feedVideoKey, filterOwnVideos, type FeedVideo, type OwnVideoPrefs } from "@/lib/feed-video";
import { useInfiniteScroll } from "@/hooks/use-infinite-scroll";
import { VIDEOS_PAGE_SIZE } from "./api/videos";
import { Play, Film, Loader2, Search, X } from "lucide-react";

// 検索条件として使用するURLクエリパラメータ
const FILTER_PARAM_KEYS = ["q", "platform", "from", "to"] as const;

export const meta: Route.MetaFunction = ({ loaderData }) => {
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
  const [items, viewerPrefs] = await Promise.all([
    getPublicVideoFeed(db, filters),
    getViewerVideoPrefs(db, auth, request),
  ]);

  return {
    appUrl,
    videos: items.slice(0, VIDEOS_PAGE_SIZE),
    total: items.length,
    viewerPrefs,
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
  const infinite = useInfiniteScroll<FeedVideo>({
    initialItems: initialVideos,
    initialPage: 1,
    initialHasMore: initialVideos.length < initialTotal,
    endpoint: "/api/videos",
    resetDeps: [filterKey],
  });

  // 「ホームに自分の動画を表示しない」設定時、自分の動画/VODを除外（ホームと共通の filterOwnVideos）
  const visibleVideos = useMemo(
    () => filterOwnVideos(infinite.items, viewerPrefs),
    [infinite.items, viewerPrefs]
  );

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

      {/* 無限スクロール: センチネル + 「もっと読み込む」フォールバック */}
      {infinite.items.length > 0 && infinite.hasMore && (
        <div className="flex flex-col items-center gap-3 py-6">
          <div ref={infinite.sentinelRef} aria-hidden className="h-px w-full" />
          <Button
            variant="outline"
            onClick={infinite.loadMore}
            disabled={infinite.isLoadingMore}
          >
            {infinite.isLoadingMore && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {t("videos.loadMore")}
          </Button>
        </div>
      )}
    </>
  );
}

export default function VideosPage() {
  const { videos, total, viewerPrefs } = useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();

  // 検索フォームの入力状態（URLクエリと同期）
  const [player, setPlayer] = useState(searchParams.get("q") ?? "");
  const [platform, setPlatform] = useState(searchParams.get("platform") ?? "all");
  const [from, setFrom] = useState(searchParams.get("from") ?? "");
  const [to, setTo] = useState(searchParams.get("to") ?? "");

  useEffect(() => {
    setPlayer(searchParams.get("q") ?? "");
    setPlatform(searchParams.get("platform") ?? "all");
    setFrom(searchParams.get("from") ?? "");
    setTo(searchParams.get("to") ?? "");
  }, [searchParams]);

  const hasActiveFilters = FILTER_PARAM_KEYS.some((key) => searchParams.get(key));

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const params = new URLSearchParams();
    if (player.trim()) params.set("q", player.trim());
    if (platform !== "all") params.set("platform", platform);
    if (from) params.set("from", from);
    if (to) params.set("to", to);
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
        <div className="rounded-xl bg-red-500/10 p-2">
          <Play className="h-5 w-5 text-red-600" />
        </div>
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
            {t("home.videoFeedLabel")}
          </p>
          <h1 className="text-2xl font-bold">{t("videos.title")}</h1>
        </div>
        <span className="ml-auto inline-flex items-center gap-1 rounded-full border border-border/70 bg-background/70 px-2.5 py-1 text-xs text-muted-foreground">
          <Film className="h-3.5 w-3.5" />
          {t("videos.count", { count: total })}
        </span>
      </div>
      <p className="text-sm text-muted-foreground">{t("videos.description")}</p>

      <form
        onSubmit={handleSearch}
        className="rounded-2xl border border-border/70 bg-card/70 p-4 sm:p-5"
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
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
            <Select value={platform} onValueChange={setPlatform}>
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
          <div className="space-y-1.5">
            <Label htmlFor="video-filter-from">{t("videos.filterPeriod")}</Label>
            <div className="flex items-center gap-2">
              <Input
                id="video-filter-from"
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
              <span className="shrink-0 text-muted-foreground">〜</span>
              <Input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                aria-label={t("videos.filterPeriodTo")}
              />
            </div>
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
              {t("common.clear")}
            </Button>
          )}
        </div>
      </form>

      {videos.length > 0 ? (
        <VideosList
          initialVideos={videos}
          initialTotal={total}
          filterKey={filterKey}
          viewerPrefs={viewerPrefs}
        />
      ) : (
        <div className="rounded-2xl border border-dashed border-border/70 bg-background/60 py-16 text-center text-muted-foreground">
          <Film className="mx-auto mb-2 h-12 w-12 opacity-30" />
          <p>{hasActiveFilters ? t("videos.emptyFiltered") : t("videos.empty")}</p>
        </div>
      )}
    </div>
  );
}
