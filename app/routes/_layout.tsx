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

  // Discordアバターが変更されていたらDBを更新
  if (user && session.user.image !== user.discordAvatar) {
    await db
      .update(users)
      .set({ discordAvatar: session.user.image ?? null })
      .where(eq(users.discordId, session.user.id));
    user.discordAvatar = session.user.image ?? null;
  }

  // ログイン中ユーザーのお気に入りを SSR 用に取得
  const initialFavorites = user ? await getFavoritesFromDb(db, user.id) : [];

  return {
    user: user ? { mcid: user.mcid, slug: user.slug, displayName: user.displayName, discordAvatar: user.discordAvatar } : null,
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
