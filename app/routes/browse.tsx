import { useLoaderData, useSearchParams, Form } from "react-router";
import { useState } from "react";
import type { Route } from "./+types/browse";
import { createDb } from "@/lib/db";
import { getEnv } from "@/lib/env.server";
import { users } from "@/lib/schema";
import { eq, desc, asc, like, sql, or } from "drizzle-orm";
import { PlayerCard } from "@/components/player-card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Search, Users, ArrowUpDown } from "lucide-react";
import { getFavoritesFromCookie } from "@/lib/favorites";

export const meta: Route.MetaFunction = () => {
  return [
    { title: "探す - Minefolio" },
    {
      name: "description",
      content: "Minecraftスピードランナーを探す",
    },
  ];
};

const ITEMS_PER_PAGE = 12;

type SortOption = "updatedAt" | "mcid" | "displayName";

export async function loader({ context, request }: Route.LoaderArgs) {
  const env = context.env ?? getEnv();
  const db = createDb();

  const url = new URL(request.url);
  const searchQuery = url.searchParams.get("q") || "";
  const sortBy = (url.searchParams.get("sort") as SortOption) || "updatedAt";
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));

  // ベースクエリ条件：公開プロフィールのみ
  const baseCondition = eq(users.profileVisibility, "public");

  // 検索条件
  const searchCondition = searchQuery
    ? or(
        like(users.mcid, `%${searchQuery}%`),
        like(users.displayName, `%${searchQuery}%`)
      )
    : undefined;

  // 全体の件数を取得
  const totalCountResult = await db
    .select({ count: sql<number>`count(*)` })
    .from(users)
    .where(searchCondition ? sql`${baseCondition} AND ${searchCondition}` : baseCondition);
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
    where: searchCondition
      ? sql`${baseCondition} AND ${searchCondition}`
      : baseCondition,
    columns: {
      mcid: true,
      uuid: true,
      displayName: true,
      location: true,
      updatedAt: true,
      shortBio: true,
    },
    orderBy: [orderByClause],
    limit: ITEMS_PER_PAGE,
    offset: (page - 1) * ITEMS_PER_PAGE,
  });

  // お気に入りを取得
  const cookieHeader = request.headers.get("Cookie");
  const favoriteMcids = getFavoritesFromCookie(cookieHeader);
  const favoritesSet = new Set(favoriteMcids);

  // お気に入りを先頭に並べ替え
  const sortedPlayers = playerList.sort((a, b) => {
    const aIsFavorite = favoritesSet.has(a.mcid);
    const bIsFavorite = favoritesSet.has(b.mcid);
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
    favoriteMcids,
  };
}

export default function BrowsePage() {
  const { players, searchQuery, sortBy, currentPage, totalPages, totalCount } =
    useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();
  const [inputValue, setInputValue] = useState(searchQuery);

  const handleSortChange = (value: string) => {
    const newParams = new URLSearchParams(searchParams);
    newParams.set("sort", value);
    newParams.delete("page"); // ソート変更時は1ページ目に戻る
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
    newParams.delete("page"); // 検索時は1ページ目に戻る
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

      {/* 検索・ソート */}
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
          <ArrowUpDown className="h-4 w-4 text-muted-foreground" />
          <Select value={sortBy} onValueChange={handleSortChange}>
            <SelectTrigger className="w-[160px]">
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

      {/* プレイヤー一覧 */}
      {players.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {players.map((player) => (
            <PlayerCard key={player.mcid} player={player} />
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
          <Users className="h-16 w-16 mx-auto mb-4 opacity-50" />
          <p className="text-lg mb-2">
            {searchQuery
              ? `「${searchQuery}」に一致するプレイヤーが見つかりません`
              : "登録されているプレイヤーがいません"}
          </p>
          {searchQuery && (
            <Button
              variant="outline"
              onClick={() => {
                setInputValue("");
                const newParams = new URLSearchParams(searchParams);
                newParams.delete("q");
                newParams.delete("page");
                setSearchParams(newParams);
              }}
            >
              検索をクリア
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
            disabled={currentPage <= 1}
          >
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
            disabled={currentPage >= totalPages}
          >
            次へ
          </Button>
        </div>
      )}
    </div>
  );
}
