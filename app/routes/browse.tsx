import { createTranslator } from "@/lib/messages";
import { useLoaderData, useSearchParams, useNavigation, Form, type ShouldRevalidateFunctionArgs } from "react-router";
import { useState, useEffect, useRef } from "react";
import type { Route } from "./+types/browse";
import { createDb } from "@/lib/db";
import { getEnv } from "@/lib/env.server";
import { ProfileFeedCard, ProfileFeedCardSkeleton, ProfileFeedListItem } from "@/components/profile-feed-card";
import { ViewToggle } from "@/components/view-toggle";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Label as RadixLabel } from "@/components/ui/label";
import { Search, Users, ArrowUpDown, Loader2, Filter, X } from "lucide-react";
import { createAuth } from "@/lib/auth";
import { getOptionalSession } from "@/lib/session";
import {
  loadBrowsePage,
  parseBrowseSearchParams,
  getViewerFavoriteSlugs,
} from "@/lib/browse-query.server";
import { PAGE_VIEW_WINDOW_DAYS } from "@/lib/page-view-paths";
import { useInfiniteScroll } from "@/hooks/use-infinite-scroll";
import { useT } from "@/hooks/use-locale";
import { useFavorites } from "@/hooks/use-favorites";
import type { Translator } from "@/lib/messages";
import { localeFromMatches } from "@/lib/locale";
import { platformLabel } from "@/lib/platform-label";
import { EmptyState } from "@/components/empty-state";
import { FavoritesFirstNote } from "@/components/favorite-mark";
import { cn } from "@/lib/utils";

export const meta: Route.MetaFunction = ({ loaderData, matches }) => {
  const t = createTranslator(localeFromMatches(matches));
  const title = t("browse.metaTitle");
  const description = t("browse.description");
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

// 走者カードのスケルトン用カウントは UI 個別に管理（loader 側ページサイズは browse-query.server に集約）

export async function loader({ request }: Route.LoaderArgs) {
  const env = getEnv();
  const db = createDb();
  const auth = createAuth(db, env);
  const session = await getOptionalSession(request, auth);

  const url = new URL(request.url);

  const args = parseBrowseSearchParams(url.searchParams);
  // お気に入り取得は loadBrowsePage 内で count と並行して解決される
  const favoriteSlugs = getViewerFavoriteSlugs(db, session?.user?.id ?? null);
  const { players, totalPages, totalCount, hasMore } = await loadBrowsePage(
    db,
    args,
    favoriteSlugs,
  );

  return {
    players,
    searchQuery: args.q,
    sortBy: args.sort,
    currentPage: args.page,
    totalPages,
    totalCount,
    hasMore,
    isLoggedIn: !!session,
    filters: {
      roles: args.roles,
      editions: args.editions,
      inputMethods: args.inputMethods,
      platforms: args.platforms,
    },
    appUrl: env.APP_URL || "https://minefolio.app",
  };
}

// フィルタラベル
// ラベルは描画時に t() で解決する（モジュール評価時はロケールが未確定）
const roleLabels = (t: Translator): Record<string, string> => ({
  runner: t("browse.roleRunner"),
  viewer: t("browse.roleViewer"),
});
// ダイアログのチェックボックスと適用中チップで同じラベルを使う
const editionLabels = (t: Translator): Record<string, string> => ({
  java: t("browse.editionJava"),
  bedrock: t("browse.editionBedrock"),
});
const inputMethodLabels = (t: Translator): Record<string, string> => ({
  keyboard_mouse: t("browse.inputKeyboardMouse"),
  controller: t("browse.inputController"),
  touch: t("browse.inputTouch"),
});

// view（表示形式）だけが変わるナビゲーションではサーバーデータが同一なので再取得しない
export function shouldRevalidate({ currentUrl, nextUrl, defaultShouldRevalidate }: ShouldRevalidateFunctionArgs) {
  const strip = (url: URL) => {
    const p = new URLSearchParams(url.search);
    p.delete("view");
    return `${url.pathname}?${p.toString()}`;
  };
  if (strip(currentUrl) === strip(nextUrl)) return false;
  return defaultShouldRevalidate;
}

export default function BrowsePage() {
  const t = useT();
  const { favorites, isFavorite } = useFavorites();
  const { players, searchQuery, sortBy, currentPage, totalCount, hasMore, filters, isLoggedIn } =
    useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();
  const [inputValue, setInputValue] = useState(searchQuery);
  // IME 変換中は URL に反映しない（確定後に debounce で反映）
  const [isComposing, setIsComposing] = useState(false);
  // 最後に URL へ反映した（または URL から取り込んだ）検索語。同値の重複ナビゲーションを避ける
  const lastAppliedQuery = useRef(searchQuery);
  const navigation = useNavigation();
  const isNavigating = navigation.state === "loading";

  // 無限スクロール
  const filtersKey = `${searchQuery}|${sortBy}|${filters.roles.join(",")}|${filters.editions.join(",")}|${filters.inputMethods.join(",")}|${filters.platforms.join(",")}`;
  // /api/browse への「もっと読み込む」フェッチ先URLにだけ auth=1 を付与する。CDN は同一URLで
  // cookie変種を区別できないため、ログイン中クライアントのリクエストURL空間を匿名と分離する目印
  // として使う（個人識別子は含めない）。ドキュメント側の URL（アドレスバー・共有リンク）には乗らない。
  const infinite = useInfiniteScroll<(typeof players)[number]>({
    initialItems: players,
    initialPage: currentPage,
    initialHasMore: hasMore,
    endpoint: "/api/browse",
    resetDeps: [filtersKey],
    extraParams: isLoggedIn ? { auth: "1" } : undefined,
  });
  const [isFilterDialogOpen, setIsFilterDialogOpen] = useState(false);
  // 表示形式は URL の ?view=list に保持（既定のカードはパラメータなし）。
  // 切替は履歴を積まない replace で行う（戻るボタンが表示切替で消費されないように）
  const viewMode: "card" | "list" = searchParams.get("view") === "list" ? "list" : "card";
  const setViewMode = (mode: "card" | "list") => {
    const newParams = new URLSearchParams(searchParams);
    if (mode === "list") {
      newParams.set("view", "list");
    } else {
      newParams.delete("view");
    }
    setSearchParams(newParams, { replace: true, preventScrollReset: true });
  };

  // ダイアログ内のドラフト状態（「完了」ボタンで適用）
  const [draftFilters, setDraftFilters] = useState(filters);

  // ダイアログを開くたびに現在の URL フィルタをドラフトに同期
  useEffect(() => {
    if (isFilterDialogOpen) {
      setDraftFilters(filters);
    }
  }, [isFilterDialogOpen, filters]);

  // ダイアログ内の下書き条件でのヒット件数（null = 未取得/失敗 → 従来の「完了」表記）
  const [draftCount, setDraftCount] = useState<number | null>(null);
  const [isCountLoading, setIsCountLoading] = useState(false);
  useEffect(() => {
    if (!isFilterDialogOpen) {
      setDraftCount(null);
      return;
    }
    const controller = new AbortController();
    setIsCountLoading(true);
    const timer = setTimeout(async () => {
      const params = new URLSearchParams({ count: "1" });
      if (searchQuery) params.set("q", searchQuery);
      draftFilters.roles.forEach((v) => params.append("role", v));
      draftFilters.editions.forEach((v) => params.append("edition", v));
      draftFilters.inputMethods.forEach((v) => params.append("input", v));
      draftFilters.platforms.forEach((v) => params.append("platform", v));
      try {
        const res = await fetch(`/api/browse?${params.toString()}`, { signal: controller.signal });
        if (!res.ok) throw new Error(String(res.status));
        const json = (await res.json()) as { total?: unknown };
        if (typeof json.total !== "number") throw new Error("invalid");
        setDraftCount(json.total);
        setIsCountLoading(false);
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
        setDraftCount(null);
        setIsCountLoading(false);
      }
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [isFilterDialogOpen, draftFilters, searchQuery]);

  // アクティブなフィルタ数（適用済み）
  const activeFilterCount = filters.roles.length + filters.editions.length + filters.inputMethods.length + filters.platforms.length;
  // 検索語かロール以外の絞り込みがあるときは、件数を「該当する〜」の文言にする（ロールは文言の出し分けに使う）
  const isNarrowed =
    searchQuery !== "" || filters.editions.length + filters.inputMethods.length + filters.platforms.length > 0;
  const countRole =
    filters.roles.length === 0 || (filters.roles.length === 1 && filters.roles[0] === "runner")
      ? "runner"
      : filters.roles.length === 1
        ? "viewer"
        : "all";
  const countKey = isNarrowed
    ? ({ runner: "browse.matchedCountRunner", viewer: "browse.matchedCountViewer", all: "browse.matchedCountAll" } as const)[countRole]
    : ({ runner: "browse.totalCountRunner", viewer: "browse.totalCountViewer", all: "browse.totalCountAll" } as const)[countRole];

  const handleSortChange = (value: string) => {
    const newParams = new URLSearchParams(searchParams);
    newParams.set("sort", value);
    newParams.delete("page");
    setSearchParams(newParams);
  };

  // q を URL に反映して検索を実行（ページ上の直接操作なので即時反映。入力途中で履歴を
  // 積まないよう replace。連続ナビゲーションは react-router が前のローダーを打ち切る）
  const applySearch = (value: string) => {
    lastAppliedQuery.current = value;
    setSearchParams(
      (prev) => {
        const newParams = new URLSearchParams(prev);
        if (value) {
          newParams.set("q", value);
        } else {
          newParams.delete("q");
        }
        newParams.delete("page");
        return newParams;
      },
      { replace: true, preventScrollReset: true },
    );
  };

  // 入力の debounce 反映（IME 変換中は待つ）
  useEffect(() => {
    if (isComposing || inputValue === lastAppliedQuery.current) return;
    const timer = setTimeout(() => applySearch(inputValue), 400);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputValue, isComposing]);

  // 戻る/進む等、自分以外の要因で URL の q が変わったら入力欄へ取り込む
  useEffect(() => {
    if (searchQuery !== lastAppliedQuery.current) {
      lastAppliedQuery.current = searchQuery;
      setInputValue(searchQuery);
    }
  }, [searchQuery]);

  // Enter／検索ボタン: debounce を待たず即時反映
  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (inputValue !== lastAppliedQuery.current) applySearch(inputValue);
  };

  // 適用済みフィルタを直接URLから操作（フィルタチップの×ボタン用）
  const handleFilterChange = (key: string, value: string, checked: boolean) => {
    const newParams = new URLSearchParams(searchParams);

    // 現在の値を取得
    const currentValues = newParams.getAll(key);

    // すべて削除
    newParams.delete(key);

    if (checked) {
      // 追加（既存の値 + 新しい値）
      [...currentValues, value].forEach(v => newParams.append(key, v));
    } else {
      // 削除（新しい値以外を保持）
      currentValues.filter(v => v !== value).forEach(v => newParams.append(key, v));
    }

    newParams.delete("page");
    setSearchParams(newParams);
  };

  // ドラフトフィルタの操作（ダイアログ内のチェックボックス用、URL は変更しない）
  const handleDraftFilterChange = (key: keyof typeof draftFilters, value: string, checked: boolean) => {
    setDraftFilters((prev) => {
      const list = prev[key] as string[];
      if (checked) {
        if (list.includes(value)) return prev;
        return { ...prev, [key]: [...list, value] };
      }
      return { ...prev, [key]: list.filter((v) => v !== value) };
    });
  };

  // 「完了」: ドラフトを URL に反映
  const applyDraftFilters = () => {
    const newParams = new URLSearchParams(searchParams);
    newParams.delete("role");
    newParams.delete("edition");
    newParams.delete("input");
    newParams.delete("platform");
    draftFilters.roles.forEach((v) => newParams.append("role", v));
    draftFilters.editions.forEach((v) => newParams.append("edition", v));
    draftFilters.inputMethods.forEach((v) => newParams.append("input", v));
    draftFilters.platforms.forEach((v) => newParams.append("platform", v));
    newParams.delete("page");
    setSearchParams(newParams);
    setIsFilterDialogOpen(false);
  };

  // 「すべてクリア」: ドラフトをクリア（適用は完了ボタン）
  const clearDraftFilters = () => {
    setDraftFilters({ roles: [], editions: [], inputMethods: [], platforms: [] });
  };

  return (
    <div className="space-y-6">
      {/* ヘッダー */}
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Users className="h-6 w-6" />
          {t("browse.title")}
        </h1>
        <p className="text-sm text-muted-foreground">
          {t(countKey, { count: totalCount })}
        </p>
        {/* 並びの優先はログイン中だけに効く。お気に入りが1人以上いるときだけ理由を示す */}
        {isLoggedIn && favorites.length > 0 && (
          // 狭い画面で2行に折り返したときもハートは1行目に揃える（items-start + 行高 20px に対する 3px 下げ）
          <FavoritesFirstNote className="mt-2">{t("browse.favoritesFirstNote")}</FavoritesFirstNote>
        )}
      </div>

      {/* 検索・フィルタ・ソート */}
      <div className="flex flex-col gap-4">
        <div className="flex flex-col sm:flex-row gap-4">
          <Form onSubmit={handleSearch} className="flex-1">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  type="search"
                  placeholder={t("browse.searchPlaceholder")}
                  aria-label={t("browse.searchAria")}
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  onCompositionStart={() => setIsComposing(true)}
                  onCompositionEnd={() => setIsComposing(false)}
                  className="pl-10"
                />
              </div>
              <Button type="submit">
                <Search className="mr-2 h-4 w-4" />
                {t("common.search")}
              </Button>
            </div>
          </Form>
          <div className="flex items-center gap-2 flex-wrap">
            {/* フィルタ */}
            <Dialog open={isFilterDialogOpen} onOpenChange={setIsFilterDialogOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" className="gap-2">
                  <Filter className="h-4 w-4" />
                  {t("browse.filter")}
                  {activeFilterCount > 0 && (
                    <Badge variant="secondary" className="ml-1 px-1.5 py-0 text-xs">
                      {activeFilterCount}
                    </Badge>
                  )}
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-md">
                <DialogHeader>
                  <DialogTitle>{t("browse.filterTitle")}</DialogTitle>
                  <DialogDescription>
                    {t("browse.filterDescription")}
                  </DialogDescription>
                </DialogHeader>

                <div className="space-y-6 py-4">
                  {/* ロール */}
                  <div className="space-y-3">
                    <div className="text-sm font-medium">{t("browse.role")}</div>
                    {draftFilters.roles.length === 0 && (
                      <p className="text-xs text-muted-foreground">{t("browse.roleDefaultNote")}</p>
                    )}
                    <div className="space-y-2">
                      <div className="flex items-center space-x-2">
                        <Checkbox
                          id="role-runner"
                          checked={draftFilters.roles.includes("runner")}
                          onCheckedChange={(checked) => {
                            handleDraftFilterChange("roles", "runner", !!checked);
                          }}
                        />
                        <RadixLabel htmlFor="role-runner" className="cursor-pointer">{t("browse.roleRunner")}</RadixLabel>
                      </div>
                      <div className="flex items-center space-x-2">
                        <Checkbox
                          id="role-viewer"
                          checked={draftFilters.roles.includes("viewer")}
                          onCheckedChange={(checked) => {
                            handleDraftFilterChange("roles", "viewer", !!checked);
                          }}
                        />
                        <RadixLabel htmlFor="role-viewer" className="cursor-pointer">{t("browse.roleViewer")}</RadixLabel>
                      </div>
                    </div>
                  </div>

                  {/* エディション */}
                  <div className="space-y-3">
                    <div className="text-sm font-medium">{t("browse.edition")}</div>
                    <div className="space-y-2">
                      <div className="flex items-center space-x-2">
                        <Checkbox
                          id="edition-java"
                          checked={draftFilters.editions.includes("java")}
                          onCheckedChange={(checked) => {
                            handleDraftFilterChange("editions", "java", !!checked);
                          }}
                        />
                        <RadixLabel htmlFor="edition-java" className="cursor-pointer">{t("browse.editionJava")}</RadixLabel>
                      </div>
                      <div className="flex items-center space-x-2">
                        <Checkbox
                          id="edition-bedrock"
                          checked={draftFilters.editions.includes("bedrock")}
                          onCheckedChange={(checked) => {
                            handleDraftFilterChange("editions", "bedrock", !!checked);
                          }}
                        />
                        <RadixLabel htmlFor="edition-bedrock" className="cursor-pointer">{t("browse.editionBedrock")}</RadixLabel>
                      </div>
                    </div>
                  </div>

                  {/* プラットフォーム */}
                  <div className="space-y-3">
                    <div className="text-sm font-medium">{t("browse.platform")}</div>
                    <div className="space-y-2">
                      <div className="flex items-center space-x-2">
                        <Checkbox
                          id="platform-windows"
                          checked={draftFilters.platforms.includes("pc_windows")}
                          onCheckedChange={(checked) => {
                            handleDraftFilterChange("platforms", "pc_windows", !!checked);
                          }}
                        />
                        <RadixLabel htmlFor="platform-windows" className="cursor-pointer">Windows</RadixLabel>
                      </div>
                      <div className="flex items-center space-x-2">
                        <Checkbox
                          id="platform-mac"
                          checked={draftFilters.platforms.includes("pc_mac")}
                          onCheckedChange={(checked) => {
                            handleDraftFilterChange("platforms", "pc_mac", !!checked);
                          }}
                        />
                        <RadixLabel htmlFor="platform-mac" className="cursor-pointer">Mac</RadixLabel>
                      </div>
                      <div className="flex items-center space-x-2">
                        <Checkbox
                          id="platform-linux"
                          checked={draftFilters.platforms.includes("pc_linux")}
                          onCheckedChange={(checked) => {
                            handleDraftFilterChange("platforms", "pc_linux", !!checked);
                          }}
                        />
                        <RadixLabel htmlFor="platform-linux" className="cursor-pointer">Linux</RadixLabel>
                      </div>
                      <div className="flex items-center space-x-2">
                        <Checkbox
                          id="platform-switch"
                          checked={draftFilters.platforms.includes("switch")}
                          onCheckedChange={(checked) => {
                            handleDraftFilterChange("platforms", "switch", !!checked);
                          }}
                        />
                        <RadixLabel htmlFor="platform-switch" className="cursor-pointer">Switch</RadixLabel>
                      </div>
                      <div className="flex items-center space-x-2">
                        <Checkbox
                          id="platform-mobile"
                          checked={draftFilters.platforms.includes("mobile")}
                          onCheckedChange={(checked) => {
                            handleDraftFilterChange("platforms", "mobile", !!checked);
                          }}
                        />
                        <RadixLabel htmlFor="platform-mobile" className="cursor-pointer">Mobile</RadixLabel>
                      </div>
                      <div className="flex items-center space-x-2">
                        <Checkbox
                          id="platform-other"
                          checked={draftFilters.platforms.includes("other")}
                          onCheckedChange={(checked) => {
                            handleDraftFilterChange("platforms", "other", !!checked);
                          }}
                        />
                        <RadixLabel htmlFor="platform-other" className="cursor-pointer">{t("browse.platformOther")}</RadixLabel>
                      </div>
                    </div>
                  </div>

                  {/* 入力方法 */}
                  <div className="space-y-3">
                    <div className="text-sm font-medium">{t("browse.inputMethod")}</div>
                    <div className="space-y-2">
                      <div className="flex items-center space-x-2">
                        <Checkbox
                          id="input-kbm"
                          checked={draftFilters.inputMethods.includes("keyboard_mouse")}
                          onCheckedChange={(checked) => {
                            handleDraftFilterChange("inputMethods", "keyboard_mouse", !!checked);
                          }}
                        />
                        <RadixLabel htmlFor="input-kbm" className="cursor-pointer">{t("browse.inputKeyboardMouse")}</RadixLabel>
                      </div>
                      <div className="flex items-center space-x-2">
                        <Checkbox
                          id="input-controller"
                          checked={draftFilters.inputMethods.includes("controller")}
                          onCheckedChange={(checked) => {
                            handleDraftFilterChange("inputMethods", "controller", !!checked);
                          }}
                        />
                        <RadixLabel htmlFor="input-controller" className="cursor-pointer">{t("browse.inputController")}</RadixLabel>
                      </div>
                      <div className="flex items-center space-x-2">
                        <Checkbox
                          id="input-touch"
                          checked={draftFilters.inputMethods.includes("touch")}
                          onCheckedChange={(checked) => {
                            handleDraftFilterChange("inputMethods", "touch", !!checked);
                          }}
                        />
                        <RadixLabel htmlFor="input-touch" className="cursor-pointer">{t("browse.inputTouch")}</RadixLabel>
                      </div>
                    </div>
                  </div>
                </div>

                <DialogFooter className="flex-col sm:flex-row gap-2">
                  {(draftFilters.roles.length + draftFilters.editions.length + draftFilters.inputMethods.length + draftFilters.platforms.length) > 0 && (
                    <Button
                      variant="outline"
                      className="w-full sm:w-auto"
                      onClick={clearDraftFilters}
                    >
                      <X className="h-4 w-4 mr-2" />
                      {t("common.clearAll")}
                    </Button>
                  )}
                  <Button
                    className="w-full sm:w-auto"
                    onClick={applyDraftFilters}
                  >
                    <span
                      className={cn(isCountLoading && draftCount !== null && "opacity-60")}
                      aria-live="polite"
                    >
                      {draftCount === null
                        ? isCountLoading
                          ? "…"
                          : t("common.complete")
                        : draftCount === 0
                          ? t("browse.showCountNone")
                          : t("browse.showCount", { count: draftCount })}
                    </span>
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            {/* ソート */}
            <ArrowUpDown className="h-4 w-4 text-muted-foreground" aria-hidden />
            <Select value={sortBy} onValueChange={handleSortChange}>
              <SelectTrigger className="w-[140px]" aria-label={t("contentSort.label")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="updatedAt">{t("browse.sortUpdatedAt")}</SelectItem>
                <SelectItem value="popular">{t("browse.sortPopular")}</SelectItem>
                <SelectItem value="mcid">{t("browse.sortMcid")}</SelectItem>
                <SelectItem value="displayName">{t("browse.sortDisplayName")}</SelectItem>
              </SelectContent>
            </Select>
            <ViewToggle viewMode={viewMode} onChange={setViewMode} />
          </div>
        </div>

        {/* 人気順の基準（閲覧数そのものは出さない） */}
        {sortBy === "popular" && (
          <p className="text-xs text-muted-foreground">
            {t("contentSort.popularDesc", { days: PAGE_VIEW_WINDOW_DAYS })}
          </p>
        )}

        {/* アクティブフィルタの表示 */}
        {activeFilterCount > 0 && (
          <div className="flex flex-wrap gap-2">
            {filters.roles.map((role) => (
              <Badge key={role} variant="secondary" className="gap-1 overflow-visible">
                {roleLabels(t)[role]}
                <button
                  onClick={() => handleFilterChange("role", role, false)}
                  aria-label={t("browse.removeFilterAria", { label: roleLabels(t)[role] })}
                  className="relative ml-1 -m-0.5 rounded p-0.5 hover:text-destructive before:absolute before:-inset-1 before:content-['']"
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            ))}
            {filters.editions.map((edition) => (
              <Badge key={edition} variant="secondary" className="gap-1 overflow-visible">
                {editionLabels(t)[edition]}
                <button
                  onClick={() => handleFilterChange("edition", edition, false)}
                  aria-label={t("browse.removeFilterAria", { label: editionLabels(t)[edition] })}
                  className="relative ml-1 -m-0.5 rounded p-0.5 hover:text-destructive before:absolute before:-inset-1 before:content-['']"
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            ))}
            {filters.platforms.map((platform) => (
              <Badge key={platform} variant="secondary" className="gap-1 overflow-visible">
                {platformLabel(t, platform, "short")}
                <button
                  onClick={() => handleFilterChange("platform", platform, false)}
                  aria-label={t("browse.removeFilterAria", { label: platformLabel(t, platform, "short") ?? platform })}
                  className="relative ml-1 -m-0.5 rounded p-0.5 hover:text-destructive before:absolute before:-inset-1 before:content-['']"
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            ))}
            {filters.inputMethods.map((inputMethod) => (
              <Badge key={inputMethod} variant="secondary" className="gap-1 overflow-visible">
                {inputMethodLabels(t)[inputMethod]}
                <button
                  onClick={() => handleFilterChange("input", inputMethod, false)}
                  aria-label={t("browse.removeFilterAria", { label: inputMethodLabels(t)[inputMethod] })}
                  className="relative ml-1 -m-0.5 rounded p-0.5 hover:text-destructive before:absolute before:-inset-1 before:content-['']"
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            ))}
          </div>
        )}
      </div>

      {/* 走者一覧。検索語は入力中に即時反映するため、読み込み中も表示中の一覧は残して薄くする
          （入力のたびにスケルトンへ切り替えるとちらつく）。表示中の一覧が無いときだけスケルトン */}
      {isNavigating && infinite.items.length === 0 ? (
        viewMode === "card" ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 12 }).map((_, i) => (
              <ProfileFeedCardSkeleton key={i} />
            ))}
          </div>
        ) : (
          <div className="space-y-1">
            {Array.from({ length: 12 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 py-3 px-1">
                <Skeleton className="h-9 w-9 rounded-xl shrink-0" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-3 w-48" />
                </div>
              </div>
            ))}
          </div>
        )
      ) : infinite.items.length > 0 ? (
        viewMode === "card" ? (
          <div
            aria-busy={isNavigating}
            className={cn(
              "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 transition-opacity",
              isNavigating && "opacity-60",
            )}
          >
            {infinite.items.map((player) => (
              <ProfileFeedCard key={player.slug} player={player} isFavorite={isFavorite(player.slug)} />
            ))}
          </div>
        ) : (
          <div
            aria-busy={isNavigating}
            className={cn("divide-y transition-opacity", isNavigating && "opacity-60")}
          >
            {infinite.items.map((player) => (
              <ProfileFeedListItem key={player.slug} player={player} isFavorite={isFavorite(player.slug)} />
            ))}
          </div>
        )
      ) : (
        <EmptyState
          icon={<Users className="h-12 w-12" />}
          title={
            searchQuery || activeFilterCount > 0
              ? t("browse.emptyFiltered")
              : t("browse.emptyAll")
          }
          description={
            searchQuery || activeFilterCount > 0
              ? t("browse.emptyFilteredHint")
              : t("browse.emptyAllHint")
          }
          action={
            (searchQuery || activeFilterCount > 0) && (
              <Button
                variant="outline"
                className="mt-4"
                onClick={() => {
                  setInputValue("");
                  lastAppliedQuery.current = "";
                  const newParams = new URLSearchParams();
                  if (sortBy !== "updatedAt") {
                    newParams.set("sort", sortBy);
                  }
                  setSearchParams(newParams);
                }}
              >
                {t("common.resetFilters")}
              </Button>
            )
          }
        />
      )}

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
            {infinite.isLoadingMore && (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
            )}
            {t("browse.loadMore")}
          </Button>
        </div>
      )}
      {infinite.items.length > 0 && !infinite.hasMore && totalCount > 0 && (
        <p className="text-center text-sm text-muted-foreground py-6">
          {t("browse.allShown", { count: totalCount })}
        </p>
      )}
    </div>
  );
}
