import { useLoaderData, useSearchParams, Form, useNavigation } from "react-router";
import { useState } from "react";
import type { Route } from "./+types/browse";
import { createDb } from "@/lib/db";
import { getEnv } from "@/lib/env.server";
import { users } from "@/lib/schema";
import { eq, desc, asc, like, sql, or, and, isNotNull } from "drizzle-orm";
import { PlayerCard } from "@/components/player-card";
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
import { getFavoritesFromCookie } from "@/lib/favorites";

export const meta: Route.MetaFunction = () => {
  return [
    { title: "探す - Minefolio" },
    {
      name: "description",
      content: "RTA走者を探す",
    },
  ];
};

const ITEMS_PER_PAGE = 12;

type SortOption = "updatedAt" | "mcid" | "displayName";

// フィルタオプションの型
type FilterRole = "runner" | "viewer";
type FilterEdition = "java" | "bedrock";
type FilterInputMethod = "keyboard_mouse" | "controller" | "touch";
type FilterPlatform = "pc_windows" | "pc_mac" | "pc_linux" | "switch" | "mobile" | "other";

export async function loader({ context, request }: Route.LoaderArgs) {
  const env = context.env ?? getEnv();
  const db = createDb();

  const url = new URL(request.url);
  const searchQuery = url.searchParams.get("q") || "";
  const sortBy = (url.searchParams.get("sort") as SortOption) || "updatedAt";
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));

  // フィルタパラメータ（複数選択対応）
  const filterRoles = url.searchParams.getAll("role") as FilterRole[];
  const filterEditions = url.searchParams.getAll("edition") as FilterEdition[];
  const filterInputMethods = url.searchParams.getAll("input") as FilterInputMethod[];
  const filterPlatforms = url.searchParams.getAll("platform") as FilterPlatform[];

  // ベースクエリ条件：公開プロフィールのみ
  const conditions = [eq(users.profileVisibility, "public")];

  // 検索条件（MCID、displayName、slugで検索）
  if (searchQuery) {
    conditions.push(
      or(
        like(users.mcid, `%${searchQuery}%`),
        like(users.displayName, `%${searchQuery}%`),
        like(users.slug, `%${searchQuery}%`)
      )!
    );
  }

  // フィルタ条件（複数選択対応：OR条件で組み合わせ）
  if (filterRoles.length > 0) {
    conditions.push(
      or(...filterRoles.map((role) => eq(users.role, role)))!
    );
  }
  if (filterEditions.length > 0) {
    conditions.push(
      or(...filterEditions.map((edition) => eq(users.mainEdition, edition)))!
    );
  }
  if (filterInputMethods.length > 0) {
    conditions.push(
      or(...filterInputMethods.map((input) => eq(users.inputMethodBadge, input)))!
    );
  }
  if (filterPlatforms.length > 0) {
    conditions.push(
      or(...filterPlatforms.map((platform) => eq(users.mainPlatform, platform)))!
    );
  }

  // クエリ条件を組み合わせ
  const whereCondition = and(...conditions);

  // 全体の件数を取得
  const totalCountResult = await db
    .select({ count: sql<number>`count(*)` })
    .from(users)
    .where(whereCondition);
  const totalCount = totalCountResult[0]?.count || 0;
  const totalPages = Math.ceil(totalCount / ITEMS_PER_PAGE);

  // ソート設定
  const orderByClause =
    sortBy === "mcid"
      ? asc(users.mcid)
      : sortBy === "displayName"
        ? asc(users.displayName)
        : desc(users.updatedAt);

  // ユーザー一覧を取得
  const playerList = await db.query.users.findMany({
    where: whereCondition,
    columns: {
      mcid: true,
      uuid: true,
      slug: true,
      displayName: true,
      discordAvatar: true,
      location: true,
      updatedAt: true,
      shortBio: true,
    },
    orderBy: [orderByClause],
    limit: ITEMS_PER_PAGE,
    offset: (page - 1) * ITEMS_PER_PAGE,
  });

  // お気に入りを取得（slugベース）
  const cookieHeader = request.headers.get("Cookie");
  const favoriteSlugs = getFavoritesFromCookie(cookieHeader);
  const favoritesSet = new Set(favoriteSlugs);

  // お気に入りを先頭に並べ替え
  const sortedPlayers = playerList.sort((a, b) => {
    const aIsFavorite = favoritesSet.has(a.slug);
    const bIsFavorite = favoritesSet.has(b.slug);
    if (aIsFavorite && !bIsFavorite) return -1;
    if (!aIsFavorite && bIsFavorite) return 1;
    return 0;
  });

  return {
    players: sortedPlayers,
    searchQuery,
    sortBy,
    currentPage: page,
    totalPages,
    totalCount,
    favoriteSlugs,
    filters: {
      roles: filterRoles,
      editions: filterEditions,
      inputMethods: filterInputMethods,
      platforms: filterPlatforms,
    },
  };
}

function PlayerCardSkeleton() {
  return (
    <div className="border rounded-lg p-3">
      <div className="flex items-center gap-3">
        <Skeleton className="w-12 h-12 rounded-lg shrink-0" />
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
const ROLE_LABELS: Record<string, string> = {
  runner: "ランナー",
  viewer: "視聴者",
};
const EDITION_LABELS: Record<string, string> = {
  java: "Java",
  bedrock: "Bedrock",
};
const INPUT_METHOD_LABELS: Record<string, string> = {
  keyboard_mouse: "KBM",
  controller: "Controller",
  touch: "Touch",
};
const PLATFORM_LABELS: Record<string, string> = {
  pc_windows: "Windows",
  pc_mac: "Mac",
  pc_linux: "Linux",
  switch: "Switch",
  mobile: "Mobile",
  other: "その他",
};

export default function BrowsePage() {
  const { players, searchQuery, sortBy, currentPage, totalPages, totalCount, filters } =
    useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();
  const [inputValue, setInputValue] = useState(searchQuery);
  const navigation = useNavigation();
  const isNavigating = navigation.state === "loading";
  const [isFilterDialogOpen, setIsFilterDialogOpen] = useState(false);

  // アクティブなフィルタ数
  const activeFilterCount = filters.roles.length + filters.editions.length + filters.inputMethods.length + filters.platforms.length;

  const handleSortChange = (value: string) => {
    const newParams = new URLSearchParams(searchParams);
    newParams.set("sort", value);
    newParams.delete("page");
    setSearchParams(newParams);
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const newParams = new URLSearchParams(searchParams);
    if (inputValue) {
      newParams.set("q", inputValue);
    } else {
      newParams.delete("q");
    }
    newParams.delete("page");
    setSearchParams(newParams);
  };

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

  const clearAllFilters = () => {
    const newParams = new URLSearchParams(searchParams);
    newParams.delete("role");
    newParams.delete("edition");
    newParams.delete("input");
    newParams.delete("platform");
    newParams.delete("page");
    setSearchParams(newParams);
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
          ランナーを探す
        </h1>
        <p className="text-muted-foreground">
          登録されているプレイヤー ({totalCount}人)
        </p>
      </div>

      {/* 検索・フィルタ・ソート */}
      <div className="flex flex-col gap-4">
        <div className="flex flex-col sm:flex-row gap-4">
          <Form onSubmit={handleSearch} className="flex-1">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                type="text"
                placeholder="MCID・名前で検索..."
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                className="pl-10"
              />
            </div>
          </Form>
          <div className="flex items-center gap-2">
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
                    プレイヤーを条件で絞り込みます
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
                          checked={filters.roles.includes("runner")}
                          onCheckedChange={(checked) => {
                            handleFilterChange("role", "runner", !!checked);
                          }}
                        />
                        <RadixLabel htmlFor="role-runner" className="cursor-pointer">ランナー</RadixLabel>
                      </div>
                      <div className="flex items-center space-x-2">
                        <Checkbox
                          id="role-viewer"
                          checked={filters.roles.includes("viewer")}
                          onCheckedChange={(checked) => {
                            handleFilterChange("role", "viewer", !!checked);
                          }}
                        />
                        <RadixLabel htmlFor="role-viewer" className="cursor-pointer">視聴者</RadixLabel>
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
                          checked={filters.editions.includes("java")}
                          onCheckedChange={(checked) => {
                            handleFilterChange("edition", "java", !!checked);
                          }}
                        />
                        <RadixLabel htmlFor="edition-java" className="cursor-pointer">Java Edition</RadixLabel>
                      </div>
                      <div className="flex items-center space-x-2">
                        <Checkbox
                          id="edition-bedrock"
                          checked={filters.editions.includes("bedrock")}
                          onCheckedChange={(checked) => {
                            handleFilterChange("edition", "bedrock", !!checked);
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
                          checked={filters.platforms.includes("pc_windows")}
                          onCheckedChange={(checked) => {
                            handleFilterChange("platform", "pc_windows", !!checked);
                          }}
                        />
                        <RadixLabel htmlFor="platform-windows" className="cursor-pointer">Windows</RadixLabel>
                      </div>
                      <div className="flex items-center space-x-2">
                        <Checkbox
                          id="platform-mac"
                          checked={filters.platforms.includes("pc_mac")}
                          onCheckedChange={(checked) => {
                            handleFilterChange("platform", "pc_mac", !!checked);
                          }}
                        />
                        <RadixLabel htmlFor="platform-mac" className="cursor-pointer">Mac</RadixLabel>
                      </div>
                      <div className="flex items-center space-x-2">
                        <Checkbox
                          id="platform-linux"
                          checked={filters.platforms.includes("pc_linux")}
                          onCheckedChange={(checked) => {
                            handleFilterChange("platform", "pc_linux", !!checked);
                          }}
                        />
                        <RadixLabel htmlFor="platform-linux" className="cursor-pointer">Linux</RadixLabel>
                      </div>
                      <div className="flex items-center space-x-2">
                        <Checkbox
                          id="platform-switch"
                          checked={filters.platforms.includes("switch")}
                          onCheckedChange={(checked) => {
                            handleFilterChange("platform", "switch", !!checked);
                          }}
                        />
                        <RadixLabel htmlFor="platform-switch" className="cursor-pointer">Switch</RadixLabel>
                      </div>
                      <div className="flex items-center space-x-2">
                        <Checkbox
                          id="platform-mobile"
                          checked={filters.platforms.includes("mobile")}
                          onCheckedChange={(checked) => {
                            handleFilterChange("platform", "mobile", !!checked);
                          }}
                        />
                        <RadixLabel htmlFor="platform-mobile" className="cursor-pointer">Mobile</RadixLabel>
                      </div>
                      <div className="flex items-center space-x-2">
                        <Checkbox
                          id="platform-other"
                          checked={filters.platforms.includes("other")}
                          onCheckedChange={(checked) => {
                            handleFilterChange("platform", "other", !!checked);
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
                          checked={filters.inputMethods.includes("keyboard_mouse")}
                          onCheckedChange={(checked) => {
                            handleFilterChange("input", "keyboard_mouse", !!checked);
                          }}
                        />
                        <RadixLabel htmlFor="input-kbm" className="cursor-pointer">キーボード/マウス</RadixLabel>
                      </div>
                      <div className="flex items-center space-x-2">
                        <Checkbox
                          id="input-controller"
                          checked={filters.inputMethods.includes("controller")}
                          onCheckedChange={(checked) => {
                            handleFilterChange("input", "controller", !!checked);
                          }}
                        />
                        <RadixLabel htmlFor="input-controller" className="cursor-pointer">コントローラー</RadixLabel>
                      </div>
                      <div className="flex items-center space-x-2">
                        <Checkbox
                          id="input-touch"
                          checked={filters.inputMethods.includes("touch")}
                          onCheckedChange={(checked) => {
                            handleFilterChange("input", "touch", !!checked);
                          }}
                        />
                        <RadixLabel htmlFor="input-touch" className="cursor-pointer">タッチ</RadixLabel>
                      </div>
                    </div>
                  </div>
                </div>

                <DialogFooter className="flex-col sm:flex-row gap-2">
                  {activeFilterCount > 0 && (
                    <Button
                      variant="outline"
                      className="w-full sm:w-auto"
                      onClick={() => {
                        clearAllFilters();
                        setIsFilterDialogOpen(false);
                      }}
                    >
                      <X className="h-4 w-4 mr-2" />
                      すべてクリア
                    </Button>
                  )}
                  <Button
                    className="w-full sm:w-auto"
                    onClick={() => setIsFilterDialogOpen(false)}
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
          </div>
        </div>

        {/* アクティブフィルタの表示 */}
        {activeFilterCount > 0 && (
          <div className="flex flex-wrap gap-2">
            {filters.roles.map((role) => (
              <Badge key={role} variant="secondary" className="gap-1">
                {ROLE_LABELS[role]}
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
                {PLATFORM_LABELS[platform]}
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

      {/* プレイヤー一覧 */}
      {isNavigating ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 12 }).map((_, i) => (
            <PlayerCardSkeleton key={i} />
          ))}
        </div>
      ) : players.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {players.map((player) => (
            <PlayerCard key={player.slug} player={player} />
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
          <Users className="h-16 w-16 mx-auto mb-4 opacity-50" />
          <p className="text-lg mb-2">
            {searchQuery || activeFilterCount > 0
              ? "条件に一致するプレイヤーが見つかりません"
              : "登録されているプレイヤーがいません"}
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

      {/* ページネーション */}
      {totalPages > 1 && (
        <div className="flex justify-center items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => goToPage(currentPage - 1)}
            disabled={currentPage <= 1 || isNavigating}
          >
            {isNavigating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            前へ
          </Button>
          <div className="flex items-center gap-1">
            {Array.from({ length: totalPages }, (_, i) => i + 1)
              .filter((page) => {
                // 現在のページの前後2ページと、最初・最後のページを表示
                return (
                  page === 1 ||
                  page === totalPages ||
                  Math.abs(page - currentPage) <= 2
                );
              })
              .map((page, index, array) => {
                // 省略記号を表示
                const prevPage = array[index - 1];
                const showEllipsis = prevPage && page - prevPage > 1;

                return (
                  <span key={page} className="flex items-center">
                    {showEllipsis && (
                      <span className="px-2 text-muted-foreground">...</span>
                    )}
                    <Button
                      variant={page === currentPage ? "default" : "outline"}
                      size="sm"
                      onClick={() => goToPage(page)}
                      className="min-w-[36px]"
                    >
                      {page}
                    </Button>
                  </span>
                );
              })}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => goToPage(currentPage + 1)}
            disabled={currentPage >= totalPages || isNavigating}
          >
            {isNavigating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            次へ
          </Button>
        </div>
      )}
    </div>
  );
}
