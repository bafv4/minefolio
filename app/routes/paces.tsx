import { useLoaderData, useSearchParams } from "react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Route } from "./+types/paces";
import { createDb } from "@/lib/db";
import { createAuth } from "@/lib/auth";
import { getEnv } from "@/lib/env.server";
import { PACE_FEED_SPLITS } from "@/lib/pace-splits";
import {
  getVisiblePaceFeed,
  parsePaceSearchParams,
  type PaceFeedItem,
} from "@/lib/paces-feed.server";
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
import { PaceFeedCard } from "@/components/pace-feed-card";
import { History, Activity, Loader2, Search, X } from "lucide-react";

// 初回・追加読み込みの件数（無限スクロールで順次追加）
const PAGE_SIZE = 60;

// 検索条件として使用するURLクエリパラメータ
const FILTER_PARAM_KEYS = ["q", "split", "from", "to", "maxTime"] as const;

export const meta: Route.MetaFunction = ({ loaderData }) => {
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
  const { items, mcidToUuid, mcidToDisplayName, mcidToSkinUrl } =
    await getVisiblePaceFeed(db, auth, request, filters);

  return {
    appUrl,
    paces: items.slice(0, PAGE_SIZE),
    total: items.length,
    mcidToUuid,
    mcidToDisplayName,
    mcidToSkinUrl,
  };
}

interface PacesApiResponse {
  paces: PaceFeedItem[];
  total: number;
  hasMore: boolean;
}

// 無限スクロール付きのペース一覧（検索条件が変わったら key で作り直す）
function PacesList({
  initialPaces,
  initialTotal,
  searchQuery,
  mcidToUuid,
  mcidToDisplayName,
  mcidToSkinUrl,
}: {
  initialPaces: PaceFeedItem[];
  initialTotal: number;
  searchQuery: string;
  mcidToUuid: Record<string, string>;
  mcidToDisplayName: Record<string, string>;
  mcidToSkinUrl: Record<string, string>;
}) {
  const [paces, setPaces] = useState(initialPaces);
  const [reachedEnd, setReachedEnd] = useState(initialPaces.length >= initialTotal);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const loadingRef = useRef(false);
  const offsetRef = useRef(initialPaces.length);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const loadMore = useCallback(async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoadingMore(true);
    setLoadError(false);
    try {
      const params = new URLSearchParams(searchQuery);
      params.set("offset", String(offsetRef.current));
      params.set("limit", String(PAGE_SIZE));
      const res = await fetch(`/api/paces?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as PacesApiResponse;

      offsetRef.current += data.paces.length;
      if (data.paces.length === 0 || !data.hasMore) {
        setReachedEnd(true);
      }
      // 追加読み込み中に新しいペースが入って一覧がずれた場合の重複を除去
      setPaces((prev) => {
        const seen = new Set(prev.map((p) => p.pacemanRunId));
        return [...prev, ...data.paces.filter((p) => !seen.has(p.pacemanRunId))];
      });
    } catch (err) {
      console.error("Failed to load more paces:", err);
      setLoadError(true);
    } finally {
      loadingRef.current = false;
      setLoadingMore(false);
    }
  }, [searchQuery]);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || reachedEnd || loadError) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) void loadMore();
      },
      { rootMargin: "400px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [loadMore, reachedEnd, loadError]);

  return (
    <>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        {paces.map((run) => (
          <PaceFeedCard
            key={run.pacemanRunId}
            run={run}
            uuid={mcidToUuid[run.mcid.toLowerCase()] ?? undefined}
            displayName={mcidToDisplayName[run.mcid.toLowerCase()]}
            skinUrl={mcidToSkinUrl[run.mcid.toLowerCase()]}
          />
        ))}
      </div>

      {!reachedEnd && (
        <div ref={sentinelRef} className="flex justify-center py-4">
          {loadError ? (
            <div className="flex flex-col items-center gap-2 text-sm text-muted-foreground">
              <p>{t("paces.loadMoreError")}</p>
              <Button variant="outline" size="sm" onClick={() => void loadMore()}>
                {t("paces.retry")}
              </Button>
            </div>
          ) : (
            loadingMore && <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          )}
        </div>
      )}
    </>
  );
}

export default function PacesPage() {
  const { paces, total, mcidToUuid, mcidToDisplayName, mcidToSkinUrl } =
    useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();

  // 検索フォームの入力状態（URLクエリと同期）
  const [player, setPlayer] = useState(searchParams.get("q") ?? "");
  const [split, setSplit] = useState(searchParams.get("split") ?? "all");
  const [from, setFrom] = useState(searchParams.get("from") ?? "");
  const [to, setTo] = useState(searchParams.get("to") ?? "");
  const [maxTime, setMaxTime] = useState(searchParams.get("maxTime") ?? "");

  useEffect(() => {
    setPlayer(searchParams.get("q") ?? "");
    setSplit(searchParams.get("split") ?? "all");
    setFrom(searchParams.get("from") ?? "");
    setTo(searchParams.get("to") ?? "");
    setMaxTime(searchParams.get("maxTime") ?? "");
  }, [searchParams]);

  const hasActiveFilters = FILTER_PARAM_KEYS.some((key) => searchParams.get(key));

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const params = new URLSearchParams();
    if (player.trim()) params.set("q", player.trim());
    if (split !== "all") params.set("split", split);
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    if (maxTime.trim()) params.set("maxTime", maxTime.trim());
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
        <span className="ml-auto inline-flex items-center gap-1 rounded-full border border-border/70 bg-background/70 px-2.5 py-1 text-xs text-muted-foreground">
          <Activity className="h-3.5 w-3.5" />
          {t("paces.count", { count: total })}
        </span>
      </div>
      <p className="text-sm text-muted-foreground">{t("paces.description")}</p>

      <form
        onSubmit={handleSearch}
        className="rounded-2xl border border-border/70 bg-card/70 p-4 sm:p-5"
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
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
          <div className="space-y-1.5">
            <Label htmlFor="pace-filter-from">{t("paces.filterPeriod")}</Label>
            <div className="flex items-center gap-2">
              <Input
                id="pace-filter-from"
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
              <span className="shrink-0 text-muted-foreground">〜</span>
              <Input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                aria-label={t("paces.filterPeriodTo")}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pace-filter-max-time">{t("paces.filterMaxTime")}</Label>
            <Input
              id="pace-filter-max-time"
              value={maxTime}
              onChange={(e) => setMaxTime(e.target.value)}
              placeholder={t("paces.filterMaxTimePlaceholder")}
              pattern="\d{1,3}:[0-5]?\d"
              title={t("paces.filterMaxTimePlaceholder")}
            />
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

      {paces.length > 0 ? (
        <PacesList
          key={filterKey}
          initialPaces={paces}
          initialTotal={total}
          searchQuery={searchParams.toString()}
          mcidToUuid={mcidToUuid}
          mcidToDisplayName={mcidToDisplayName}
          mcidToSkinUrl={mcidToSkinUrl}
        />
      ) : (
        <div className="rounded-2xl border border-dashed border-border/70 bg-background/60 py-16 text-center text-muted-foreground">
          <History className="mx-auto mb-2 h-12 w-12 opacity-30" />
          <p>{hasActiveFilters ? t("paces.emptyFiltered") : t("paces.empty")}</p>
        </div>
      )}
    </div>
  );
}
