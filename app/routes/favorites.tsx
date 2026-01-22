import { useLoaderData, Link } from "react-router";
import type { Route } from "./+types/favorites";
import { createDb } from "@/lib/db";
import { getEnv } from "@/lib/env.server";
import { users } from "@/lib/schema";
import { inArray } from "drizzle-orm";
import { getFavoritesFromCookie } from "@/lib/favorites";
import { PlayerCard } from "@/components/player-card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Heart, Users, ArrowLeft, Cookie } from "lucide-react";
import { useCookieConsent } from "@/components/cookie-consent";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export const meta: Route.MetaFunction = () => {
  return [
    { title: "お気に入り - Minefolio" },
    {
      name: "description",
      content: "お気に入りに登録したプレイヤー一覧",
    },
  ];
};

export async function loader({ context, request }: Route.LoaderArgs) {
  const env = context.env ?? getEnv();
  const db = createDb();

  const cookieHeader = request.headers.get("Cookie");
  const favoriteMcids = getFavoritesFromCookie(cookieHeader);

  if (favoriteMcids.length === 0) {
    return { players: [], favoriteMcids };
  }

  // お気に入りのプレイヤー情報を取得
  const players = await db.query.users.findMany({
    where: inArray(users.mcid, favoriteMcids),
    columns: {
      mcid: true,
      uuid: true,
      slug: true,
      displayName: true,
      shortBio: true,
      location: true,
      updatedAt: true,
    },
  });

  // お気に入り順（Cookie内の順序）でソート
  const sortedPlayers = favoriteMcids
    .map((mcid) => players.find((p) => p.mcid === mcid))
    .filter((p): p is NonNullable<typeof p> => p != null);

  return { players: sortedPlayers, favoriteMcids };
}

export default function FavoritesPage() {
  const { players, favoriteMcids } = useLoaderData<typeof loader>();
  const { hasConsent, acceptCookies } = useCookieConsent();

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Heart className="h-6 w-6 text-red-500 fill-current" />
            お気に入り
          </h1>
          <p className="text-muted-foreground">
            お気に入りに登録したプレイヤー ({favoriteMcids.length}人)
          </p>
        </div>
        <Button asChild variant="outline" className="w-full sm:w-auto h-11 sm:h-10">
          <Link to="/">
            <ArrowLeft className="h-4 w-4 mr-2" />
            ホームに戻る
          </Link>
        </Button>
      </div>

      {/* Cookie未承諾の警告 */}
      {hasConsent === false && (
        <Alert>
          <Cookie className="h-4 w-4" />
          <AlertTitle>Cookieが無効です</AlertTitle>
          <AlertDescription className="flex items-center justify-between">
            <span>
              お気に入り機能を使用するにはCookieの承諾が必要です。
            </span>
            <Button size="sm" onClick={acceptCookies} className="ml-4">
              Cookieを有効にする
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {players.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {players.map((player) => (
            <PlayerCard key={player.slug} player={player} />
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
          <Users className="h-16 w-16 mx-auto mb-4 opacity-50" />
          <p className="text-lg mb-2">お気に入りがありません</p>
          <p className="text-sm text-center max-w-md mb-6">
            {hasConsent === false
              ? "お気に入り機能を使用するにはCookieの承諾が必要です。"
              : "プレイヤーのプロフィールページでハートボタンを押すと、お気に入りに追加できます。"}
          </p>
          <Button asChild>
            <Link to="/">プレイヤーを探す</Link>
          </Button>
        </div>
      )}

      <p className="text-xs text-muted-foreground text-center">
        お気に入りはブラウザのCookieに保存されます。別のブラウザやデバイスでは表示されません。
      </p>
    </div>
  );
}

export function HydrateFallback() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Skeleton className="h-8 w-48 mb-2" />
          <Skeleton className="h-5 w-64" />
        </div>
        <Skeleton className="h-10 w-32" />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="border rounded-lg p-3">
            <div className="flex items-center gap-3">
              <Skeleton className="w-12 h-12 rounded-lg shrink-0" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-5 w-32" />
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-3 w-40" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
