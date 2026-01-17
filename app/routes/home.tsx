import { useLoaderData, useSearchParams, Link } from "react-router";
import type { Route } from "./+types/home";
import { createDb } from "@/lib/db";
import { users } from "@/lib/schema";
import { desc, asc, like, sql } from "drizzle-orm";
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
import { Search, Users, ArrowRight } from "lucide-react";

export const meta: Route.MetaFunction = () => {
  return [
    { title: "Minefolio - Minecraft Speedrunner Portfolio" },
    {
      name: "description",
      content:
        "Minecraftスピードランナーを見つけて、キー配置や自己ベストなどを確認しましょう。",
    },
  ];
};

const PLAYERS_PER_PAGE = 12;

export async function loader({ context, request }: Route.LoaderArgs) {
  const { env } = context.cloudflare;
  const db = createDb(env.DB);
  const url = new URL(request.url);

  const search = url.searchParams.get("q") ?? "";
  const sort = url.searchParams.get("sort") ?? "recent";
  const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1"));

  // Build query
  let orderBy;
  switch (sort) {
    case "name":
      orderBy = asc(users.mcid);
      break;
    case "recent":
    default:
      orderBy = desc(users.createdAt);
      break;
  }

  // Get players with optional search filter
  const whereClause = search
    ? like(users.mcid, `%${search}%`)
    : undefined;

  const [players, countResult] = await Promise.all([
    db.query.users.findMany({
      where: whereClause,
      orderBy: [orderBy],
      limit: PLAYERS_PER_PAGE,
      offset: (page - 1) * PLAYERS_PER_PAGE,
      columns: {
        mcid: true,
        uuid: true,
        displayName: true,
        bio: true,
        location: true,
        updatedAt: true,
        shortBio: true,
      },
    }),
    db
      .select({ count: sql<number>`count(*)` })
      .from(users)
      .where(whereClause),
  ]);

  const totalPlayers = countResult[0]?.count ?? 0;
  const totalPages = Math.ceil(totalPlayers / PLAYERS_PER_PAGE);

  return {
    players,
    totalPlayers,
    totalPages,
    currentPage: page,
    search,
    sort,
  };
}

export default function HomePage() {
  const { players, totalPlayers, totalPages, currentPage, search, sort } =
    useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();

  const handleSearch = (value: string) => {
    const params = new URLSearchParams(searchParams);
    if (value) {
      params.set("q", value);
    } else {
      params.delete("q");
    }
    params.delete("page");
    setSearchParams(params);
  };

  const handleSort = (value: string) => {
    const params = new URLSearchParams(searchParams);
    params.set("sort", value);
    params.delete("page");
    setSearchParams(params);
  };

  const handlePageChange = (newPage: number) => {
    const params = new URLSearchParams(searchParams);
    params.set("page", String(newPage));
    setSearchParams(params);
  };

  return (
    <div className="flex-1 flex flex-col space-y-8">
      {/* Hero Section */}
      <section className="text-center py-12 space-y-4">
        <h1 className="text-4xl font-bold tracking-tight">
          Minefolio
        </h1>
        <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
          Minecraft Speedrunning + Portfolio
        </p>
        <div className="flex justify-center gap-4 pt-4">
          <Button asChild size="lg">
            <Link to="/login">
              プロフィールを作る
              <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>
          <Button variant="outline" size="lg" asChild>
            <Link to="/browse">ランナーを探す</Link>
          </Button>
        </div>
      </section>

      {/* Players Section */}
      <section className="flex-1 flex flex-col space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Users className="h-5 w-5 text-muted-foreground" />
            <h2 className="text-2xl font-bold">プレイヤー</h2>
            <span className="text-muted-foreground">({totalPlayers})</span>
          </div>
        </div>

        {/* Search and Filter */}
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="MCIDで検索..."
              defaultValue={search}
              onChange={(e) => handleSearch(e.target.value)}
              className="pl-10"
            />
          </div>
          <Select value={sort} onValueChange={handleSort}>
            <SelectTrigger className="w-full sm:w-45">
              <SelectValue placeholder="並び替え" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="recent">新着順</SelectItem>
              <SelectItem value="name">名前順 (A-Z)</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Player Grid */}
        {players.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {players.map((player) => (
              <PlayerCard key={player.mcid} player={player} />
            ))}
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center py-12 text-muted-foreground">
            <Users className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p className="text-lg">プレイヤーが見つかりません</p>
            {search && (
              <p className="text-sm mt-2">
                別の検索ワードをお試しください{" "}
                <button
                  onClick={() => handleSearch("")}
                  className="text-primary hover:underline"
                >
                  検索をクリア
                </button>
              </p>
            )}
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex justify-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={currentPage <= 1}
              onClick={() => handlePageChange(currentPage - 1)}
            >
              前へ
            </Button>
            <div className="flex items-center gap-1">
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                let pageNum;
                if (totalPages <= 5) {
                  pageNum = i + 1;
                } else if (currentPage <= 3) {
                  pageNum = i + 1;
                } else if (currentPage >= totalPages - 2) {
                  pageNum = totalPages - 4 + i;
                } else {
                  pageNum = currentPage - 2 + i;
                }
                return (
                  <Button
                    key={pageNum}
                    variant={pageNum === currentPage ? "default" : "outline"}
                    size="sm"
                    onClick={() => handlePageChange(pageNum)}
                  >
                    {pageNum}
                  </Button>
                );
              })}
            </div>
            <Button
              variant="outline"
              size="sm"
              disabled={currentPage >= totalPages}
              onClick={() => handlePageChange(currentPage + 1)}
            >
              次へ
            </Button>
          </div>
        )}
      </section>
    </div>
  );
}
