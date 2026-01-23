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
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
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
type FilterRole = "runner" | "viewer" | "";
type FilterEdition = "java" | "bedrock" | "";
type FilterInputMethod = "keyboard_mouse" | "controller" | "touch" | "";

export async function loader({ context, request }: Route.LoaderArgs) {
  const env = context.env ?? getEnv();
  const db = createDb();

  const url = new URL(request.url);
  const searchQuery = url.searchParams.get("q") || "";
  const sortBy = (url.searchParams.get("sort") as SortOption) || "updatedAt";
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));

  // フィルタパラメータ
  const filterRole = (url.searchParams.get("role") as FilterRole) || "";
  const filterEdition = (url.searchParams.get("edition") as FilterEdition) || "";
  const filterInputMethod = (url.searchParams.get("input") as FilterInputMethod) || "";

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

  // フィルタ条件
  if (filterRole) {
    conditions.push(eq(users.role, filterRole));
  }
  if (filterEdition) {
    conditions.push(eq(users.mainEdition, filterEdition));
  }
  if (filterInputMethod) {
    conditions.push(eq(users.inputMethodBadge, filterInputMethod));
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
      role: filterRole,
      edition: filterEdition,
      inputMethod: filterInputMethod,
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

export default function BrowsePage() {
  const { players, searchQuery, sortBy, currentPage, totalPages, totalCount, filters } =
    useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();
  const [inputValue, setInputValue] = useState(searchQuery);
  const navigation = useNavigation();
  const isNavigating = navigation.state === "loading";

  // アクティブなフィルタ数
  const activeFilterCount = [filters.role, filters.edition, filters.inputMethod].filter(Boolean).length;

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

  const handleFilterChange = (key: string, value: string) => {
    const newParams = new URLSearchParams(searchParams);
    if (value) {
      newParams.set(key, value);
    } else {
      newParams.delete(key);
    }
    newParams.delete("page");
    setSearchParams(newParams);
  };

  const clearAllFilters = () => {
    const newParams = new URLSearchParams(searchParams);
    newParams.delete("role");
    newParams.delete("edition");
    newParams.delete("input");
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
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className="gap-2">
                  <Filter className="h-4 w-4" />
                  フィルタ
                  {activeFilterCount > 0 && (
                    <Badge variant="secondary" className="ml-1 px-1.5 py-0 text-xs">
                      {activeFilterCount}
                    </Badge>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-72" align="end">
                <div className="space-y-4">
                  <div className="font-medium">絞り込み</div>

                  {/* ロール */}
                  <div className="space-y-2">
                    <label className="text-sm text-muted-foreground">ロール</label>
                    <Select
                      value={filters.role}
                      onValueChange={(value) => handleFilterChange("role", value)}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="すべて" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="">すべて</SelectItem>
                        <SelectItem value="runner">ランナー</SelectItem>
                        <SelectItem value="viewer">視聴者</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {/* エディション */}
                  <div className="space-y-2">
                    <label className="text-sm text-muted-foreground">エディション</label>
                    <Select
                      value={filters.edition}
                      onValueChange={(value) => handleFilterChange("edition", value)}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="すべて" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="">すべて</SelectItem>
                        <SelectItem value="java">Java Edition</SelectItem>
                        <SelectItem value="bedrock">Bedrock Edition</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {/* 入力方法 */}
                  <div className="space-y-2">
                    <label className="text-sm text-muted-foreground">入力方法</label>
                    <Select
                      value={filters.inputMethod}
                      onValueChange={(value) => handleFilterChange("input", value)}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="すべて" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="">すべて</SelectItem>
                        <SelectItem value="keyboard_mouse">キーボード/マウス</SelectItem>
                        <SelectItem value="controller">コントローラー</SelectItem>
                        <SelectItem value="touch">タッチ</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {activeFilterCount > 0 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full"
                      onClick={clearAllFilters}
                    >
                      <X className="h-4 w-4 mr-2" />
                      フィルタをクリア
                    </Button>
                  )}
                </div>
              </PopoverContent>
            </Popover>

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
            {filters.role && (
              <Badge variant="secondary" className="gap-1">
                {ROLE_LABELS[filters.role]}
                <button
                  onClick={() => handleFilterChange("role", "")}
                  className="ml-1 hover:text-destructive"
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            )}
            {filters.edition && (
              <Badge variant="secondary" className="gap-1">
                {EDITION_LABELS[filters.edition]}
                <button
                  onClick={() => handleFilterChange("edition", "")}
                  className="ml-1 hover:text-destructive"
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            )}
            {filters.inputMethod && (
              <Badge variant="secondary" className="gap-1">
                {INPUT_METHOD_LABELS[filters.inputMethod]}
                <button
                  onClick={() => handleFilterChange("input", "")}
                  className="ml-1 hover:text-destructive"
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            )}
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
