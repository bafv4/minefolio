import { Outlet, NavLink, redirect, useLoaderData, useNavigation } from "react-router";
import type { Route } from "./+types/_layout";
import { createDb } from "@/lib/db";
import { createAuth } from "@/lib/auth";
import { getSession } from "@/lib/session";
import { users } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { cn } from "@/lib/utils";
import {
  Pencil,
  Trophy,
  Keyboard,
  Mouse,
  Package,
  Search,
  Loader2,
  Save,
  Upload,
} from "lucide-react";

export async function loader({ context, request }: Route.LoaderArgs) {
  const { env } = context;
  const db = createDb();
  const auth = createAuth(db, env);

  const session = await getSession(request, auth);

  const user = await db.query.users.findFirst({
    where: eq(users.discordId, session.user.id),
  });

  if (!user) {
    return redirect("/onboarding");
  }

  return { user };
}

const navItems = [
  { to: "/me/edit", label: "プロフィール編集", icon: Pencil },
  { to: "/me/records", label: "記録", icon: Trophy },
  { to: "/me/keybindings", label: "キー配置", icon: Keyboard },
  { to: "/me/devices", label: "デバイス", icon: Mouse },
  { to: "/me/presets", label: "プリセット", icon: Save },
  { to: "/me/import", label: "インポート", icon: Upload },
  { to: "/me/items", label: "アイテム配置", icon: Package },
  { to: "/me/search-craft", label: "サーチクラフト", icon: Search },
];

export default function MeLayout() {
  const { user } = useLoaderData<typeof loader>();
  const navigation = useNavigation();

  // ナビゲーション中（ローディング中）かどうか
  const isNavigating = navigation.state === "loading";

  return (
    <div className="flex flex-col lg:flex-row gap-8">
      {/* Sidebar Navigation */}
      <aside className="lg:w-64 shrink-0">
        <nav className="sticky top-24 space-y-1">
          <div className="mb-4 pb-4 border-b">
            <p className="font-medium">{user.displayName ?? user.mcid}</p>
            <p className="text-sm text-muted-foreground">@{user.mcid}</p>
          </div>
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end
              className={({ isActive, isPending }) =>
                cn(
                  "flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors",
                  isActive
                    ? "bg-primary text-primary-foreground"
                    : isPending
                    ? "bg-secondary/50 text-muted-foreground"
                    : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                )
              }
            >
              {({ isPending }) => (
                <>
                  {isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <item.icon className="h-4 w-4" />
                  )}
                  {item.label}
                </>
              )}
            </NavLink>
          ))}
        </nav>
      </aside>

      {/* Main Content */}
      <main className="flex-1 min-w-0">
        <div className={cn(
          "transition-opacity duration-150",
          isNavigating && "opacity-50 pointer-events-none"
        )}>
          <Outlet />
        </div>
      </main>
    </div>
  );
}
