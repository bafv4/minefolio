import { createTranslator } from "@/lib/messages";
import { useLoaderData, useSearchParams, useNavigation, Form } from "react-router";
import { useState, useEffect } from "react";
import type { Route } from "./+types/browse";
import { createDb } from "@/lib/db";
import { getEnv } from "@/lib/env.server";
import { ProfileFeedCard, ProfileFeedListItem, PlayerViewToggle } from "@/components/profile-feed-card";
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
import { useInfiniteScroll } from "@/hooks/use-infinite-scroll";
import { useT } from "@/hooks/use-locale";
import type { Translator } from "@/lib/messages";
import { localeFromMatches } from "@/lib/locale";

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
  const favoriteSlugs = await getViewerFavoriteSlugs(
    db,
    session?.user?.id ?? null,
  );
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

function PlayerCardSkeleton() {
  const t = useT();
  return (
    <div className="border border-border/70 rounded-xl p-3">
      <div className="flex items-center gap-3">
        <Skeleton className="w-12 h-12 rounded-xl shrink-0" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-3 w-40" />
        </div>
      </div>
    </div>
  );
}

// フィルタラベル
// ラベルは描画時に t() で解決する（モジュール評価時はロケールが未確定）
const roleLabels = (t: Translator): Record<string, string> => ({
  runner: t("browse.roleRunner"),
  viewer: t("browse.roleViewer"),
});
const EDITION_LABELS: Record<string, string> = {
  java: "Java",
  bedrock: "Bedrock",
};
const INPUT_METHOD_LABELS: Record<string, string> = {
  keyboard_mouse: "KBM",
  controller: "Controller",
  touch: "Touch",
};
const platformLabels = (t: Translator): Record<string, string> => ({
  pc_windows: "Windows",
  pc_mac: "Mac",
  pc_linux: "Linux",
  switch: "Switch",
  mobile: "Mobile",
  other: t("browse.platformOther"),
});

export default function BrowsePage() {
  const t = useT();
  const { players, searchQuery, sortBy, currentPage, totalPages, totalCount, hasMore, filters, isLoggedIn } =
    useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();
  const [inputValue, setInputValue] = useState(searchQuery);
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
  const [viewMode, setViewMode] = useState<"card" | "list">("card");

  // ダイアログ内のドラフト状態（「完了」ボタンで適用）
  const [draftFilters, setDraftFilters] = useState(filters);

  // ダイアログを開くたびに現在の URL フィルタをドラフトに同期
  useEffect(() => {
    if (isFilterDialogOpen) {
      setDraftFilters(filters);
    }
  }, [isFilterDialogOpen, filters]);

  // アクティブなフィルタ数（適用済み）
  const activeFilterCount = filters.roles.length + filters.editions.length + filters.inputMethods.length + filters.platforms.length;

  const handleSortChange = (value: string) => {
    const newParams = new URLSearchParams(searchParams);
    newParams.set("sort", value);
    newParams.delete("page");
    setSearchParams(newParams);
  };

  // q を URL に反映して検索を実行
  const applySearch = (value: string) => {
    const newParams = new URLSearchParams(searchParams);
    if (value) {
      newParams.set("q", value);
    } else {
      newParams.delete("q");
    }
    newParams.delete("page");
    setSearchParams(newParams);
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    applySearch(inputValue);
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

  const goToPage = (page: number) => {
    const newParams = new URLSearchParams(searchParams);
    newParams.set("page", page.toString());
    setSearchParams(newParams);
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
          {`${t("browse.totalCount")} (${totalCount}${t("common.peopleUnit")})`}
        </p>
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
                  aria-label="走者を検索"
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  className="pl-10"
                />
              </div>
              <Button type="submit">
                <Search className="mr-2 h-4 w-4" />
                検索
              </Button>
            </div>
          </Form>
          <div className="flex items-center gap-2 flex-wrap">
            {/* フィルタ */}
            <Dialog open={isFilterDialogOpen} onOpenChange={setIsFilterDialogOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" className="gap-2">
                  <Filter className="h-4 w-4" />
                  フィルタ
                  {activeFilterCount > 0 && (
                    <Badge variant="secondary" className="ml-1 px-1.5 py-0 text-xs">
                      {activeFilterCount}
                    </Badge>
                  )}
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-md">
                <DialogHeader>
                  <DialogTitle>絞り込み</DialogTitle>
                  <DialogDescription>
                    {t("browse.filterDescription")}
                  </DialogDescription>
                </DialogHeader>

                <div className="space-y-6 py-4">
                  {/* ロール */}
                  <div className="space-y-3">
                    <div className="text-sm font-medium">ロール</div>
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
                    <div className="text-sm font-medium">エディション</div>
                    <div className="space-y-2">
                      <div className="flex items-center space-x-2">
                        <Checkbox
                          id="edition-java"
                          checked={draftFilters.editions.includes("java")}
                          onCheckedChange={(checked) => {
                            handleDraftFilterChange("editions", "java", !!checked);
                          }}
                        />
                        <RadixLabel htmlFor="edition-java" className="cursor-pointer">Java Edition</RadixLabel>
                      </div>
                      <div className="flex items-center space-x-2">
                        <Checkbox
                          id="edition-bedrock"
                          checked={draftFilters.editions.includes("bedrock")}
                          onCheckedChange={(checked) => {
                            handleDraftFilterChange("editions", "bedrock", !!checked);
                          }}
                        />
                        <RadixLabel htmlFor="edition-bedrock" className="cursor-pointer">Bedrock Edition</RadixLabel>
                      </div>
                    </div>
                  </div>

                  {/* プラットフォーム */}
                  <div className="space-y-3">
                    <div className="text-sm font-medium">プラットフォーム</div>
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
                        <RadixLabel htmlFor="platform-other" className="cursor-pointer">その他</RadixLabel>
                      </div>
                    </div>
                  </div>

                  {/* 入力方法 */}
                  <div className="space-y-3">
                    <div className="text-sm font-medium">入力方法</div>
                    <div className="space-y-2">
                      <div className="flex items-center space-x-2">
                        <Checkbox
                          id="input-kbm"
                          checked={draftFilters.inputMethods.includes("keyboard_mouse")}
                          onCheckedChange={(checked) => {
                            handleDraftFilterChange("inputMethods", "keyboard_mouse", !!checked);
                          }}
                        />
                        <RadixLabel htmlFor="input-kbm" className="cursor-pointer">キーボード/マウス</RadixLabel>
                      </div>
                      <div className="flex items-center space-x-2">
                        <Checkbox
                          id="input-controller"
                          checked={draftFilters.inputMethods.includes("controller")}
                          onCheckedChange={(checked) => {
                            handleDraftFilterChange("inputMethods", "controller", !!checked);
                          }}
                        />
                        <RadixLabel htmlFor="input-controller" className="cursor-pointer">コントローラー</RadixLabel>
                      </div>
                      <div className="flex items-center space-x-2">
                        <Checkbox
                          id="input-touch"
                          checked={draftFilters.inputMethods.includes("touch")}
                          onCheckedChange={(checked) => {
                            handleDraftFilterChange("inputMethods", "touch", !!checked);
                          }}
                        />
                        <RadixLabel htmlFor="input-touch" className="cursor-pointer">タッチ</RadixLabel>
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
                      すべてクリア
                    </Button>
                  )}
                  <Button
                    className="w-full sm:w-auto"
                    onClick={applyDraftFilters}
                  >
                    完了
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            {/* ソート */}
            <ArrowUpDown className="h-4 w-4 text-muted-foreground" />
            <Select value={sortBy} onValueChange={handleSortChange}>
              <SelectTrigger className="w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="updatedAt">更新日順</SelectItem>
                <SelectItem value="mcid">MCID順</SelectItem>
                <SelectItem value="displayName">名前順</SelectItem>
              </SelectContent>
            </Select>
            <PlayerViewToggle viewMode={viewMode} onChange={setViewMode} />
          </div>
        </div>

        {/* アクティブフィルタの表示 */}
        {activeFilterCount > 0 && (
          <div className="flex flex-wrap gap-2">
            {filters.roles.map((role) => (
              <Badge key={role} variant="secondary" className="gap-1">
                {roleLabels(t)[role]}
                <button
                  onClick={() => handleFilterChange("role", role, false)}
                  className="ml-1 hover:text-destructive"
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            ))}
            {filters.editions.map((edition) => (
              <Badge key={edition} variant="secondary" className="gap-1">
                {EDITION_LABELS[edition]}
                <button
                  onClick={() => handleFilterChange("edition", edition, false)}
                  className="ml-1 hover:text-destructive"
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            ))}
            {filters.platforms.map((platform) => (
              <Badge key={platform} variant="secondary" className="gap-1">
                {platformLabels(t)[platform]}
                <button
                  onClick={() => handleFilterChange("platform", platform, false)}
                  className="ml-1 hover:text-destructive"
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            ))}
            {filters.inputMethods.map((inputMethod) => (
              <Badge key={inputMethod} variant="secondary" className="gap-1">
                {INPUT_METHOD_LABELS[inputMethod]}
                <button
                  onClick={() => handleFilterChange("input", inputMethod, false)}
                  className="ml-1 hover:text-destructive"
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            ))}
          </div>
        )}
      </div>

      {/* 走者一覧 */}
      {isNavigating ? (
        viewMode === "card" ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 12 }).map((_, i) => (
              <PlayerCardSkeleton key={i} />
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
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {infinite.items.map((player) => (
              <ProfileFeedCard key={player.slug} player={player} />
            ))}
          </div>
        ) : (
          <div className="divide-y">
            {infinite.items.map((player) => (
              <ProfileFeedListItem key={player.slug} player={player} />
            ))}
          </div>
        )
      ) : (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
          <Users className="h-12 w-12 mx-auto mb-4 opacity-30" />
          <p className="text-lg mb-2">
            {searchQuery || activeFilterCount > 0
              ? t("browse.emptyFiltered")
              : t("browse.emptyAll")}
          </p>
          {(searchQuery || activeFilterCount > 0) && (
            <Button
              variant="outline"
              onClick={() => {
                setInputValue("");
                const newParams = new URLSearchParams();
                if (sortBy !== "updatedAt") {
                  newParams.set("sort", sortBy);
                }
                setSearchParams(newParams);
              }}
            >
              検索・フィルタをクリア
            </Button>
          )}
        </div>
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
            もっと読み込む
          </Button>
        </div>
      )}
      {infinite.items.length > 0 && !infinite.hasMore && totalCount > 0 && (
        <p className="text-center text-sm text-muted-foreground py-6">
          すべての走者を表示しました ({totalCount} 件)
        </p>
      )}
    </div>
  );
}
