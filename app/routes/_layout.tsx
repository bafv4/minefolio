import { Outlet, useLoaderData } from "react-router";
import type { Route } from "./+types/_layout";
import { Header, Footer } from "@/components/layout";
import { createDb } from "@/lib/db";
import { createAuth } from "@/lib/auth";
import { getOptionalSession } from "@/lib/session";
import { users } from "@/lib/schema";
import { eq } from "drizzle-orm";

export async function loader({ context, request }: Route.LoaderArgs) {
  const { env } = context.cloudflare;
  const db = createDb(env.DB);
  const auth = createAuth(db, env);

  const session = await getOptionalSession(request, auth);

  if (!session) {
    return { user: null };
  }

  // Get user from our users table
  const user = await db.query.users.findFirst({
    where: eq(users.discordId, session.user.id),
    columns: {
      mcid: true,
      displayName: true,
      discordAvatar: true,
    },
  });

  return { user: user ?? null };
}

export default function Layout() {
  const { user } = useLoaderData<typeof loader>();

  return (
    <div className="flex min-h-screen flex-col">
      <Header user={user} />
      <main className="flex-1 flex flex-col container mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Outlet />
      </main>
      <Footer />
    </div>
  );
}
