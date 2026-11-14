import { createTranslator } from "@/lib/messages";
import { useLoaderData, Link } from "react-router";
import type { Route } from "./+types/favorites";
import { useEffect, useState } from "react";
import { createDb } from "@/lib/db";
import { createAuth } from "@/lib/auth";
import { getOptionalSession } from "@/lib/session";
import { getEnv } from "@/lib/env.server";
import { users } from "@/lib/schema";
import { inArray } from "drizzle-orm";
import { getFavoriteSlugsByDiscordId } from "@/lib/browse-query.server";
import { getLocalFavorites } from "@/lib/favorites-client";
import { ProfileFeedCard, ProfileFeedCardSkeleton, type ProfileFeedCardPlayer } from "@/components/profile-feed-card";
import { FavoritesNav } from "@/components/favorites-nav";
import { FavoritesCookieAlert, FavoritesEmptyState } from "@/components/favorites-shared";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Heart, ArrowLeft } from "lucide-react";
import { useCookieConsent } from "@/components/cookie-consent";
import { useT } from "@/hooks/use-locale";
import { localeFromMatches } from "@/lib/locale";

type FavoritePlayer = ProfileFeedCardPlayer;

// 一覧取得で必要な列（ProfileFeedCard の描画に必要な最小限。browse-query.server.ts の
// BROWSE_LIST_COLUMNS と揃える）
const FAVORITE_PLAYER_COLUMNS = {
  mcid: true,
  uuid: true,
  slug: true,
  displayName: true,
  displayNameAlphabet: true,
  pronouns: true,
  role: true,
  mainEdition: true,
  mainPlatform: true,
  customSkinUrl: true,
  updatedAt: true,
  shortBio: true,
} as const;

export const meta: Route.MetaFunction = ({ loaderData, matches }) => {
  const t = createTranslator(localeFromMatches(matches));
  const title = t("favorites.metaTitle");
  const description = t("favorites.description");
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

  const session = await getOptionalSession(request, auth);
  if (!session) {
    // 未ログイン: クライアント側で localStorage → /api/users/by-slugs を呼ぶ
    return { players: [] as FavoritePlayer[], isLoggedIn: false, appUrl };
  }

  const slugs = await getFavoriteSlugsByDiscordId(db, session.user.id);
  if (slugs === null) {
    return { players: [] as FavoritePlayer[], isLoggedIn: false, appUrl };
  }
  if (slugs.length === 0) {
    return { players: [] as FavoritePlayer[], isLoggedIn: true, appUrl };
  }

  const rows = await db.query.users.findMany({
    where: inArray(users.slug, slugs),
    columns: FAVORITE_PLAYER_COLUMNS,
  });

  // お気に入り順（slugs の順 = favoriteSlug の辞書順）でソート
  const bySlug = new Map(rows.map((p) => [p.slug, p]));
  const sorted = slugs
    .map((s) => bySlug.get(s))
    .filter((p): p is NonNullable<typeof p> => p != null);

  return { players: sorted, isLoggedIn: true, appUrl };
}

export default function FavoritesPage() {
  const t = useT();
  const { players: ssrPlayers, isLoggedIn } = useLoaderData<typeof loader>();
  const { hasConsent, acceptCookies } = useCookieConsent();

  // 未ログイン時はクライアント側で localStorage → /api/users/by-slugs を呼んで詳細取得
  const [guestPlayers, setGuestPlayers] = useState<FavoritePlayer[]>([]);
  const [guestLoading, setGuestLoading] = useState(false);

  useEffect(() => {
    if (isLoggedIn) return;
    if (hasConsent !== true) {
      setGuestPlayers([]);
      return;
    }
    const slugs = getLocalFavorites();
    if (slugs.length === 0) {
      setGuestPlayers([]);
      return;
    }
    setGuestLoading(true);
    fetch("/api/users/by-slugs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slugs }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data && Array.isArray(data.users)) {
          // 入力順を維持
          const bySlug = new Map<string, FavoritePlayer>(
            (data.users as FavoritePlayer[]).map((u) => [u.slug, u]),
          );
          setGuestPlayers(slugs.map((s) => bySlug.get(s)).filter((u): u is FavoritePlayer => u != null));
        }
      })
      .catch(() => {})
      .finally(() => setGuestLoading(false));
  }, [isLoggedIn, hasConsent]);

  const players = isLoggedIn ? ssrPlayers : guestPlayers;
  const showCookieAlert = !isLoggedIn && hasConsent === false;
  const isLoadingList = !isLoggedIn && guestLoading;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Heart className="h-6 w-6 text-favorite fill-current" />
            {t("favorites.title")}
          </h1>
          <p className="text-sm text-muted-foreground">
            {`${t("favorites.totalCount")} (${players.length}${t("common.peopleUnit")})`}
          </p>
        </div>
        <Button asChild variant="outline" className="w-full sm:w-auto h-11 sm:h-10">
          <Link to="/">
            <ArrowLeft className="h-4 w-4 mr-2" />
            {t("common.backToHome")}
          </Link>
        </Button>
      </div>

      <FavoritesNav current="favorites" />

      {/* Cookie未承諾の警告（未ログインのみ） */}
      {showCookieAlert && <FavoritesCookieAlert onAccept={acceptCookies} />}

      {isLoadingList ? (
        <FavoriteCardSkeletonGrid />
      ) : players.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {players.map((player) => (
            <ProfileFeedCard key={player.slug} player={player} />
          ))}
        </div>
      ) : (
        <FavoritesEmptyState cookieBlocked={showCookieAlert} />
      )}

      {!isLoggedIn && (
        <p className="text-xs text-muted-foreground text-center">
          {t("favorites.cookieNotice")}
        </p>
      )}
    </div>
  );
}

// HydrateFallback とゲスト読み込み中（clientの by-slugs フェッチ）の両方で共有する。
function FavoriteCardSkeletonGrid() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {Array.from({ length: 6 }).map((_, i) => (
        <ProfileFeedCardSkeleton key={i} />
      ))}
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
      <FavoriteCardSkeletonGrid />
    </div>
  );
}
