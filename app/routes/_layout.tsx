import { Outlet, useLoaderData } from "react-router";
import type { Route } from "./+types/_layout";
import { Header, Footer, NavigationProgress } from "@/components/layout";
import { createDb } from "@/lib/db";
import { createAuth } from "@/lib/auth";
import { getOptionalSession } from "@/lib/session";
import { getEnv } from "@/lib/env.server";
import { users } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { CookieConsentBanner } from "@/components/cookie-consent";
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
    <FavoritesProvider isLoggedIn={!!user} initialFavorites={initialFavorites}>
      <div className="flex min-h-screen flex-col">
        <NavigationProgress />
        <Header user={user} />
        <main className="flex-1 flex flex-col container mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <Outlet />
        </main>
        <Footer />
        <CookieConsentBanner />
      </div>
    </FavoritesProvider>
  );
}
