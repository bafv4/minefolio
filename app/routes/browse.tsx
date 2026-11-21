import { createTranslator } from "@/lib/messages";
import { useLoaderData, useSearchParams, useNavigation, Form, Link, type ShouldRevalidateFunctionArgs } from "react-router";
import { useState, useEffect, useRef, type ReactNode } from "react";
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
import { Search, Users, ArrowUpDown, Loader2, Filter, X, Shuffle } from "lucide-react";
import { createAuth } from "@/lib/auth";
import { getOptionalSession } from "@/lib/session";
import {
  loadBrowsePage,
  parseBrowseSearchParams,
  getViewerFavoriteSlugs,
} from "@/lib/browse-query.server";
import { PAGE_VIEW_WINDOW_DAYS } from "@/lib/page-view-paths";
import { FeedErrorNotice } from "@/components/home/feed-error-notice";
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
    // /random-player が該当者なしで戻してきたとき（理由を一文で知らせる）
    randomNone: url.searchParams.get("random") === "none",
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

/**
 * 絞り込みダイアログの1行（チェックボックス＋ラベル）。行全体を label で包み、モバイルは高さ 44px 全体を押せるようにする
 */
function FilterCheckboxRow({
  id,
  checked,
  onCheckedChange,
  children,
}: {
  id: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  children: ReactNode;
}) {
  return (
    <label
      htmlFor={id}
      className="-mx-2 flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-2 text-sm hover:bg-muted/50 sm:min-h-9"
    >
      <Checkbox id={id} checked={checked} onCheckedChange={(value) => onCheckedChange(value === true)} />
      <span>{children}</span>
    </label>
  );
}

export default function BrowsePage() {
  const t = useT();
  const { favorites, isFavorite } = useFavorites();
  const { players, searchQuery, sortBy, currentPage, totalCount, hasMore, filters, isLoggedIn, randomNone } =
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
    // ほかの操作（並び替え・検索・絞り込み）と同じく、ランダムの「該当者なし」の知らせは次の操作で消す
    newParams.delete("random");
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

  const showFavoritesNote =
    isLoggedIn && favorites.length > 0 && infinite.items.some((p) => isFavorite(p.slug));
  const sortLabels: Record<string, string> = {
    updatedAt: t("browse.sortUpdatedAt"),
    popular: t("browse.sortPopular"),
    mcid: t("browse.sortMcid"),
    displayName: t("browse.sortDisplayName"),
  };

  const handleSortChange = (value: string) => {
    const newParams = new URLSearchParams(searchParams);
    newParams.set("sort", value);
    newParams.delete("random");
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
        newParams.delete("random");
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

    newParams.delete("random");
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
    newParams.delete("random");
    newParams.delete("page");
    setSearchParams(newParams);
    setIsFilterDialogOpen(false);
  };

  // 「すべてクリア」: ドラフトをクリア（適用は完了ボタン）
  const clearDraftFilters = () => {
    setDraftFilters({ roles: [], editions: [], inputMethods: [], platforms: [] });
  };

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* ヘッダー */}
      <div>
        <div className="flex items-center justify-between gap-x-4 gap-y-2">
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Users className="h-6 w-6" aria-hidden />
            {t("browse.title")}
          </h1>
          {/* 副次の操作: ランダムな走者のプロフィールへ（/random-player はリダイレクトだけのリソースルートなので文書ごと読み込む） */}
          <Button variant="outline" size="sm" asChild className="min-h-11 min-w-11 md:min-h-9 md:min-w-0">
            <Link to="/random-player" reloadDocument>
              <Shuffle className="h-4 w-4" aria-hidden="true" />
              <span className="sr-only md:not-sr-only">{t("browse.randomRunner")}</span>
            </Link>
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          {t(countKey, { count: totalCount })}
        </p>
        {randomNone && (
          <p role="status" className="mt-2 text-sm text-muted-foreground">
            {t("browse.randomNone")}
          </p>
        )}
        {/* 並びの優先はログイン中だけに効く。お気に入りが1人以上いるときだけ理由を示す */}
        {/* 表示中の一覧にお気に入りがいるときだけ（いない結果で理由を示しても意味が無い）。md 未満は1行の text-xs */}
        {showFavoritesNote && (
          <FavoritesFirstNote compactOnMobile className="mt-1 sm:mt-2">
            {t("browse.favoritesFirstNote")}
          </FavoritesFirstNote>
        )}
      </div>

      {/* 検索・フィルタ・ソート */}
      <div className="flex flex-col gap-3 sm:gap-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:gap-4">
          <Form onSubmit={handleSearch} className="flex-1">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden />
                <Input
                  type="search"
                  placeholder={t("browse.searchPlaceholder")}
                  aria-label={t("browse.searchAria")}
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  onCompositionStart={() => setIsComposing(true)}
                  onCompositionEnd={() => setIsComposing(false)}
                  className="h-11 pl-10 sm:h-9"
                />
              </div>
              {/* モバイルは Enter（と debounce）で送れるので検索ボタンを出さない */}
              <Button type="submit" className="hidden sm:inline-flex sm:min-h-9">
                <Search className="mr-2 h-4 w-4" aria-hidden />
                {t("common.search")}
              </Button>
            </div>
          </Form>
          <div className="flex items-center gap-2">
            {/* フィルタ */}
            <Dialog open={isFilterDialogOpen} onOpenChange={setIsFilterDialogOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" className="min-h-11 gap-2 sm:min-h-9">
                  <Filter className="h-4 w-4" aria-hidden />
                  {/* 375px では並び順の文言が切れないよう、アイコンだけにして文字は sr-only で残す */}
                  <span className="max-sm:sr-only">{t("browse.filter")}</span>
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

                <div className="space-y-5 py-2">
                  {/* ロール */}
                  <div className="space-y-3">
                    <div className="text-sm font-medium">{t("browse.role")}</div>
                    {draftFilters.roles.length === 0 && (
                      <p className="text-xs text-muted-foreground">{t("browse.roleDefaultNote")}</p>
                    )}
                    <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
                      <FilterCheckboxRow id="role-runner" checked={draftFilters.roles.includes("runner")} onCheckedChange={(checked) => handleDraftFilterChange("roles", "runner", checked)}>
                        {t("browse.roleRunner")}
                      </FilterCheckboxRow>
                      <FilterCheckboxRow id="role-viewer" checked={draftFilters.roles.includes("viewer")} onCheckedChange={(checked) => handleDraftFilterChange("roles", "viewer", checked)}>
                        {t("browse.roleViewer")}
                      </FilterCheckboxRow>
                    </div>
                  </div>

                  {/* エディション */}
                  <div className="space-y-3">
                    <div className="text-sm font-medium">{t("browse.edition")}</div>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
                      <FilterCheckboxRow id="edition-java" checked={draftFilters.editions.includes("java")} onCheckedChange={(checked) => handleDraftFilterChange("editions", "java", checked)}>
                        {t("browse.editionJava")}
                      </FilterCheckboxRow>
                      <FilterCheckboxRow id="edition-bedrock" checked={draftFilters.editions.includes("bedrock")} onCheckedChange={(checked) => handleDraftFilterChange("editions", "bedrock", checked)}>
                        {t("browse.editionBedrock")}
                      </FilterCheckboxRow>
                    </div>
                  </div>

                  {/* プラットフォーム */}
                  <div className="space-y-3">
                    <div className="text-sm font-medium">{t("browse.platform")}</div>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
                      <FilterCheckboxRow id="platform-windows" checked={draftFilters.platforms.includes("pc_windows")} onCheckedChange={(checked) => handleDraftFilterChange("platforms", "pc_windows", checked)}>
                        Windows
                      </FilterCheckboxRow>
                      <FilterCheckboxRow id="platform-mac" checked={draftFilters.platforms.includes("pc_mac")} onCheckedChange={(checked) => handleDraftFilterChange("platforms", "pc_mac", checked)}>
                        Mac
                      </FilterCheckboxRow>
                      <FilterCheckboxRow id="platform-linux" checked={draftFilters.platforms.includes("pc_linux")} onCheckedChange={(checked) => handleDraftFilterChange("platforms", "pc_linux", checked)}>
                        Linux
                      </FilterCheckboxRow>
                      <FilterCheckboxRow id="platform-switch" checked={draftFilters.platforms.includes("switch")} onCheckedChange={(checked) => handleDraftFilterChange("platforms", "switch", checked)}>
                        Switch
                      </FilterCheckboxRow>
                      <FilterCheckboxRow id="platform-mobile" checked={draftFilters.platforms.includes("mobile")} onCheckedChange={(checked) => handleDraftFilterChange("platforms", "mobile", checked)}>
                        {t("meEdit.mobile")}
                      </FilterCheckboxRow>
                      <FilterCheckboxRow id="platform-other" checked={draftFilters.platforms.includes("other")} onCheckedChange={(checked) => handleDraftFilterChange("platforms", "other", checked)}>
                        {t("browse.platformOther")}
                      </FilterCheckboxRow>
                    </div>
                  </div>

                  {/* 入力方法 */}
                  <div className="space-y-3">
                    <div className="text-sm font-medium">{t("browse.inputMethod")}</div>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
                      <FilterCheckboxRow id="input-kbm" checked={draftFilters.inputMethods.includes("keyboard_mouse")} onCheckedChange={(checked) => handleDraftFilterChange("inputMethods", "keyboard_mouse", checked)}>
                        {t("browse.inputKeyboardMouse")}
                      </FilterCheckboxRow>
                      <FilterCheckboxRow id="input-controller" checked={draftFilters.inputMethods.includes("controller")} onCheckedChange={(checked) => handleDraftFilterChange("inputMethods", "controller", checked)}>
                        {t("browse.inputController")}
                      </FilterCheckboxRow>
                      <FilterCheckboxRow id="input-touch" checked={draftFilters.inputMethods.includes("touch")} onCheckedChange={(checked) => handleDraftFilterChange("inputMethods", "touch", checked)}>
                        {t("browse.inputTouch")}
                      </FilterCheckboxRow>
                    </div>
                  </div>
                </div>

                <DialogFooter className="sticky bottom-0 -mx-6 -mb-6 flex-col gap-2 border-t border-border/60 bg-background px-6 py-4 sm:flex-row">
                  {(draftFilters.roles.length + draftFilters.editions.length + draftFilters.inputMethods.length + draftFilters.platforms.length) > 0 && (
                    <Button
                      variant="outline"
                      className="min-h-11 w-full sm:min-h-9 sm:w-auto"
                      onClick={clearDraftFilters}
                    >
                      <X className="h-4 w-4 mr-2" aria-hidden />
                      {t("common.clearAll")}
                    </Button>
                  )}
                  {/* 件数の読み上げはボタンの外で行う（ボタンの名前が「…」に変わったり、チェックのたびに割り込んだりしないよう） */}
                  <span role="status" aria-live="polite" className="sr-only">
                    {draftCount !== null && !isCountLoading
                      ? draftCount === 0
                        ? t("browse.showCountNone")
                        : t("browse.showCount", { count: draftCount })
                      : ""}
                  </span>
                  <Button
                    // 0人のときは「この先は空」と伝わるよう副次の見た目にする（押せる）
                    variant={draftCount === 0 ? "outline" : "default"}
                    className="min-h-11 w-full sm:min-h-9 sm:w-auto"
                    onClick={applyDraftFilters}
                  >
                    <span className={cn(isCountLoading && draftCount !== null && "opacity-60")}>
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
            <ArrowUpDown className="hidden h-4 w-4 text-muted-foreground sm:block" aria-hidden />
            <Select value={sortBy} onValueChange={handleSortChange}>
              <SelectTrigger className="min-h-11 min-w-0 flex-1 sm:min-h-9 sm:w-[140px] sm:flex-none" aria-label={t("contentSort.label")}>
                <SelectValue>{sortLabels[sortBy]}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="updatedAt">{sortLabels.updatedAt}</SelectItem>
                <SelectItem value="popular">{sortLabels.popular}</SelectItem>
                <SelectItem value="mcid">{sortLabels.mcid}</SelectItem>
                <SelectItem value="displayName">{sortLabels.displayName}</SelectItem>
              </SelectContent>
            </Select>
            <ViewToggle viewMode={viewMode} onChange={setViewMode} comfortable />
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
          // × の押せる範囲（上下に 10px 広げる）が次の行のチップに重ならないよう、行の間隔を広めに取る
          <div className="flex flex-wrap gap-x-2 gap-y-4">
            {filters.roles.map((role) => (
              <Badge key={role} variant="secondary" className="gap-1 overflow-visible">
                {roleLabels(t)[role]}
                <button
                  onClick={() => handleFilterChange("role", role, false)}
                  aria-label={t("browse.removeFilterAria", { label: roleLabels(t)[role] })}
                  className="relative ml-1 -m-0.5 rounded p-0.5 hover:bg-foreground/10 before:absolute before:-inset-x-2 before:-inset-y-2.5 before:content-['']"
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
                  className="relative ml-1 -m-0.5 rounded p-0.5 hover:bg-foreground/10 before:absolute before:-inset-x-2 before:-inset-y-2.5 before:content-['']"
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
                  className="relative ml-1 -m-0.5 rounded p-0.5 hover:bg-foreground/10 before:absolute before:-inset-x-2 before:-inset-y-2.5 before:content-['']"
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
                  className="relative ml-1 -m-0.5 rounded p-0.5 hover:bg-foreground/10 before:absolute before:-inset-x-2 before:-inset-y-2.5 before:content-['']"
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
              <ProfileFeedCardSkeleton key={i} surface="card" />
            ))}
          </div>
        ) : (
          <div className="divide-y divide-border/60">
            {Array.from({ length: 12 }).map((_, i) => (
              <div key={i} className="flex min-h-14 items-center gap-3 px-1 py-2">
                <Skeleton className="h-8 w-8 rounded-lg shrink-0" />
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
              <ProfileFeedCard key={player.slug} player={player} isFavorite={isFavorite(player.slug)} surface="card" />
            ))}
          </div>
        ) : (
          <div
            aria-busy={isNavigating}
            className={cn("divide-y divide-border/60 transition-opacity", isNavigating && "opacity-60")}
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
                  // 検索語・絞り込みだけを外す。表示形式（view）と並び順（sort）は引き継ぐ
                  const newParams = new URLSearchParams();
                  if (sortBy !== "updatedAt") {
                    newParams.set("sort", sortBy);
                  }
                  if (viewMode === "list") {
                    newParams.set("view", "list");
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
          {infinite.loadError ? (
            <div className="w-full">
              <FeedErrorNotice message={t("browse.loadMoreFailed")} onRetry={infinite.retry} />
            </div>
          ) : (
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
          )}
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
