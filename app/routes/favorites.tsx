import { useLoaderData, Link } from "react-router";
import type { Route } from "./+types/favorites";
import { useEffect, useState } from "react";
import { createDb } from "@/lib/db";
import { createAuth } from "@/lib/auth";
import { getOptionalSession } from "@/lib/session";
import { getEnv } from "@/lib/env.server";
import { users } from "@/lib/schema";
import { eq, inArray } from "drizzle-orm";
import { getFavoritesFromDb } from "@/lib/favorites";
import { getLocalFavorites } from "@/lib/favorites-client";
import { PlayerCard } from "@/components/player-card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Heart, Users, ArrowLeft, Cookie, Loader2 } from "lucide-react";
import { useCookieConsent } from "@/components/cookie-consent";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { t } from "@/lib/messages";

type FavoritePlayer = {
  mcid: string | null;
  uuid: string | null;
  slug: string;
  displayName: string | null;
  shortBio: string | null;
  location: string | null;
  updatedAt: Date;
};

export const meta: Route.MetaFunction = ({ loaderData }) => {
  const title = t("favorites.metaTitle");
  const description = t("favorites.description");
  const appUrl = loaderData?.appUrl || "https://minefolio.pages.dev";
  const ogImage = `${appUrl}/og-image`;
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
  const appUrl = env.APP_URL || "https://minefolio.pages.dev";
  const db = createDb();
  const auth = createAuth(db, env);

  const session = await getOptionalSession(request, auth);
  if (!session) {
    // 未ログイン: クライアント側で localStorage → /api/users/by-slugs を呼ぶ
    return { players: [] as FavoritePlayer[], isLoggedIn: false, appUrl };
  }

  const user = await db.query.users.findFirst({
    where: eq(users.discordId, session.user.id),
    columns: { id: true },
  });
  if (!user) {
    return { players: [] as FavoritePlayer[], isLoggedIn: false, appUrl };
  }

  const slugs = await getFavoritesFromDb(db, user.id);
  if (slugs.length === 0) {
    return { players: [] as FavoritePlayer[], isLoggedIn: true, appUrl };
  }

  const rows = await db.query.users.findMany({
    where: inArray(users.slug, slugs),
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

  // お気に入り順（DB登録順 = slugsの順）でソート
  const bySlug = new Map(rows.map((p) => [p.slug, p]));
  const sorted = slugs
    .map((s) => bySlug.get(s))
    .filter((p): p is NonNullable<typeof p> => p != null);

  return { players: sorted, isLoggedIn: true, appUrl };
}

export default function FavoritesPage() {
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
            <Heart className="h-6 w-6 text-red-500 fill-current" />
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

      {/* Cookie未承諾の警告（未ログインのみ） */}
      {showCookieAlert && (
        <Alert>
          <Cookie className="h-4 w-4" />
          <AlertTitle>{t("favorites.cookieDisabled")}</AlertTitle>
          <AlertDescription className="flex items-center justify-between">
            <span>{t("favorites.cookieRequired")}</span>
            <Button size="sm" onClick={acceptCookies} className="ml-4">
              {t("favorites.enableCookie")}
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {isLoadingList ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : players.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {players.map((player) => (
            <PlayerCard key={player.slug} player={player} />
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
          <Users className="h-12 w-12 mx-auto mb-4 opacity-30" />
          <p className="text-lg mb-2">{t("favorites.emptyTitle")}</p>
          <p className="text-sm text-center max-w-md mb-6">
            {!isLoggedIn && hasConsent === false
              ? t("favorites.cookieRequired")
              : t("favorites.emptyHelp")}
          </p>
          <Button asChild>
            <Link to="/">{t("favorites.browseRunner")}</Link>
          </Button>
        </div>
      )}

      {!isLoggedIn && (
        <p className="text-xs text-muted-foreground text-center">
          {t("favorites.cookieNotice")}
        </p>
      )}
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
          <div key={i} className="border border-border/70 rounded-xl p-3">
            <div className="flex items-center gap-3">
              <Skeleton className="w-12 h-12 rounded-xl shrink-0" />
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
