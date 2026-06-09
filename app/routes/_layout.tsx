import { Outlet, useLoaderData } from "react-router";
import { NuqsAdapter } from "nuqs/adapters/react-router/v7";
import type { Route } from "./+types/_layout";
import { Header, Footer, NavigationProgress } from "@/components/layout";
import { createDb } from "@/lib/db";
import { createAuth } from "@/lib/auth";
import { getOptionalSession } from "@/lib/session";
import { getEnv } from "@/lib/env.server";
import { users } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { CookieConsentBanner } from "@/components/cookie-consent";
import { BackToTopButton } from "@/components/back-to-top-button";
import { FavoritesProvider } from "@/hooks/use-favorites";
import { getFavoritesFromDb } from "@/lib/favorites";

export async function loader({ context, request }: Route.LoaderArgs) {
  const env = context.env ?? getEnv();
  const db = createDb();
  const auth = createAuth(db, env);

  const session = await getOptionalSession(request, auth);

  if (!session) {
    return { user: null, initialFavorites: [] as string[] };
  }

  // Get user from our users table
  const user = await db.query.users.findFirst({
    where: eq(users.discordId, session.user.id),
    columns: {
      id: true,
      mcid: true,
      slug: true,
      displayName: true,
      discordAvatar: true,
    },
  });

  if (!user) {
    return { user: null, initialFavorites: [] as string[] };
  }

  // アバター更新（必要なら）と initialFavorites 取得を並列実行（DB ラウンドトリップ削減）
  const needsAvatarUpdate = session.user.image !== user.discordAvatar;
  const [, initialFavorites] = await Promise.all([
    needsAvatarUpdate
      ? db
          .update(users)
          .set({ discordAvatar: session.user.image ?? null })
          .where(eq(users.discordId, session.user.id))
      : Promise.resolve(),
    getFavoritesFromDb(db, user.id),
  ]);
  if (needsAvatarUpdate) {
    user.discordAvatar = session.user.image ?? null;
  }

  return {
    user: { mcid: user.mcid, slug: user.slug, displayName: user.displayName, discordAvatar: user.discordAvatar },
    initialFavorites,
  };
}

export default function Layout() {
  const { user, initialFavorites } = useLoaderData<typeof loader>();

  return (
    <NuqsAdapter>
      <FavoritesProvider isLoggedIn={!!user} initialFavorites={initialFavorites}>
        <div className="flex min-h-screen flex-col">
        {/* スキップリンク（Tab フォーカス時のみ表示） */}
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[100] focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground focus:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          本文へスキップ
        </a>
        <NavigationProgress />
        <Header user={user} />
        <main
          id="main-content"
          tabIndex={-1}
          className="flex-1 flex flex-col container mx-auto px-4 sm:px-6 lg:px-8 py-8 focus-visible:outline-none"
        >
          <Outlet />
        </main>
        <Footer />
        <CookieConsentBanner />
        <BackToTopButton />
        </div>
      </FavoritesProvider>
    </NuqsAdapter>
  );
}
